'use strict';

const VERSIONE = '1.0.0';
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

async function conModelli(modelli, fn) {
  let ultimo;
  for (const m of modelli) {
    try {
      const r = await fn(m);
      return { ...r, modello: m.id };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      ultimo = e;
      if (e instanceof GeminiError && (e.status === 429 || e.status === 404 || e.status >= 500)) {
        toast(`${m.nome || m.id}: ${e.status === 429 ? 'quota finita' : 'non disponibile'}, provo un altro modello`);
        continue;
      }
      throw e;
    }
  }
  throw ultimo || new Error('Nessun modello disponibile.');
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
      passo('trascrivi', 'attivo', 'in attesa della risposta…');
      l.stato = 'trascrivi';
      await DB.salva(l);
      try {
        const r = await conModelli(modelli, (m) => genera(chiave, m.id, [
          { file_data: { mime_type: file.mimeType, file_uri: file.uri } },
          { text: promptTrascrizione(l.termini) },
        ], {
          maxOutputTokens: m.outputMax || undefined,
          temperature: 0.1,
          signal,
          onText: (t) => { infoPasso('trascrivi', `${parole(t)} parole`); anteprima(t); },
        }));
        l.trascrizione = r.testo.trim();
        l.trascrizioneTroncata = r.troncato;
        l.modelloTrascrizione = r.modello;
        break;
      } catch (e) {
        if (erroreFormato(e) && audio && tentativo < mimes.length - 1) {
          eliminaFile(chiave, file.name);
          file = null;
          l.fileGemini = null;
          tentativo++;
          continue;
        }
        throw e;
      }
    }
    const daEliminare = l.fileGemini;
    l.fileGemini = null;
    await DB.salva(l);
    if (daEliminare) eliminaFile(chiave, daEliminare.name);
    DB.eliminaAudio(l.id).catch(() => {});
  }

  passo('carica', 'fatto');
  passo('trascrivi', 'fatto', `${parole(l.trascrizione)} parole`);
  passo('appunti', 'attivo', 'in attesa della risposta…');
  l.stato = 'appunti';
  await DB.salva(l);
  const r = await conModelli(modelli, (m) => genera(chiave, m.id, [{ text: promptAppunti(l) }], {
    maxOutputTokens: m.outputMax || undefined,
    temperature: 0.4,
    signal,
    onText: (t) => { infoPasso('appunti', `${parole(t)} parole`); anteprima(t); },
  }));
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
  if (l.trascrizioneTroncata) avvisi.push(['', 'La trascrizione è stata troncata perché troppo lunga: gli appunti potrebbero non coprire la fine della lezione.']);
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
  }

  const art = $('#appunti');
  if (l.appunti) {
    art.hidden = false;
    art.innerHTML = renderAppunti(l.appunti);
  } else {
    art.hidden = true;
    art.textContent = '';
  }
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
