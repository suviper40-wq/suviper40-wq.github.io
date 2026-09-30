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

function promptAppunti({ titolo, materia, data, termini, trascrizione }) {
  return `Sei un tutor universitario. Dalla trascrizione di una lezione devi scrivere gli appunti con cui uno studente studierà per l'esame.

STILE: DISCORSIVO, NON A ELENCHI PUNTATI
- Scrivi in prosa, con paragrafi che spiegano e collegano i concetti, come un buon libro di testo o degli appunti ben scritti. Mantieni il ragionamento del docente (perché, come, cosa ne consegue), non ridurlo a parole chiave.
- NON usare elenchi puntati, a meno che il contenuto sia davvero un elenco di cose parallele (es. i passaggi di un procedimento). Nel dubbio, scrivi in prosa.
- Usa le tabelle solo per confronti veri (es. A vs B) o dati numerici, sempre in aggiunta al testo e non al posto suo.
- Usa il grassetto per termini e definizioni chiave, con misura.

PULIZIA
- Elimina riempitivi, ripetizioni, battute, digressioni e chiacchiere. Raccogli invece in una sezione "Info pratiche" date d'esame, compiti e avvisi del docente (ometti la sezione se non ce ne sono).
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
8. "## Domande di ripasso": 3-5 domande (lista numerata).

Rispondi solo con gli appunti in Markdown, senza premesse e senza blocchi di codice attorno.

DATI DELLA LEZIONE
Titolo indicato dallo studente: ${titolo || '(nessuno)'}
Materia: ${materia || '(non indicata)'}
Data: ${data || '(non indicata)'}
Termini tecnici indicati: ${termini || '(nessuno)'}

TRASCRIZIONE
${trascrizione}`;
}
