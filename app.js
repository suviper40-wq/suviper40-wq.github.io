'use strict';

const VERSIONE = '1.1.0';
const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------------------
// Memoria locale
// ---------------------------------------------------------------------------
function leggiLS(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function scriviLS(k, v) {
  try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* memoria non disponibile */ }
}
const Imp = {
  get chiave() { return leggiLS('rulcio.chiave') || ''; },
  set chiave(v) { scriviLS('rulcio.chiave', v); },
  get modello() { return leggiLS('rulcio.modello') || ''; },
  set modello(v) { scriviLS('rulcio.modello', v); },
  get modelli() { try { return JSON.parse(leggiLS('rulcio.modelli') || '[]'); } catch (_) { return []; } },
  set modelli(v) { scriviLS('rulcio.modelli', JSON.stringify(v)); },
};

// Archivio delle lezioni su IndexedDB (resta sul telefono).
const DB = (() => {
  let aperto;
  const apri = () => aperto || (aperto = new Promise((ok, no) => {
    const r = indexedDB.open('rulcio', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('lezioni', { keyPath: 'id' });
      r.result.createObjectStore('audio');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  }));
  const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const store = async (nome, modo = 'readonly') => (await apri()).transaction(nome, modo).objectStore(nome);
  return {
    tutte: async () => req((await store('lezioni')).getAll()),
    leggi: async (id) => req((await store('lezioni')).get(id)),
    salva: async (l) => req((await store('lezioni', 'readwrite')).put(l)),
    elimina: async (id) => {
      await req((await store('lezioni', 'readwrite')).delete(id));
      await req((await store('audio', 'readwrite')).delete(id));
    },
    salvaAudio: async (id, blob) => req((await store('audio', 'readwrite')).put(blob, id)),
    leggiAudio: async (id) => req((await store('audio')).get(id)),
    eliminaAudio: async (id) => req((await store('audio', 'readwrite')).delete(id)),
  };
})();

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------
let timerToast;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('visibile');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => t.classList.remove('visibile'), ms);
}
const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';
const parole = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0).toLocaleString('it-IT');
const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const senzaEstensione = (n) => (n || '').replace(/\.[^.]+$/, '');
const nomeFileSicuro = (t) => (t || 'appunti').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'appunti';
const dataIt = (s) => { try { return new Date(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return s; } };

function scarica(nome, testo, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([testo], { type: tipo }));
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

function pulisciMarkdown(t) {
  t = (t || '').trim();
  const m = t.match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i);
  return m ? m[1].trim() : t;
}

function titoloDaAppunti(md) {
  const m = (md || '').match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/[*_`]/g, '').trim() : '';
}

// Markdown -> HTML sicuro, con formule KaTeX e il simbolo ⚠️ reso come nel PDF.
function renderAppunti(md) {
  const formule = [];
  const segna = (tex, display) => { formule.push({ tex, display }); return `%%KX${formule.length - 1}%%`; };
  let testo = pulisciMarkdown(md)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => segna(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => segna(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => segna(t, false))
    .replace(/(^|[^\\$\w])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?![\w$])/g, (_, pre, t) => pre + segna(t, false));
  let html = marked.parse(testo, { gfm: true });
  html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: true } });
  html = html.replace(/%%KX(\d+)%%/g, (_, i) => {
    const f = formule[+i];
    try { return katex.renderToString(f.tex, { displayMode: f.display, throwOnError: false }); } catch (_) { return f.tex; }
  });
  return html.replace(/⚠️|⚠/g, '<span class="warn">!</span>');
}

// Tipi MIME da provare per il file audio, dal più probabile.
function mimeCandidati(nome, tipo) {
  const est = (nome || '').split('.').pop().toLowerCase();
  const perEstensione = {
    m4a: ['audio/mp4', 'audio/aac', 'audio/x-m4a'],
    mp4: ['video/mp4', 'audio/mp4'],
    aac: ['audio/aac'],
    mp3: ['audio/mp3', 'audio/mpeg'],
    wav: ['audio/wav'],
    ogg: ['audio/ogg'],
    opus: ['audio/ogg', 'audio/opus'],
    flac: ['audio/flac'],
    webm: ['audio/webm', 'video/webm'],
    '3gp': ['audio/3gpp', 'video/3gpp'],
    amr: ['audio/amr'],
    mov: ['video/quicktime'],
    mkv: ['video/x-matroska'],
  };
  let c = perEstensione[est] || [];
  tipo = (tipo || '').toLowerCase();
  if (tipo && tipo !== 'application/octet-stream' && !/m4a/.test(tipo)) c = [tipo, ...c];
  if (!c.length) c = [tipo || 'audio/mpeg'];
  return [...new Set(c)];
}
const erroreFormato = (e) => e instanceof GeminiError && e.status === 400 && /mime|unsupported|not supported|format/i.test(e.message);
const fileAncoraValido = (f) => !!(f && f.uri && f.scade && Date.parse(f.scade) - Date.now() > 30 * 60 * 1000);

// Durata della registrazione in secondi, letta dal browser senza decodificare tutto il file.
function durataAudio(blob) {
  return new Promise((ok) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    let fatto = false;
    const fine = (d) => {
      if (fatto) return;
      fatto = true;
      URL.revokeObjectURL(url);
      ok(Number.isFinite(d) && d > 0 ? d : NaN);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) {
        // alcuni file non dichiarano la durata: si salta alla fine per farla calcolare
        a.ontimeupdate = () => { a.ontimeupdate = null; fine(a.duration); };
        a.currentTime = 1e7;
      } else fine(a.duration);
    };
    a.onerror = () => fine(NaN);
    setTimeout(() => fine(NaN), 20000);
    a.src = url;
  });
}

// Durata dei blocchi: abbastanza corti da stare nel limite di testo di una risposta.
function minutiBlocco(modello) {
  return Math.max(10, Math.min(30, Math.floor(((modello && modello.outputMax) || 8192) * 0.45 / 250)));
}

const normalizza = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Riduce a una sola le frasi ripetute 3+ volte di fila ("grazie grazie grazie…").
function rimuoviRipetizioni(testo, maxParole = 8) {
  const parole = testo.split(/(\s+)/); // conserva gli spazi e gli a capo
  const token = [];
  for (let i = 0; i < parole.length; i += 2) token.push({ p: parole[i], sep: parole[i + 1] || '' });
  const norm = token.map((t) => normalizza(t.p));
  const out = [];
  let i = 0;
  while (i < token.length) {
    let saltato = false;
    for (let n = 1; n <= maxParole && !saltato; n++) {
      const blocco = norm.slice(i, i + n);
      if (blocco.length < n || !blocco.some(Boolean)) continue;
      let r = 1;
      while (norm.slice(i + r * n, i + (r + 1) * n).join('\u0000') === blocco.join('\u0000')) r++;
      if (r >= 3) {
        out.push(...token.slice(i, i + n));
        i += r * n;
        saltato = true;
      }
    }
    if (!saltato) { out.push(token[i]); i++; }
  }
  return out.map((t) => t.p + t.sep).join('').trim();
}

// Gemini a volte si incastra ripetendo la stessa frase all'infinito: lo si riconosce dalla coda del testo.
function inLoop(t) {
  const coda = t.slice(-2500);
  const parole = normalizza(coda).split(' ').filter(Boolean);
  if (parole.length >= 80 && new Set(parole.slice(-80)).size <= 6) return true;
  const frasi = (coda.match(/[^.!?…]+[.!?…]+/g) || []).map(normalizza).filter((f) => f.length > 12);
  if (frasi.length >= 8) {
    const ultima = frasi[frasi.length - 1];
    if (frasi.slice(-12).filter((f) => f === ultima).length >= 6) return true;
  }
  return false;
}

// Unisce i blocchi togliendo le frasi ripetute a cavallo tra un blocco e il successivo.
function unisciParti(parti) {
  let out = '';
  for (const p of parti) {
    let t = (p.testo || '').trim();
    if (!t) continue;
    if (out) {
      const coda = normalizza(out.slice(-2000));
      let taglio = 0;
      const re = /[^.!?…]+[.!?…]+["»”]?\s*/g;
      let m;
      let controllate = 0;
      while ((m = re.exec(t)) && controllate < 6) {
        const f = normalizza(m[0]);
        if (f.length >= 15 && coda.includes(f)) taglio = re.lastIndex;
        else break;
        controllate++;
      }
      t = t.slice(taglio).trim();
    }
    if (t) out += (out ? '\n\n' : '') + t;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Navigazione
// ---------------------------------------------------------------------------
const VISTE = ['home', 'lavoro', 'lezione', 'impostazioni'];
let vistaCorrente = 'home';
let lezioneAperta = null;

function mostra(nome, titolo) {
  for (const v of VISTE) $('#v-' + v).hidden = v !== nome;
  vistaCorrente = nome;
  $('#indietro').hidden = nome === 'home';
  $('#apri-impostazioni').hidden = nome === 'impostazioni';
  $('#titolo-barra').textContent = titolo || (nome === 'impostazioni' ? 'Impostazioni' : 'Rulcio');
  window.scrollTo(0, 0);
  if (nome === 'home') aggiornaHome();
  if (nome === 'impostazioni') aggiornaImpostazioni();
}
function vai(nome, titolo) {
  if (vistaCorrente === 'home') history.pushState({ v: nome }, '');
  else history.replaceState({ v: nome }, '');
  mostra(nome, titolo);
}
function tornaHome() {
  if (history.state && history.state.v) history.back();
  else mostra('home');
}
window.addEventListener('popstate', () => mostra('home'));

// ---------------------------------------------------------------------------
// Home e archivio
// ---------------------------------------------------------------------------
async function aggiornaHome() {
  $('#benvenuto').hidden = !!Imp.chiave;
  let lezioni = [];
  try { lezioni = await DB.tutte(); } catch (_) { /* IndexedDB non disponibile */ }
  lezioni.sort((a, b) => (b.creata || '').localeCompare(a.creata || ''));
  const ul = $('#archivio');
  ul.textContent = '';
  for (const l of lezioni) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = l.titolo || senzaEstensione(l.nomeFile) || 'Lezione';
    if (lavoro && lavoro.id === l.id) t.append(badge('in corso', 'lavoro'));
    else if (l.stato === 'errore') t.append(badge('da riprendere', 'errore'));
    const m = document.createElement('span');
    m.className = 'm';
    m.textContent = [l.materia, l.data ? dataIt(l.data) : dataIt(l.creata)].filter(Boolean).join(' · ');
    b.append(t, m);
    b.onclick = () => (lavoro && lavoro.id === l.id ? vai('lavoro', 'In corso') : apriLezione(l.id));
    li.append(b);
    ul.append(li);
  }
  $('#archivio-vuoto').hidden = lezioni.length > 0;
  const materie = [...new Set(lezioni.map((l) => l.materia).filter(Boolean))];
  $('#materie').innerHTML = '';
  for (const x of materie) { const o = document.createElement('option'); o.value = x; $('#materie').append(o); }
}
function badge(testo, tipo) {
  const s = document.createElement('span');
  s.className = 'stato ' + tipo;
  s.textContent = testo;
  return s;
}

$('#audio').addEventListener('change', () => {
  const f = $('#audio').files[0];
  $('#nome-file').textContent = f ? `${f.name} (${mb(f.size)})` : 'Scegli la registrazione';
  $('#etichetta-file').classList.toggle('scelto', !!f);
});

function leggiModulo() {
  return {
    titolo: $('#titolo').value.trim(),
    materia: $('#materia').value.trim(),
    data: $('#data').value,
    termini: $('#termini').value.trim().replace(/\s*\n\s*/g, ', '),
  };
}
function svuotaModulo() {
  for (const id of ['#titolo', '#termini', '#testo-trascrizione']) $(id).value = '';
  $('#audio').value = '';
  $('#file-testo').value = '';
  $('#audio').dispatchEvent(new Event('change'));
}

$('#crea').addEventListener('click', async () => {
  if (!Imp.chiave) { toast('Prima inserisci la chiave Gemini'); vai('impostazioni'); return; }
  const f = $('#audio').files[0];
  if (!f) { toast('Scegli prima la registrazione'); return; }
  const l = {
    id: nuovoId(), creata: new Date().toISOString(), ...leggiModulo(),
    nomeFile: f.name, mime: f.type, dimensione: f.size,
    stato: 'carica', trascrizione: '', appunti: '', errore: '',
  };
  await DB.salva(l);
  try { await DB.salvaAudio(l.id, f); } catch (_) { /* senza copia locale non si potrà riprendere senza riscegliere il file */ }
  svuotaModulo();
  avvia(l, f);
});

$('#apri-testo').addEventListener('click', () => { $('#da-testo').hidden = !$('#da-testo').hidden; });
$('#file-testo').addEventListener('change', async () => {
  const f = $('#file-testo').files[0];
  if (f) $('#testo-trascrizione').value = await f.text();
});
$('#crea-da-testo').addEventListener('click', async () => {
  if (!Imp.chiave) { toast('Prima inserisci la chiave Gemini'); vai('impostazioni'); return; }
  const testo = $('#testo-trascrizione').value.trim();
  if (testo.length < 200) { toast('La trascrizione è troppo corta'); return; }
  const nomeTxt = $('#file-testo').files[0] ? $('#file-testo').files[0].name : '';
  const l = {
    id: nuovoId(), creata: new Date().toISOString(), ...leggiModulo(),
    nomeFile: nomeTxt || 'trascrizione', stato: 'appunti', trascrizione: testo, appunti: '', errore: '',
  };
  if (!l.titolo && nomeTxt) l.titolo = senzaEstensione(nomeTxt);
  await DB.salva(l);
  svuotaModulo();
  $('#da-testo').hidden = true;
  avvia(l, null);
});

// ---------------------------------------------------------------------------
// Lavoro: invio, trascrizione, appunti
// ---------------------------------------------------------------------------
let lavoro = null; // { id, controller }

function passo(nome, stato, info) {
  const li = $(`#passi [data-passo="${nome}"]`);
  li.classList.remove('attivo', 'fatto', 'errore');
  if (stato) li.classList.add(stato);
  if (info !== undefined) li.querySelector('[data-info]').textContent = info;
}
function infoPasso(nome, info) { $(`#passi [data-passo="${nome}"] [data-info]`).textContent = info; }
// Mostra da quanto si aspetta la prima risposta di Gemini; si ferma al primo testo ricevuto.
function attesaConTimer(nome, etichetta) {
  const inizio = Date.now();
  const aggiorna = () => {
    const s = Math.floor((Date.now() - inizio) / 1000);
    infoPasso(nome, `${etichetta ? etichetta + ': ' : ''}in attesa della risposta… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  };
  aggiorna();
  const t = setInterval(aggiorna, 1000);
  return () => clearInterval(t);
}
function anteprima(t) { $('#anteprima').textContent = t.length > 4000 ? '…' + t.slice(-4000) : t; }

async function tieniSchermoAcceso() {
  let blocco = null;
  const richiedi = async () => { try { if (navigator.wakeLock) blocco = await navigator.wakeLock.request('screen'); } catch (_) { /* non supportato */ } };
  const alRitorno = () => { if (document.visibilityState === 'visible' && lavoro) richiedi(); };
  await richiedi();
  document.addEventListener('visibilitychange', alRitorno);
  return () => {
    document.removeEventListener('visibilitychange', alRitorno);
    try { if (blocco) blocco.release(); } catch (_) { /* già rilasciato */ }
  };
}

async function assicuraModelli(chiave) {
  let modelli = Imp.modelli;
  if (!modelli.length) {
    modelli = ordinaModelli(await elencaModelli(chiave));
    Imp.modelli = modelli;
  }
  if (!modelli.length) throw new Error('La chiave non dà accesso a nessun modello Gemini adatto.');
  const scelto = modelli.find((m) => m.id === Imp.modello);
  const altri = modelli.filter((m) => m !== scelto);
  // un paio di "flash" e almeno un "flash-lite" come riserva, se la quota gratuita finisce
  const riserva = altri.filter((m) => /flash/.test(m.id)).slice(0, 3);
  const lite = altri.find((m) => /flash-lite/.test(m.id));
  if (lite && !riserva.includes(lite)) riserva.push(lite);
  return [...(scelto ? [scelto] : []), ...riserva];
}

// Prova i modelli in ordine. Sul limite "al minuto" aspetta e riprova lo stesso modello;
// se la quota del giorno è finita o il modello non risponde, passa al successivo.
async function conModelli(modelli, fn, { signal, onAttesa } = {}) {
  let ultimo;
  for (const m of modelli) {
    for (let tentativo = 0; ; tentativo++) {
      try {
        const r = await fn(m);
        return { ...r, modello: m.id };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        ultimo = e;
        // limite al minuto: si aspetta e si riprova; se Gemini non dice quale limite è, un solo tentativo
        if (e instanceof GeminiError && e.status === 429 && !e.giornaliero && tentativo < (e.quotaNota ? 4 : 1)) {
          const ms = e.quotaNota ? Math.min(Math.max(e.ritardoMs || 60000, 5000), 120000) : 15000;
          for (let resto = Math.ceil(ms / 1000); resto > 0; resto--) {
            if (onAttesa) onAttesa(`limite al minuto di Gemini: riprendo tra ${resto} s`);
            await attendi(1000, signal);
          }
          continue;
        }
        if (e instanceof GeminiError && e.status >= 500 && tentativo < 1) {
          await attendi(5000, signal);
          continue;
        }
        if (e instanceof GeminiError && (e.status === 429 || e.status === 404 || e.status >= 500)) {
          toast(`${m.nome || m.id}: ${e.status === 429 ? 'quota del giorno finita' : 'non disponibile'}, provo un altro modello`);
          break;
        }
        throw e;
      }
    }
  }
  throw ultimo || new Error('Nessun modello disponibile.');
}

// Per la trascrizione il "ragionamento" del modello non serve: rallenta e consuma il limite di testo.
// Si prova a spegnerlo; se il modello non accetta l'opzione, si prova la successiva e ce lo si ricorda.
const VARIANTI_PENSIERO = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
async function generaVeloce(chiave, modello, parts, opzioni) {
  const k = 'rulcio.pensiero.' + modello;
  for (let i = parseInt(leggiLS(k) || '0', 10) || 0; i < VARIANTI_PENSIERO.length; i++) {
    try {
      const r = await genera(chiave, modello, parts, { ...opzioni, thinkingConfig: VARIANTI_PENSIERO[i] || undefined });
      scriviLS(k, String(i));
      return r;
    } catch (e) {
      const ultimo = i === VARIANTI_PENSIERO.length - 1;
      if (!ultimo && e instanceof GeminiError && e.status === 400 && /think/i.test(e.message)) continue;
      throw e;
    }
  }
}

async function avvia(l, audio) {
  if (lavoro) { toast('C\'è già un lavoro in corso: aspetta che finisca'); return; }
  const controller = new AbortController();
  lavoro = { id: l.id, controller };
  lezioneAperta = l.id;
  $('#lavoro-titolo').textContent = l.titolo || senzaEstensione(l.nomeFile) || 'Nuova lezione';
  for (const p of ['carica', 'trascrivi', 'appunti']) passo(p, '', '');
  anteprima('');
  vai('lavoro', 'In corso');
  const rilascia = await tieniSchermoAcceso();
  try {
    await eseguiLavoro(l, audio, controller.signal);
    toast('Appunti pronti');
    if (vistaCorrente === 'lavoro') apriLezione(l.id);
    else aggiornaHome();
  } catch (e) {
    l.stato = 'errore';
    l.errore = e.name === 'AbortError' ? 'Annullato.' : (e.message || String(e));
    await DB.salva(l);
    for (const p of ['carica', 'trascrivi', 'appunti']) {
      if ($(`#passi [data-passo="${p}"]`).classList.contains('attivo')) passo(p, 'errore');
    }
    if (vistaCorrente === 'lavoro') apriLezione(l.id);
    else { toast('Lavoro interrotto: ' + l.errore, 6000); aggiornaHome(); }
  } finally {
    lavoro = null;
    rilascia();
  }
}

async function trascriviABlocchi(l, audio, file, chiave, modelli, signal) {
  if (l.durata === undefined || l.durata === null) {
    infoPasso('trascrivi', 'misuro la durata della registrazione…');
    l.durata = audio ? await durataAudio(audio) : NaN;
    await DB.salva(l);
  }
  const durata = Number.isFinite(l.durata) ? l.durata : NaN;
  const blocco = minutiBlocco(modelli[0]) * 60;
  const totale = Number.isFinite(durata) ? Math.max(1, Math.ceil((durata - 5) / blocco)) : 0;
  l.parti = l.parti || [];
  let inizio = l.parti.length ? l.parti[l.parti.length - 1].fine : 0;

  // Se la durata non si legge, un tetto prudente dalla dimensione del file (almeno 32 kbit/s).
  const dimensione = (audio && audio.size) || l.dimensione || 0;
  const tetto = dimensione ? Math.min(dimensione / 4000, 8 * 3600) : 8 * 3600;
  for (;;) {
    if (Number.isFinite(durata) && inizio >= durata - 5) break;
    if (!Number.isFinite(durata) && inizio >= tetto) break;
    let fine = inizio + blocco;
    if (Number.isFinite(durata) && fine > durata - 60) fine = Math.ceil(durata) + 30; // niente blocchi finali minuscoli
    const n = l.parti.length + 1;
    const etichetta = totale ? `blocco ${n} di ${totale}` : `blocco ${n}`;
    const testo = await trascriviBlocco(l, file, chiave, modelli, signal, inizio, fine, etichetta, 0);
    if (testo === null) break; // la registrazione è finita
    l.parti.push({ inizio, fine, testo });
    await DB.salva(l);
    inizio = fine;
  }
}

// Trascrive un intervallo; se il testo viene troncato o Gemini va in loop, divide a metà e riprova.
async function trascriviBlocco(l, file, chiave, modelli, signal, inizio, fine, etichetta, profondita) {
  const finestra = { inizio, fine };
  const fermaTimer = attesaConTimer('trascrivi', etichetta);
  let loop = false;
  let r;
  try {
    r = await conModelli(modelli, async (m) => {
      const interno = new AbortController();
      const inoltra = () => interno.abort();
      signal.addEventListener('abort', inoltra, { once: true });
      let ultimo = '';
      loop = false;
      try {
        const risposta = await generaVeloce(chiave, m.id, [
          { file_data: { mime_type: file.mimeType, file_uri: file.uri } },
          { text: promptTrascrizione(l.termini, finestra) },
        ], {
          maxOutputTokens: m.outputMax || undefined,
          temperature: 0.1,
          signal: interno.signal,
          onText: (t) => {
            if (!t) return;
            fermaTimer();
            ultimo = t;
            infoPasso('trascrivi', `${etichetta}: ${parole(t)} parole`);
            anteprima(t);
            if (!loop && inLoop(t)) { loop = true; interno.abort(); }
          },
        });
        return loop ? { testo: ultimo, troncato: true } : risposta;
      } catch (e) {
        if (loop && !signal.aborted) return { testo: ultimo, troncato: true };
        throw e;
      } finally {
        signal.removeEventListener('abort', inoltra);
      }
    }, { signal, onAttesa: (msg) => { fermaTimer(); infoPasso('trascrivi', `${etichetta}: ${msg}`); } });
  } finally {
    fermaTimer();
  }
  let testo = rimuoviRipetizioni(r.testo.trim());
  if (/^\[FINE\]\.?$/i.test(testo)) return null;
  testo = testo.replace(/\s*\[FINE\]\.?\s*$/i, '');
  // troncato: si divide fino a 3 volte; in loop: una volta sola, per non consumare la quota
  if (r.troncato && fine - inizio > 240 && profondita < (loop ? 1 : 3)) {
    const meta = inizio + Math.round((fine - inizio) / 2);
    const a = await trascriviBlocco(l, file, chiave, modelli, signal, inizio, meta, etichetta + ' (1ª metà)', profondita + 1);
    const b = await trascriviBlocco(l, file, chiave, modelli, signal, meta, fine, etichetta + ' (2ª metà)', profondita + 1);
    return unisciParti([{ testo: a || '' }, { testo: b || '' }]);
  }
  if (r.troncato) l.trascrizioneTroncata = true;
  l.modelloTrascrizione = r.modello;
  return testo;
}

async function eseguiLavoro(l, audio, signal) {
  const chiave = Imp.chiave;
  const modelli = await assicuraModelli(chiave);

  if (!l.trascrizione) {
    passo('carica', 'attivo', '');
    if (!audio) { try { audio = await DB.leggiAudio(l.id); } catch (_) { audio = null; } }
    const mimes = mimeCandidati(l.nomeFile, l.mime);
    let file = fileAncoraValido(l.fileGemini) ? l.fileGemini : null;
    let tentativo = file ? Math.max(0, mimes.indexOf(file.mimeType)) : 0;
    for (;;) {
      if (!file) {
        if (!audio) throw new Error('Per riprendere serve di nuovo la registrazione: sceglila qui sotto.');
        l.stato = 'carica';
        await DB.salva(l);
        const mime = mimes[tentativo];
        const f = await caricaFile(chiave, audio, mime, nomeFileSicuro(l.titolo || l.nomeFile), {
          signal,
          onProgress: (p) => infoPasso('carica', `${Math.round(p * 100)}% di ${mb(audio.size)}`),
        });
        infoPasso('carica', 'Gemini sta preparando il file…');
        const attivo = await attendiFileAttivo(chiave, f.name, { signal });
        file = { name: attivo.name, uri: attivo.uri, mimeType: attivo.mimeType || mime, scade: attivo.expirationTime };
        l.fileGemini = file;
        await DB.salva(l);
      }
      passo('carica', 'fatto', audio ? mb(audio.size) : 'già inviata');
      passo('trascrivi', 'attivo');
      l.stato = 'trascrivi';
      await DB.salva(l);
      try {
        await trascriviABlocchi(l, audio, file, chiave, modelli, signal);
        break;
      } catch (e) {
        if (erroreFormato(e) && audio && tentativo < mimes.length - 1 && !(l.parti || []).length) {
          eliminaFile(chiave, file.name);
          file = null;
          l.fileGemini = null;
          tentativo++;
          continue;
        }
        throw e;
      }
    }
    l.trascrizione = unisciParti(l.parti);
    if (!l.trascrizione) throw new Error('Gemini non ha restituito nessun testo per questa registrazione.');
    const daEliminare = l.fileGemini;
    l.fileGemini = null;
    await DB.salva(l);
    if (daEliminare) eliminaFile(chiave, daEliminare.name);
    // la copia locale dell'audio serve solo se si dovesse rifare la trascrizione
    if (!l.trascrizioneTroncata) DB.eliminaAudio(l.id).catch(() => {});
  }

  passo('carica', 'fatto');
  passo('trascrivi', 'fatto', `${parole(l.trascrizione)} parole`);
  passo('appunti', 'attivo');
  l.stato = 'appunti';
  await DB.salva(l);
  const fermaTimerAppunti = attesaConTimer('appunti');
  const r = await conModelli(modelli, (m) => genera(chiave, m.id, [{ text: promptAppunti(l) }], {
    maxOutputTokens: m.outputMax || undefined,
    temperature: 0.4,
    signal,
    onText: (t) => { if (!t) return; fermaTimerAppunti(); infoPasso('appunti', `${parole(t)} parole`); anteprima(t); },
  }), { signal, onAttesa: (msg) => { fermaTimerAppunti(); infoPasso('appunti', msg); } }).finally(fermaTimerAppunti);
  l.appunti = pulisciMarkdown(r.testo);
  l.appuntiTroncati = r.troncato;
  l.modelloAppunti = r.modello;
  if (!l.titolo) l.titolo = titoloDaAppunti(l.appunti) || senzaEstensione(l.nomeFile);
  l.stato = 'pronta';
  l.errore = '';
  await DB.salva(l);
  passo('appunti', 'fatto');
}

$('#annulla').addEventListener('click', () => {
  if (lavoro && confirm('Vuoi annullare? Quello che è già stato fatto resta salvato.')) lavoro.controller.abort();
});

// ---------------------------------------------------------------------------
// Vista lezione
// ---------------------------------------------------------------------------
async function apriLezione(id) {
  const l = await DB.leggi(id);
  if (!l) { tornaHome(); return; }
  lezioneAperta = id;
  vai('lezione', l.titolo || senzaEstensione(l.nomeFile) || 'Lezione');
  $('#pdf').hidden = !l.appunti;
  $('#scarica-md').hidden = !l.appunti;
  $('#scarica-txt').hidden = !l.trascrizione;
  $('#rigenera').hidden = !l.trascrizione || !l.appunti;

  const stato = $('#lezione-stato');
  stato.textContent = '';
  stato.hidden = true;
  const avvisi = [];
  if (l.stato === 'errore') avvisi.push(['errore', 'Non completato: ' + (l.errore || 'errore sconosciuto')]);
  if (l.trascrizioneTroncata) avvisi.push(['', 'Una parte della trascrizione è stata troncata: gli appunti potrebbero non coprire tutta la lezione. Puoi rifare la trascrizione a blocchi più piccoli.']);
  if (l.appuntiTroncati) avvisi.push(['', 'Gli appunti sono stati troncati perché troppo lunghi. Prova "Rigenera appunti".']);
  if (avvisi.length || l.stato === 'errore') {
    stato.hidden = false;
    for (const [tipo, testo] of avvisi) {
      const p = document.createElement('p');
      p.textContent = testo;
      if (tipo) p.className = 'errore-testo';
      stato.append(p);
    }
    if (l.stato === 'errore') stato.append(...pulsantiRipresa(l));
    else if (l.trascrizioneTroncata) stato.append(...pulsantiRitrascrivi(l));
  }

  const art = $('#appunti');
  if (l.appunti) {
    art.hidden = false;
    try {
      art.innerHTML = renderAppunti(l.appunti);
    } catch (e) {
      // meglio il testo semplice che una pagina bianca
      art.textContent = '';
      const p = document.createElement('p');
      p.className = 'errore-testo';
      p.textContent = 'Non riesco a impaginare gli appunti (' + e.message + '). Chiudi e riapri l\'app; intanto ecco il testo.';
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.textContent = l.appunti;
      art.append(p, pre);
    }
  } else {
    art.hidden = true;
    art.textContent = '';
  }
}

// Rifà la trascrizione da capo (a blocchi); gli appunti attuali restano finché non ci sono i nuovi.
function pulsantiRitrascrivi(l) {
  const b = document.createElement('button');
  b.className = 'primario';
  b.textContent = 'Rifai la trascrizione';
  const nota = document.createElement('p');
  nota.className = 'aiuto';
  nota.textContent = 'Se la registrazione non è più salvata nell\'app, ti verrà chiesto di sceglierla di nuovo.';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.flac,.mp4';
  input.hidden = true;
  const riparti = (f) => {
    l.trascrizione = '';
    l.parti = [];
    l.trascrizioneTroncata = false;
    l.fileGemini = null;
    if (f) { l.nomeFile = f.name; l.mime = f.type; l.dimensione = f.size; l.durata = undefined; }
    avvia(l, f || null);
  };
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try { await DB.salvaAudio(l.id, f); } catch (_) { /* si userà solo il file scelto */ }
    riparti(f);
  };
  b.onclick = async () => {
    let audio = null;
    try { audio = await DB.leggiAudio(l.id); } catch (_) { audio = null; }
    if (audio) riparti(audio);
    else { toast('Scegli di nuovo la registrazione'); input.click(); }
  };
  return [b, nota, input];
}

function pulsantiRipresa(l) {
  const nodi = [];
  const riprendi = document.createElement('button');
  riprendi.className = 'primario';
  riprendi.textContent = l.trascrizione ? 'Riprendi (scrivi gli appunti)' : 'Riprendi';
  riprendi.onclick = () => avvia(l, null);
  nodi.push(riprendi);
  if (!l.trascrizione && !fileAncoraValido(l.fileGemini)) {
    const nota = document.createElement('p');
    nota.className = 'aiuto';
    nota.textContent = 'Se la registrazione non è più disponibile sul telefono, sceglila di nuovo:';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.flac,.mp4';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      l.nomeFile = f.name; l.mime = f.type; l.dimensione = f.size;
      avvia(l, f);
    };
    nodi.push(nota, input);
  }
  return nodi;
}

$('#pdf').addEventListener('click', async () => {
  const l = await DB.leggi(lezioneAperta);
  if (!$('#appunti').textContent.trim()) { toast('Gli appunti non sono ancora pronti'); return; }
  if (leggiLS('rulcio.pdfSpiegato') !== '1') {
    const d = $('#dlg-pdf');
    d.returnValue = '';
    d.showModal();
    await new Promise((ok) => d.addEventListener('close', ok, { once: true }));
    if (d.returnValue !== 'ok') return;
    if ($('#pdf-non-mostrare').checked) scriviLS('rulcio.pdfSpiegato', '1');
  }
  const titoloPagina = document.title;
  document.title = nomeFileSicuro(l.titolo);
  window.print();
  setTimeout(() => { document.title = titoloPagina; }, 1500);
});
$('#scarica-md').addEventListener('click', async () => {
  const l = await DB.leggi(lezioneAperta);
  scarica(nomeFileSicuro(l.titolo) + '.md', l.appunti, 'text/markdown;charset=utf-8');
});
$('#scarica-txt').addEventListener('click', async () => {
  const l = await DB.leggi(lezioneAperta);
  scarica(nomeFileSicuro(l.titolo) + ' - trascrizione.txt', l.trascrizione, 'text/plain;charset=utf-8');
});
$('#rigenera').addEventListener('click', async () => {
  const l = await DB.leggi(lezioneAperta);
  if (!confirm('Riscrivere gli appunti da capo? Quelli attuali verranno sostituiti quando i nuovi saranno pronti.')) return;
  avvia(l, null);
});
$('#elimina').addEventListener('click', async () => {
  if (lavoro && lavoro.id === lezioneAperta) { toast('Prima annulla il lavoro in corso'); return; }
  if (!confirm('Eliminare questa lezione dal telefono?')) return;
  await DB.elimina(lezioneAperta);
  tornaHome();
});

// ---------------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------------
function aggiornaImpostazioni() {
  $('#chiave').value = Imp.chiave;
  const sel = $('#modello');
  sel.length = 1;
  for (const m of Imp.modelli) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.nome && m.nome !== m.id ? `${m.nome} (${m.id})` : m.id;
    sel.append(o);
  }
  sel.value = Imp.modelli.some((m) => m.id === Imp.modello) ? Imp.modello : '';
  $('#versione').textContent = 'Rulcio ' + VERSIONE;
}

$('#verifica').addEventListener('click', async () => {
  const chiave = $('#chiave').value.trim();
  const esito = $('#esito-chiave');
  if (!chiave) { esito.textContent = 'Incolla prima la chiave.'; return; }
  esito.textContent = 'Verifico…';
  $('#verifica').disabled = true;
  try {
    const modelli = ordinaModelli(await elencaModelli(chiave));
    if (!modelli.length) throw new Error('La chiave funziona, ma non dà accesso a modelli Gemini adatti.');
    Imp.chiave = chiave;
    Imp.modelli = modelli;
    aggiornaImpostazioni();
    esito.textContent = `Chiave valida. Modello principale: ${modelli[0].nome || modelli[0].id}.`;
    toast('Chiave salvata');
  } catch (e) {
    esito.textContent = e.message || 'Verifica non riuscita.';
  } finally {
    $('#verifica').disabled = false;
  }
});
$('#modello').addEventListener('change', () => { Imp.modello = $('#modello').value; });

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-vai]').forEach((b) => b.addEventListener('click', () => vai(b.dataset.vai)));
$('#apri-impostazioni').addEventListener('click', () => vai('impostazioni'));
$('#indietro').addEventListener('click', tornaHome);

(async function avvio() {
  $('#data').value = new Date().toISOString().slice(0, 10);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) { /* facoltativo */ }
  // Un lavoro rimasto a metà (app chiusa o ricaricata) diventa "da riprendere".
  try {
    for (const l of await DB.tutte()) {
      if (['carica', 'trascrivi', 'appunti'].includes(l.stato)) {
        l.stato = 'errore';
        l.errore = 'Interrotto (l\'app è stata chiusa o il telefono ha sospeso il lavoro).';
        await DB.salva(l);
      }
    }
  } catch (_) { /* archivio non disponibile */ }
  mostra('home');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
