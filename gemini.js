// Client minimale per la Gemini API (REST v1beta), usato direttamente dal browser.
// La chiave resta sul telefono: viene inviata solo a generativelanguage.googleapis.com.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const CHUNK = 8 * 1024 * 1024; // stessi pezzi da 8 MB dell'SDK ufficiale

class GeminiError extends Error {
  constructor(message, { status = 0, code = '', retryable = false, ritardoMs = 0, giornaliero = false, quotaNota = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.ritardoMs = ritardoMs;     // quanto aspettare prima di riprovare (limite al minuto)
    this.giornaliero = giornaliero; // quota del giorno esaurita: inutile riprovare con lo stesso modello
    this.quotaNota = quotaNota;     // Gemini ha detto di quale limite si tratta
  }
}

async function erroreDaRisposta(res) {
  let msg = `Errore ${res.status}`;
  let code = '';
  let ritardoMs = 0;
  let giornaliero = false;
  let quotaNota = false;
  try {
    const j = await res.json();
    if (j && j.error) {
      msg = j.error.message || msg;
      code = j.error.status || '';
      const dettagli = j.error.details || [];
      const retry = dettagli.find((d) => /RetryInfo/.test(d['@type'] || ''));
      if (retry && retry.retryDelay) ritardoMs = Math.ceil(parseFloat(retry.retryDelay) * 1000) || 0;
      const quota = dettagli.find((d) => /QuotaFailure/.test(d['@type'] || ''));
      const ids = quota ? (quota.violations || []).map((v) => `${v.quotaId || ''} ${v.quotaMetric || ''}`).join(' ') : msg;
      giornaliero = /PerDay|per day|daily/i.test(ids);
      quotaNota = !!quota || /per (minute|day)|daily/i.test(msg);
    }
  } catch (_) { /* corpo non JSON */ }
  if (res.status === 429) {
    msg = 'Limite gratuito di Gemini raggiunto per questo modello (' + msg + ')';
  } else if (res.status === 400 && /API key/i.test(msg)) {
    msg = 'Chiave API non valida. Controllala nelle impostazioni.';
  } else if (res.status === 403) {
    msg = 'Accesso negato da Gemini: ' + msg;
  }
  return new GeminiError(msg, {
    status: res.status,
    code,
    retryable: res.status === 429 || res.status >= 500,
    ritardoMs,
    giornaliero,
    quotaNota,
  });
}

async function geminiFetch(key, path, opts = {}) {
  const res = await fetch(path.startsWith('http') ? path : GEMINI_BASE + path, {
    ...opts,
    headers: { 'x-goog-api-key': key, ...(opts.headers || {}) },
  });
  if (!res.ok) throw await erroreDaRisposta(res);
  return res;
}

async function elencaModelli(key) {
  const res = await geminiFetch(key, '/v1beta/models?pageSize=1000');
  const j = await res.json();
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      nome: m.displayName || m.name,
      inputMax: m.inputTokenLimit || 0,
      outputMax: m.outputTokenLimit || 0,
    }))
    .filter((m) => /^gemini/.test(m.id) && /flash|pro/.test(m.id))
    .filter((m) => !/tts|image|embedding|live|native-audio|robotics|computer-use|learnlm/.test(m.id));
}

// Ordina i modelli dal più adatto: prima i "flash" (buona qualità e quota gratuita più ampia),
// poi i "flash-lite" (quota più alta, qualità minore), infine i "pro".
function ordinaModelli(modelli) {
  const famiglia = (id) => (/flash-lite/.test(id) ? 1 : /flash/.test(id) ? 0 : 2);
  const versione = (id) => {
    if (/latest/.test(id)) return 999;
    const m = id.match(/gemini-(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const instabile = (id) => (/preview|exp/.test(id) ? 1 : 0);
  return [...modelli].sort((a, b) =>
    famiglia(a.id) - famiglia(b.id) ||
    versione(b.id) - versione(a.id) ||
    instabile(a.id) - instabile(b.id) ||
    a.id.localeCompare(b.id));
}

async function caricaFile(key, blob, mimeType, nome, { onProgress, signal } = {}) {
  const avvio = await geminiFetch(key, '/upload/v1beta/files', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({ file: { display_name: nome } }),
  });
  const url = avvio.headers.get('x-goog-upload-url');
  if (!url) throw new GeminiError('Gemini non ha restituito l\'indirizzo di caricamento.');

  let offset = 0;
  let risposta = null;
  while (offset < blob.size) {
    const fine = Math.min(offset + CHUNK, blob.size);
    const ultimo = fine >= blob.size;
    let tentativi = 0;
    for (;;) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal,
          headers: {
            'X-Goog-Upload-Command': ultimo ? 'upload, finalize' : 'upload',
            'X-Goog-Upload-Offset': String(offset),
          },
          body: blob.slice(offset, fine),
        });
        if (!res.ok) throw await erroreDaRisposta(res);
        risposta = res;
        break;
      } catch (e) {
        if (signal && signal.aborted) throw e;
        if (++tentativi >= 4) throw e;
        await attendi(1000 * 2 ** tentativi);
      }
    }
    offset = fine;
    if (onProgress) onProgress(offset / blob.size);
  }
  const j = await risposta.json();
  if (!j.file) throw new GeminiError('Caricamento non completato.');
  return j.file; // { name: 'files/...', uri, mimeType, state, expirationTime }
}

async function attendiFileAttivo(key, nome, { signal } = {}) {
  for (let i = 0; i < 200; i++) {
    const res = await geminiFetch(key, '/v1beta/' + nome, { signal });
    const f = await res.json();
    if (f.state === 'ACTIVE') return f;
    if (f.state === 'FAILED') throw new GeminiError('Gemini non è riuscito a leggere il file audio.');
    await attendi(3000, signal);
  }
  throw new GeminiError('Gemini ci sta mettendo troppo a elaborare il file. Riprova più tardi.');
}

async function eliminaFile(key, nome) {
  try { await geminiFetch(key, '/v1beta/' + nome, { method: 'DELETE' }); } catch (_) { /* scade da solo dopo 48 ore */ }
}

// Genera testo in streaming: onText riceve il testo completo accumulato finora.
async function genera(key, modello, parts, { maxOutputTokens, temperature = 0.3, thinkingConfig, extraConfig, onText, signal } = {}) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
      ...(extraConfig || {}),
    },
  };
  const res = await geminiFetch(key, `/v1beta/models/${modello}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  let testo = '';
  let fine = '';
  let bloccato = '';
  const leggiEvento = (riga) => {
    if (!riga.startsWith('data:')) return;
    const dati = riga.slice(5).trim();
    if (!dati || dati === '[DONE]') return;
    let j;
    try { j = JSON.parse(dati); } catch (_) { return; }
    if (j.error) throw new GeminiError(j.error.message || 'Errore durante la generazione', { status: j.error.code });
    if (j.promptFeedback && j.promptFeedback.blockReason) bloccato = j.promptFeedback.blockReason;
    const c = (j.candidates || [])[0];
    if (!c) return;
    for (const p of (c.content && c.content.parts) || []) {
      if (p.text && !p.thought) testo += p.text;
    }
    if (c.finishReason) fine = c.finishReason;
    if (onText) onText(testo);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      leggiEvento(buffer.slice(0, i).replace(/\r$/, ''));
      buffer = buffer.slice(i + 1);
    }
  }
  if (buffer) leggiEvento(buffer.trim());
  if (bloccato) throw new GeminiError('Gemini ha rifiutato il contenuto (' + bloccato + ').');
  if (!testo.trim()) {
    throw new GeminiError(fine && fine !== 'STOP'
      ? 'Gemini si è fermato senza testo (' + fine + ').'
      : 'Gemini ha restituito una risposta vuota.');
  }
  return { testo, troncato: fine === 'MAX_TOKENS', motivo: fine };
}

function attendi(ms, signal) {
  return new Promise((ok, no) => {
    const t = setTimeout(ok, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); no(new DOMException('Annullato', 'AbortError')); }, { once: true });
  });
}
