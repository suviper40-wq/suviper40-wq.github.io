'use strict';

const VERSIONE = '1.7.0';
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
    const r = indexedDB.open('rulcio', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('lezioni')) db.createObjectStore('lezioni', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('slide')) db.createObjectStore('slide');
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
      await req((await store('slide', 'readwrite')).delete(id));
    },
    salvaSlide: async (id, blob) => req((await store('slide', 'readwrite')).put(blob, id)),
    leggiSlide: async (id) => req((await store('slide')).get(id)),
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

// Orari "[MM:SS]" o "[H:MM:SS]" che Gemini scrive all'inizio dei paragrafi.
const RE_ORARIO = /\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]/g;
const secondiDa = (h, m, s) => (+(h || 0)) * 3600 + (+m) * 60 + (+s);
function ultimoOrario(t) {
  let x = null;
  for (const m of t.matchAll(RE_ORARIO)) x = secondiDa(m[1], m[2], m[3]);
  return x;
}

// Tiene solo i paragrafi il cui orario cade nel blocco e toglie gli orari dal testo.
// Se Gemini ha trascritto tutta la registrazione invece del solo blocco, il resto viene scartato.
function filtraFinestra(testo, inizio, fine) {
  const segmenti = [];
  let t = null;
  let da = 0;
  for (const m of testo.matchAll(RE_ORARIO)) {
    if (m.index > da) segmenti.push({ t, testo: testo.slice(da, m.index) });
    t = secondiDa(m[1], m[2], m[3]);
    da = m.index + m[0].length;
  }
  segmenti.push({ t, testo: testo.slice(da) });
  const conOrario = segmenti.filter((s) => s.t !== null);
  if (!conOrario.length) return { testo: testo.trim(), orari: false };
  // orari contati dall'inizio del blocco invece che del file: si spostano
  const dentro = (x) => x >= inizio - 20 && x < fine + 5;
  if (!conOrario.some((s) => dentro(s.t)) && Math.max(...conOrario.map((s) => s.t)) <= fine - inizio + 60) {
    for (const s of segmenti) if (s.t !== null) s.t += inizio;
  }
  const primo = segmenti.find((s) => s.t !== null).t;
  const tenuti = segmenti.filter((s) => (s.t === null ? dentro(primo) : dentro(s.t)));
  return {
    testo: tenuti.map((s) => s.testo.trim()).filter(Boolean).join('\n\n'),
    orari: true,
    scartati: segmenti.length - tenuti.length,
  };
}

// Parole plausibili per un intervallo: un docente veloce arriva a circa 200 parole al minuto.
const paroleMassime = (inizio, fine) => Math.round(((fine - inizio) / 60) * 220 + 150);
const contaParole = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

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
  $('#slide').value = '';
  $('#audio').dispatchEvent(new Event('change'));
}

// Slide facoltative (PDF): restano sul telefono e vengono mandate a Gemini solo per gli appunti.
const MAX_SLIDE = 50 * 1024 * 1024;
function slideValide(f) {
  if (!f) return null;
  if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { toast('Le slide devono essere un PDF (esportale in PDF da PowerPoint)'); return false; }
  if (f.size > MAX_SLIDE) { toast('Il PDF delle slide supera 50 MB: non verrà usato'); return false; }
  return f;
}
async function allegaSlide(l, f) {
  try {
    await DB.salvaSlide(l.id, f);
    l.nomeSlide = f.name;
    l.fileSlide = null;
  } catch (_) { toast('Non riesco a salvare le slide sul telefono'); }
}

$('#crea').addEventListener('click', async () => {
  if (!Imp.chiave) { toast('Prima inserisci la chiave Gemini'); vai('impostazioni'); return; }
  const f = $('#audio').files[0];
  if (!f) { toast('Scegli prima la registrazione'); return; }
  const s = slideValide($('#slide').files[0]);
  if (s === false) return;
  const l = {
    id: nuovoId(), creata: new Date().toISOString(), ...leggiModulo(),
    nomeFile: f.name, mime: f.type, dimensione: f.size,
    stato: 'carica', trascrizione: '', appunti: '', errore: '',
  };
  if (s) await allegaSlide(l, s);
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
  const s = slideValide($('#slide').files[0]);
  if (s === false) return;
  const l = {
    id: nuovoId(), creata: new Date().toISOString(), ...leggiModulo(),
    nomeFile: nomeTxt || 'trascrizione', stato: 'appunti', trascrizione: testo, appunti: '', errore: '',
  };
  if (!l.titolo && nomeTxt) l.titolo = senzaEstensione(nomeTxt);
  if (s) await allegaSlide(l, s);
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

// Google azzera le quote giornaliere a mezzanotte, ora del Pacifico.
const giornoQuota = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
const esaurito = (m) => leggiLS('rulcio.esaurito.' + m.id) === giornoQuota();
const segnaEsaurito = (id) => scriviLS('rulcio.esaurito.' + id, giornoQuota());

// Un elenco di modelli per ogni compito. La trascrizione usa Flash (basta, e ha più quota);
// gli appunti provano prima Pro, che scrive meglio, e ne consumano una sola richiesta per lezione.
async function assicuraModelli(chiave) {
  let modelli = Imp.modelli;
  if (!modelli.length) {
    modelli = ordinaModelli(await elencaModelli(chiave));
    Imp.modelli = modelli;
  }
  if (!modelli.length) throw new Error('La chiave non dà accesso a nessun modello Gemini adatto.');
  const disponibili = modelli.filter((m) => !esaurito(m));
  const lista = disponibili.length ? disponibili : modelli;
  const pro = lista.filter((m) => /pro/.test(m.id) && !/flash/.test(m.id));
  const flash = lista.filter((m) => /flash/.test(m.id) && !/lite/.test(m.id));
  const lite = lista.filter((m) => /flash-lite/.test(m.id));
  const scelto = lista.find((m) => m.id === Imp.modello);
  const primo = (arr, m) => (m ? [m, ...arr.filter((x) => x !== m)] : arr);
  const veloci = [...flash.slice(0, 3), ...lite.slice(0, 1)];
  const base = veloci.length ? veloci : lista.slice(0, 4);
  // La trascrizione usa solo Flash: Flash-Lite non rispetta bene i blocchi di tempo e ripete testo.
  // Se la quota di Flash è finita l'elenco resta vuoto e il lavoro si ferma (si riprende il giorno dopo).
  const esisteFlash = modelli.some((m) => /flash/.test(m.id) && !/lite/.test(m.id));
  const flashLiberi = modelli.filter((m) => /flash/.test(m.id) && !/lite/.test(m.id) && !esaurito(m)).slice(0, 3);
  const perTrascrivere = esisteFlash ? flashLiberi : base;
  return {
    trascrizione: primo(perTrascrivere, scelto && perTrascrivere.includes(scelto) ? scelto : null),
    appunti: primo([...pro.slice(0, 2), ...base], scelto),
    controllo: [...pro.slice(0, 2), ...base], // il controllo è il passaggio che decide la fedeltà: meglio Pro
  };
}

const MSG_QUOTA = 'La quota gratuita di oggi di Gemini è finita. Riprova domani dopo le 9 (ora italiana): il lavoro fatto finora resta salvato.';
const MSG_QUOTA_FLASH = 'La quota gratuita di oggi di Gemini Flash è finita (Flash-Lite non si usa per trascrivere: sbaglia troppo). Riprova domani dopo le 9 (ora italiana): il lavoro fatto finora resta salvato.';
const nomeModello = (m) => (m.nome || m.id).replace(/^Gemini\s+/i, 'Gemini ');

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
        if (e instanceof GeminiError && e.status === 429) segnaEsaurito(m.id);
        if (e instanceof GeminiError && (e.status === 429 || e.status === 404 || e.status >= 500)) {
          toast(`${m.nome || m.id}: ${e.status === 429 ? 'quota del giorno finita' : 'non disponibile'}, provo un altro modello`);
          break;
        }
        throw e;
      }
    }
  }
  if (ultimo instanceof GeminiError && ultimo.status === 429) throw new Error(MSG_QUOTA);
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
  for (const p of ['carica', 'trascrivi', 'appunti', 'controllo']) passo(p, '', '');
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
    for (const p of ['carica', 'trascrivi', 'appunti', 'controllo']) {
      if ($(`#passi [data-passo="${p}"]`).classList.contains('attivo')) passo(p, 'errore');
    }
    if (vistaCorrente === 'lavoro') apriLezione(l.id);
    else { toast('Lavoro interrotto: ' + l.errore, 6000); aggiornaHome(); }
  } finally {
    lavoro = null;
    rilascia();
  }
}

// Carica su Gemini il PDF delle slide (se c'è); un problema con le slide non blocca gli appunti.
async function preparaSlide(l, chiave, signal) {
  if (!l.nomeSlide) return null;
  if (fileAncoraValido(l.fileSlide)) return l.fileSlide;
  let blob = null;
  try { blob = await DB.leggiSlide(l.id); } catch (_) { blob = null; }
  if (!blob) return null;
  try {
    const f = await caricaFile(chiave, blob, 'application/pdf', nomeFileSicuro(l.nomeSlide), {
      signal,
      onProgress: (p) => infoPasso('appunti', `invio delle slide… ${Math.round(p * 100)}%`),
    });
    infoPasso('appunti', 'Gemini sta leggendo le slide…');
    const a = await attendiFileAttivo(chiave, f.name, { signal });
    l.fileSlide = { name: a.name, uri: a.uri, scade: a.expirationTime };
    await DB.salva(l);
    return l.fileSlide;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    toast('Slide non usate: ' + (e.message || e), 6000);
    return null;
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
  const massimo = paroleMassime(inizio, fine);
  let loop = false;
  let oltre = false;
  let eccesso = false;
  let r;
  try {
    r = await conModelli(modelli, async (m) => {
      const interno = new AbortController();
      const inoltra = () => interno.abort();
      signal.addEventListener('abort', inoltra, { once: true });
      let ultimo = '';
      loop = false;
      oltre = false;
      eccesso = false;
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
            infoPasso('trascrivi', `${etichetta} · ${nomeModello(m)}: ${parole(t)} parole`);
            anteprima(t);
            if (loop || oltre) return;
            const orario = ultimoOrario(t);
            // Gemini è andato oltre la fine del blocco: basta così, il resto lo fa il blocco successivo
            if (orario !== null && orario > fine + 60) { oltre = true; interno.abort(); return; }
            // troppe parole per il tempo del blocco: sta trascrivendo altro (o ripetendo)
            if (contaParole(t) > massimo * (orario === null ? 1.5 : 4)) { oltre = true; eccesso = true; interno.abort(); return; }
            if (inLoop(t)) { loop = true; interno.abort(); }
          },
        });
        if (loop) return { testo: ultimo, troncato: true };
        if (oltre) return { testo: ultimo, troncato: false };
        return risposta;
      } catch (e) {
        if (loop && !signal.aborted) return { testo: ultimo, troncato: true };
        if (oltre && !signal.aborted) return { testo: ultimo, troncato: false };
        throw e;
      } finally {
        signal.removeEventListener('abort', inoltra);
      }
    }, { signal, onAttesa: (msg) => { fermaTimer(); infoPasso('trascrivi', `${etichetta}: ${msg}`); } });
  } finally {
    fermaTimer();
  }
  let grezzo = r.testo.trim();
  if (/^\[FINE\]\.?$/i.test(grezzo)) return null;
  grezzo = grezzo.replace(/\s*\[FINE\]\.?\s*$/i, '');
  const filtrato = filtraFinestra(grezzo, inizio, fine);
  let testo = rimuoviRipetizioni(filtrato.testo);
  // Senza orari non si può filtrare: se le parole sono troppe per il tempo del blocco, dividerlo non
  // servirebbe (Gemini ignora l'intervallo) e consumerebbe quota. Si tiene una lunghezza plausibile e
  // si segnala la lezione, che si potrà ritrascrivere.
  if (!filtrato.orari && (eccesso || contaParole(testo) > massimo * 1.5)) {
    const frasi = testo.match(/[^.!?…]+[.!?…]+["»”]?\s*|[^.!?…]+$/g) || [testo];
    let tenuto = '';
    for (const f of frasi) {
      if (contaParole(tenuto + f) > massimo) break;
      tenuto += f;
    }
    testo = tenuto.trim() || testo.split(/\s+/).slice(0, massimo).join(' ');
    l.trascrizioneTroncata = true;
    l.modelloTrascrizione = r.modello;
    return testo;
  }
  if (filtrato.orari && !testo && !loop) {
    // nessun paragrafo dentro il blocco: si segnala, la lezione si potrà ritrascrivere
    l.trascrizioneTroncata = true;
    return '';
  }
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
    if (!modelli.trascrizione.length) throw new Error(MSG_QUOTA_FLASH);
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
        await trascriviABlocchi(l, audio, file, chiave, modelli.trascrizione, signal);
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
    // controllo di plausibilità: troppe parole per la durata = testo ripetuto o inventato
    l.trascrizioneSospetta = Number.isFinite(l.durata) && contaParole(l.trascrizione) > paroleMassime(0, l.durata) * 1.2;
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
  const slide = await preparaSlide(l, chiave, signal);
  const allegati = slide ? [{ file_data: { mime_type: 'application/pdf', file_uri: slide.uri } }] : [];
  const fermaTimerAppunti = attesaConTimer('appunti');
  const r = await conModelli(modelli.appunti, (m) => genera(chiave, m.id, [...allegati, { text: promptAppunti(l, !!slide) }], {
    maxOutputTokens: m.outputMax || undefined,
    temperature: 0.2,
    signal,
    onText: (t) => { if (!t) return; fermaTimerAppunti(); infoPasso('appunti', `${nomeModello(m)}: ${parole(t)} parole`); anteprima(t); },
  }), { signal, onAttesa: (msg) => { fermaTimerAppunti(); infoPasso('appunti', msg); } }).finally(fermaTimerAppunti);
  l.appunti = pulisciMarkdown(r.testo);
  l.appuntiTroncati = r.troncato;
  l.modelloAppunti = r.modello;
  l.slideUsate = !!slide;
  if (!l.titolo) l.titolo = titoloDaAppunti(l.appunti) || senzaEstensione(l.nomeFile);
  l.controllo = null;
  l.stato = 'controllo';
  await DB.salva(l);
  passo('appunti', 'fatto', `${parole(l.appunti)} parole`);

  // Controllo: un secondo passaggio confronta gli appunti con la trascrizione e corregge
  // ciò che non torna. Se non riesce, gli appunti restano comunque (non controllati).
  passo('controllo', 'attivo');
  const fermaTimerControllo = attesaConTimer('controllo');
  try {
    const c = await conModelli(modelli.controllo, (m) => generaJSON(chiave, m.id, [...allegati, { text: promptControllo(l, !!slide) }], SCHEMA_CONTROLLO, {
      maxOutputTokens: m.outputMax || undefined,
      signal,
      onText: (t) => { if (!t) return; fermaTimerControllo(); infoPasso('controllo', `${nomeModello(m)}: confronto con la trascrizione…`); },
    }), { signal, onAttesa: (msg) => { fermaTimerControllo(); infoPasso('controllo', msg); } });
    const esito = applicaCorrezioni(l.appunti, (c.json && c.json.correzioni) || []);
    l.appunti = esito.testo;
    l.controllo = { applicate: esito.applicate, saltate: esito.saltate, modello: c.modello };
    passo('controllo', 'fatto', `${esito.applicate.length} correzioni`);
  } catch (e) {
    l.controllo = { errore: e.name === 'AbortError' ? 'annullato' : (e.message || String(e)) };
    passo('controllo', 'errore', 'non eseguito');
  } finally {
    fermaTimerControllo();
  }
  l.stato = 'pronta';
  l.errore = '';
  await DB.salva(l);
}

const SCHEMA_CONTROLLO = {
  type: 'OBJECT',
  properties: {
    correzioni: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { trova: { type: 'STRING' }, sostituisci: { type: 'STRING' }, motivo: { type: 'STRING' } },
        required: ['trova', 'sostituisci', 'motivo'],
      },
    },
  },
  required: ['correzioni'],
};

// Chiede una risposta JSON; se il modello non accetta lo schema, lo chiede solo a parole.
async function generaJSON(chiave, modello, parts, schema, opzioni) {
  const leggi = (testo) => {
    const t = testo.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const i = t.indexOf('{');
    const j = t.lastIndexOf('}');
    if (i < 0 || j < i) throw new GeminiError('Risposta del controllo non leggibile.');
    return JSON.parse(t.slice(i, j + 1));
  };
  let r;
  try {
    r = await genera(chiave, modello, parts, {
      ...opzioni, temperature: 0, extraConfig: { responseMimeType: 'application/json', responseSchema: schema },
    });
  } catch (e) {
    if (!(e instanceof GeminiError && e.status === 400)) throw e;
    r = await genera(chiave, modello, parts, { ...opzioni, temperature: 0 });
  }
  return { ...r, json: leggi(r.testo) };
}

// Applica le correzioni del controllo solo dove il testo da cambiare si trova davvero negli appunti.
function applicaCorrezioni(md, correzioni) {
  let testo = md;
  const applicate = [];
  let saltate = 0;
  const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const c of correzioni.slice(0, 100)) {
    const trova = String((c && c.trova) || '').trim();
    const sost = String((c && c.sostituisci) || '').trim();
    const titolo = /^#{1,6}\s/;
    if (!trova || trova === sost || trova.length > 3000 || sost.length > trova.length * 2 + 300 ||
        (titolo.test(trova) && !titolo.test(sost))) { saltate++; continue; }
    let i = testo.indexOf(trova);
    let lung = trova.length;
    if (i < 0) {
      const m = new RegExp(trova.split(/\s+/).map(escapeRe).join('\\s+')).exec(testo);
      if (m) { i = m.index; lung = m[0].length; }
    }
    if (i < 0) { saltate++; continue; }
    testo = testo.slice(0, i) + sost + testo.slice(i + lung);
    applicate.push({ prima: trova, dopo: sost, motivo: String((c && c.motivo) || '') });
  }
  // un titolo ## o ### rimasto senza contenuto (es. la sua unica frase era inventata) si toglie
  const righe = testo.split('\n');
  const livello = (r) => { const m = /^(#{1,6})\s/.exec(r); return m ? m[1].length : 0; };
  const tenute = righe.filter((r, i) => {
    const lv = livello(r);
    if (lv < 2) return true;
    let j = i + 1;
    while (j < righe.length && !righe[j].trim()) j++;
    return !(j >= righe.length || (livello(righe[j]) && livello(righe[j]) <= lv));
  });
  return { testo: tenute.join('\n').replace(/\n{3,}/g, '\n\n'), applicate, saltate };
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
  if (l.trascrizioneSospetta) avvisi.push(['', `La trascrizione ha ${parole(l.trascrizione)} parole, troppe per ${Math.round(l.durata / 60)} minuti di lezione: probabilmente contiene parti ripetute. Conviene rifarla.`]);
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
    else if (l.trascrizioneTroncata || l.trascrizioneSospetta) stato.append(...pulsantiRitrascrivi(l));
  }

  mostraControllo(l);
  mostraSlide(l);
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

// Riquadro delle slide: si possono aggiungere o cambiare anche dopo, poi si preme Rigenera.
function mostraSlide(l) {
  $('#slide-box').hidden = !l.trascrizione;
  $('#slide-stato').textContent = l.nomeSlide
    ? `Slide: ${l.nomeSlide}${l.appunti && !l.slideUsate ? ' (non ancora usate: premi Rigenera)' : ''}`
    : 'Nessuna slide allegata.';
  $('#slide-cambia').textContent = l.nomeSlide ? 'Cambia slide' : 'Aggiungi slide (PDF)';
}
$('#slide-cambia').addEventListener('click', () => $('#slide-lezione').click());
$('#slide-lezione').addEventListener('change', async () => {
  const f = slideValide($('#slide-lezione').files[0]);
  $('#slide-lezione').value = '';
  if (!f) return;
  const l = await DB.leggi(lezioneAperta);
  await allegaSlide(l, f);
  l.slideUsate = false;
  await DB.salva(l);
  mostraSlide(l);
  toast('Slide allegate: premi "Rigenera" per rifare gli appunti con le slide', 5000);
});

// Riquadro con le correzioni fatte dal controllo, per vedere cosa è cambiato e perché.
function mostraControllo(l) {
  const box = $('#controllo-box');
  const elenco = $('#controllo-elenco');
  elenco.textContent = '';
  box.open = false;
  if (!l.appunti || !l.controllo) { box.hidden = true; return; }
  box.hidden = false;
  if (l.controllo.errore) {
    $('#controllo-titolo').textContent = 'Controllo non eseguito';
    const p = document.createElement('p');
    p.className = 'aiuto';
    p.textContent = `Gli appunti non sono stati ricontrollati (${l.controllo.errore}). Puoi premere "Rigenera" più tardi.`;
    elenco.append(p);
    return;
  }
  const n = l.controllo.applicate.length;
  $('#controllo-titolo').textContent = n ? `Controllo: ${n} ${n === 1 ? 'correzione' : 'correzioni'} rispetto alla trascrizione` : 'Controllo: nessuna correzione necessaria';
  for (const c of l.controllo.applicate) {
    const d = document.createElement('div');
    d.className = 'correzione';
    const m = document.createElement('div');
    m.className = 'motivo';
    m.textContent = c.motivo || 'Correzione';
    const prima = document.createElement('del');
    prima.textContent = c.prima;
    const dopo = document.createElement('ins');
    dopo.textContent = c.dopo || '(tolto)';
    d.append(m, prima, document.createElement('br'), dopo);
    elenco.append(d);
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
    l.trascrizioneSospetta = false;
    if (f && f.name && f.name !== l.nomeFile) { // un file diverso: va rimandato e rimisurato
      l.fileGemini = null;
      l.nomeFile = f.name; l.mime = f.type; l.dimensione = f.size; l.durata = undefined;
    }
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
    if (audio || fileAncoraValido(l.fileGemini)) riparti(audio);
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
  // blocchi già trascritti ma forse sbagliati (es. prima di un aggiornamento): si può ripartire da zero
  if ((l.parti || []).length || l.trascrizione) {
    const [ricomincia, notaR, inputR] = pulsantiRitrascrivi(l);
    ricomincia.className = 'secondario';
    ricomincia.textContent = 'Rifai la trascrizione da capo';
    nodi.push(document.createTextNode(' '), ricomincia, notaR, inputR);
  }
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
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) { /* facoltativo */ }
  // Un lavoro rimasto a metà (app chiusa o ricaricata) diventa "da riprendere".
  try {
    for (const l of await DB.tutte()) {
      if (['carica', 'trascrivi', 'appunti', 'controllo'].includes(l.stato)) {
        l.stato = 'errore';
        l.errore = 'Interrotto (l\'app è stata chiusa o il telefono ha sospeso il lavoro).';
        await DB.salva(l);
      }
    }
  } catch (_) { /* archivio non disponibile */ }
  mostra('home');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
