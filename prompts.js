// Istruzioni inviate al modello. Sono le stesse regole di ISTRUZIONI_APPUNTI.md.

// Secondi -> "MM:SS" (sotto l'ora) oppure "H:MM:SS".
function orario(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}

function promptTrascrizione(termini, finestra) {
  const parte = finestra ? `
IMPORTANTE: la registrazione viene trascritta a blocchi. Trascrivi SOLO il blocco da ${orario(finestra.inizio)} a ${orario(finestra.fine)} (dal minuto ${Math.floor(finestra.inizio / 60)} al minuto ${Math.ceil(finestra.fine / 60)}).
- Comincia dalla prima frase che inizia a ${orario(finestra.inizio)} o subito dopo; finisci con la frase che è in corso a ${orario(finestra.fine)}.
- Non trascrivere nulla di ciò che viene prima o dopo: gli altri blocchi vengono trascritti separatamente.
- Se la registrazione finisce prima di ${orario(finestra.inizio)}, rispondi soltanto [FINE].
` : '';
  return `Trascrivi questa registrazione di una lezione universitaria in italiano.
${parte}
Regole:
- Trascrivi in modo fedele e completo tutto ciò che dice il docente. Non riassumere e non saltare parti.
- Includi le domande degli studenti rivolte al docente. Ometti invece le conversazioni private di sottofondo tra studenti (es. durante le pause).
- Scrivi in italiano corretto, dividendo il testo in paragrafi. Niente timestamp, niente titoli, niente commenti tuoi.
- Correggi solo gli errori evidenti di pronuncia dei termini tecnici e dei nomi propri.
- Se un passaggio è davvero incomprensibile, scrivi [incomprensibile].
${termini ? `\nTermini che compaiono nella lezione (usa questa grafia): ${termini}.\n` : ''}
Rispondi solo con la trascrizione.`;
}

function promptAppunti({ titolo, materia, data, termini, trascrizione, durata }) {
  const parole = (trascrizione || '').trim().split(/\s+/).length;
  const minuti = Number.isFinite(durata) && durata > 0 ? Math.round(durata / 60) : Math.round(parole / 110);
  const obiettivo = Math.max(1500, Math.round(Math.max(minuti * 30, parole * 0.3) / 100) * 100);
  return `Sei un tutor universitario. Dalla trascrizione di una lezione devi scrivere gli appunti con cui uno studente studierà per l'esame.

COMPLETEZZA: APPUNTI, NON UN RIASSUNTO
- La lezione dura circa ${minuti} minuti. Gli appunti devono coprire TUTTI gli argomenti e i passaggi spiegati, con lo stesso livello di dettaglio del docente: indicativamente almeno ${obiettivo} parole (di più se la lezione è densa). Non condensare.
- Riporta TUTTI i dati che il docente dice: valori numerici con unità di misura (lunghezze d'onda, tempi, dimensioni, distanze, frequenze), nomi, sigle con il loro significato, esempi, esperimenti e casi clinici o applicativi.
- Ogni volta che il docente dice o fa capire che una cosa sarà chiesta all'esame ("lo chiedo", "mettetelo", "ricordatevi", "domanda aperta/multipla", "questo non vi sarà chiesto"), riportalo: ⚠️ per ciò che chiederà, e una nota esplicita per ciò che ha escluso.
- Se il docente si esprime in modo impreciso o scorretto, riporta ciò che ha detto e aggiungi la correzione come *(nota: ...)*.
- FEDELTÀ: ogni affermazione deve trovare riscontro nella trascrizione. Non aggiungere dettagli, aggettivi, numeri, date, nomi o esempi che il docente non ha detto, anche se ti sembrano plausibili o utili.
- Non correggere mai in silenzio: se un dato del docente ti sembra sbagliato, riporta il suo e aggiungi la correzione in una *(nota: ...)*.

STILE: DISCORSIVO, NON A ELENCHI PUNTATI
- Scrivi in prosa, con paragrafi che spiegano e collegano i concetti, come un buon libro di testo o degli appunti ben scritti. Mantieni il ragionamento del docente (perché, come, cosa ne consegue), non ridurlo a parole chiave.
- NON usare elenchi puntati, a meno che il contenuto sia davvero un elenco di cose parallele (es. i passaggi di un procedimento). Nel dubbio, scrivi in prosa.
- Usa le tabelle solo per confronti veri (es. A vs B) o dati numerici, sempre in aggiunta al testo e non al posto suo.
- Usa il grassetto per termini e definizioni chiave, con misura.

PULIZIA
- Elimina riempitivi, ripetizioni, battute, digressioni e chiacchiere. Raccogli invece in una sezione "## Info pratiche", subito dopo l'indice, tutto ciò che riguarda l'organizzazione: date d'esame, modalità delle domande, materiale (slide, libro, piattaforme), argomenti esclusi dal programma, avvisi (ometti la sezione solo se non c'è davvero nulla).
- Correggi gli errori di trascrizione, soprattutto termini tecnici, nomi propri e formule. Se un passaggio è incomprensibile o dubbio, scrivi **[?]** invece di inventare.
- Non aggiungere contenuti che il docente non ha detto. Se aggiungi un chiarimento o correggi un'imprecisione del docente, segnalo come *(nota: ...)*.

FORMATO (Markdown)
1. "# " seguito dal titolo della lezione (ricavalo dagli argomenti), poi una riga con materia e data se note, poi un breve paragrafo di sintesi.
2. "## Indice" con gli argomenti (qui la lista numerata va bene).
3. Una sezione "## " per ogni argomento, nell'ordine della lezione, scritta in prosa. Sottosezioni "### " se servono.
4. Formule in LaTeX: $$...$$ su riga propria per quelle importanti, $...$ nel testo, spiegando il significato dei simboli.
5. Quando il docente dice che un argomento sarà chiesto all'esame, segnalo con ⚠️ all'inizio della frase o del titolo.
6. Se il docente descrive uno schema o un grafico importante e ridisegnarlo aiuta davvero, puoi inserirlo come SVG semplice (viewBox, linee, frecce, testo leggibile), altrimenti descrivilo a parole.
7. "## Riepilogo": pochi paragrafi brevi con ciò che va ricordato.
8. "## Domande di ripasso": 5-8 domande sugli argomenti segnalati per l'esame (lista numerata).
9. Rileggi prima di rispondere: niente refusi, niente parole spezzate.

Rispondi solo con gli appunti in Markdown, senza premesse e senza blocchi di codice attorno.

DATI DELLA LEZIONE
Titolo indicato dallo studente: ${titolo || '(nessuno)'}
Materia: ${materia || '(non indicata)'}
Data: ${data || '(non indicata)'}
Termini tecnici indicati: ${termini || '(nessuno)'}

TRASCRIZIONE
${trascrizione}`;
}

function promptControllo({ trascrizione, appunti }) {
  return `Sei un revisore scientifico molto attento. Ti do la TRASCRIZIONE di una lezione universitaria e gli APPUNTI scritti a partire da essa. Confronta gli appunti con la trascrizione, frase per frase, e trova:

1. Affermazioni, dettagli, aggettivi, esempi o numeri che il docente NON ha detto (inventati o aggiunti): vanno tolti o riscritti in modo fedele a ciò che ha detto.
2. Valori numerici, unità di misura, nomi e sigle diversi da quelli detti dal docente: vanno riportati come nella trascrizione (salvo evidenti errori di trascrizione dell'audio).
3. Errori o imprecisioni scientifiche del docente riportati senza segnalazione: lascia ciò che ha detto e aggiungi subito dopo una *(nota: ...)* con la correzione.
4. Dati del docente corretti in silenzio negli appunti: riporta il dato del docente e metti la correzione in una *(nota: ...)*.
5. Punti che il docente ha detto di chiedere all'esame e che negli appunti non sono segnati con ⚠️: aggiungi ⚠️ all'inizio della frase.
6. Informazioni pratiche (esame, materiale, argomenti esclusi) attribuite al docente ma non presenti nella trascrizione: vanno tolte.

Non cambiare lo stile, non riassumere, non aggiungere argomenti nuovi e non toccare ciò che è corretto.

Rispondi SOLO con un oggetto JSON di questa forma:
{"correzioni":[{"trova":"...","sostituisci":"...","motivo":"..."}]}
- "trova": un pezzo di testo copiato ESATTAMENTE dagli appunti (stesse parole, punteggiatura e simboli Markdown), il più breve possibile ma unico; di solito una frase o parte di frase. Mai un titolo intero o una sezione intera.
- "sostituisci": il testo che deve prenderne il posto (stringa vuota per eliminarlo).
- "motivo": breve spiegazione in italiano.
- Al massimo 40 correzioni. Se non c'è niente da correggere rispondi {"correzioni":[]}.

TRASCRIZIONE
${trascrizione}

APPUNTI
${appunti}`;
}
