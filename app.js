/* Saisie vocale des notes dans le fichier Massar (voir SPEC.md). */
(function () {
  'use strict';
  const P = window.NotesParser;
  const M = window.Massar;
  const STORE_KEY = 'notes-vocales:session';
  const UI_KEY = 'notes-vocales:ui';
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ------------------------------------------------------------------ état
  const S = {
    ui: 'ar',                // langue de l'interface : ar | fr
    screen: 'open',          // open | setup | dictate | review
    fileName: '', bytes: null, book: null, prepared: [],
    col: null,               // colonne choisie (G, I, K…)
    mode: null,              // ordered | free
    lang: 'ar-MA', speakNames: false,
    byCol: {},               // colonne → { ligne → { value?, absent?, skipped?, mark?, seq? } }
    seq: 0,                  // ordre de saisie
    current: 0,              // élève courant (copies dans l'ordre de la liste)
    selected: null,          // élève choisi par son nom, en attente de la note (copies en désordre)
    pending: null,           // question en cours : { type: 'replace' | 'who', row, value, old, kind }
    reviewOrder: null,       // entry | massar
    heard: '', interim: '',
    log: [],                 // dernières phrases entendues
    feedback: null,          // { kind: ok | err | warn, text }
    error: '',
  };
  try { const u = localStorage.getItem(UI_KEY); if (u === 'fr' || u === 'ar') S.ui = u; } catch (e) { /* rien */ }

  // ------------------------------------------------------------------ outils
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => (v == null ? '' : String(Math.round(v * 100) / 100));
  function t(key, vars) {
    const d = window.I18N[S.ui]; let s = d[key] != null ? d[key] : window.I18N.ar[key] != null ? window.I18N.ar[key] : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  }
  const students = () => (S.book ? S.book.students : []);
  const byRow = (row) => students().find((s) => s.row === row);
  const column = () => (S.book ? S.book.columns.find((c) => c.col === S.col) : null);
  const E = () => (S.byCol[S.col] = S.byCol[S.col] || {});
  const entry = (row) => (E()[row] = E()[row] || {});
  const original = (st) => st.grades[S.col];
  const effective = (st) => { const e = E()[st.row]; return e && e.value !== undefined ? e.value : original(st); };
  const handled = (st) => { const e = E()[st.row] || {}; return effective(st) != null || e.absent || e.skipped; };

  function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  // ------------------------------------------------------------------ sauvegarde automatique
  function persist() {
    if (!S.bytes) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 2, ts: Date.now(), fileName: S.fileName, b64: toB64(S.bytes), col: S.col, mode: S.mode, lang: S.lang,
        speakNames: S.speakNames, byCol: S.byCol, seq: S.seq, current: S.current, screen: S.screen === 'open' ? 'setup' : S.screen,
      }));
    } catch (e) { /* stockage indisponible : on continue sans */ }
  }
  function loadSaved() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return s && s.v === 2 ? s : null; } catch (e) { return null; } }
  function clearSaved() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* rien */ } }

  // ------------------------------------------------------------------ voix de l'application
  let mutedUntil = 0;
  function pickVoice(prefix) {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return vs.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix + '-ma')) || vs.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
  }
  // dit une phrase dans la langue de l'interface, sinon dans l'autre langue, sinon un bip
  function say(key, vars, { onlyArabic = false } = {}) {
    if (!('speechSynthesis' in window)) { beep(); return; }
    const order = onlyArabic ? ['ar'] : [S.ui]; // pas de voix dans la langue choisie : signal sonore
    for (const lang of order) {
      const voice = pickVoice(lang);
      if (!voice) continue;
      let text = key === null ? vars : window.I18N[lang][key];
      if (vars && key !== null) text = text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice; u.lang = voice.lang;
      speechSynthesis.cancel();
      mutedUntil = Date.now() + 60000;
      u.onend = u.onerror = () => { mutedUntil = Date.now() + 500; };
      speechSynthesis.speak(u);
      return;
    }
    beep(key && /^say\.(who|choose|yesNo|replace)/.test(key) ? 'question' : 'error');
  }
  let audioCtx;
  // erreur : deux notes graves ; question : deux notes montantes
  function beep(kind) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'question' ? [440, 660] : [300, 220];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        const t0 = audioCtx.currentTime + i * 0.2;
        o.frequency.value = f; g.gain.value = 0.15; o.connect(g); g.connect(audioCtx.destination);
        o.start(t0); o.stop(t0 + 0.16);
      });
      mutedUntil = Date.now() + 600;
    } catch (e) { /* pas de son */ }
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  // ------------------------------------------------------------------ reconnaissance vocale
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const fromFile = location.protocol === 'file:';
  let rec = null; let wantListening = false; let micPerm = 'unknown';
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'microphone' }).then((p) => {
      micPerm = p.state; p.onchange = () => { micPerm = p.state; renderLive(); };
    }).catch(() => {});
  }

  function startListening() {
    if (!SR) { S.error = t('noSR'); render(); return; }
    S.error = '';
    wantListening = true;
    if (rec) { try { rec.abort(); } catch (e) { /* rien */ } }
    rec = new SR();
    rec.lang = S.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 5;
    rec.onstart = () => renderLive();
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r.isFinal) { S.interim = r[0].transcript; renderLive(); scheduleEarly(i, r[0].transcript); continue; }
        S.interim = ''; clearTimeout(earlyTimer);
        if (i === early.idx) { // déjà traité avant la fin : ne garder que ce qui a été ajouté depuis
          const extra = r[0].transcript.trim().split(/\s+/).slice(early.words).join(' ');
          early.idx = -1;
          if (extra && Date.now() >= mutedUntil) processText(extra);
          continue;
        }
        if (Date.now() < mutedUntil || (window.speechSynthesis && speechSynthesis.speaking)) continue; // l'application parlait
        const alts = Array.from({ length: r.length }, (_, k) => r[k].transcript.trim()).filter(Boolean);
        if (alts.length) handleSpeech(alts);
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { wantListening = false; S.error = t('err.mic'); }
      else if (ev.error === 'network') S.error = t('err.network');
      else if (ev.error === 'audio-capture') { wantListening = false; S.error = t('err.noMic'); }
      else return;
      render();
    };
    rec.onend = () => {
      // Chrome coupe l'écoute après un silence : on relance sans recréer l'objet
      if (wantListening) setTimeout(() => { if (wantListening) { try { rec.start(); } catch (e) { /* déjà lancé */ } } }, 250);
      else renderLive();
    };
    try { rec.start(); } catch (e) { /* rien */ }
    renderLive();
  }
  // Une note décimale complète (« طناش ونص », « 14,25 ») ou 20 ne peut plus changer :
  // on l'enregistre dès qu'elle reste stable un instant, sans attendre la fin de la phrase.
  let earlyTimer = null; const early = { idx: -1, words: 0 };
  function scheduleEarly(i, text) {
    clearTimeout(earlyTimer);
    if (i === early.idx) return;
    earlyTimer = setTimeout(() => {
      if (S.screen !== 'dictate' || Date.now() < mutedUntil || (window.speechSynthesis && speechSynthesis.speaking)) return;
      if (!complete(text)) return;
      early.idx = i; early.words = text.trim().split(/\s+/).length;
      S.interim = '';
      processText(text.trim());
    }, 450);
  }
  function complete(text) {
    if (S.pending) return S.pending.type === 'who' ? !!(P.choice(text, S.pending.options.length) || P.yesNo(text)) : !!P.yesNo(text);
    if (quality(text) < 3) return false;
    const evs = P.parse(text, S.prepared);
    const last = evs[evs.length - 1];
    if (!last) return false;
    if (last.type === 'absent' || last.type === 'skip') return true;
    return last.type === 'grade' && last.value != null && (last.value % 1 !== 0 || last.value === 20);
  }

  function stopListening() {
    wantListening = false;
    if (rec) { try { rec.stop(); } catch (e) { /* rien */ } }
    S.interim = '';
  }

  // ------------------------------------------------------------------ compréhension
  // qualité d'une transcription : tout compris > nom incertain > incompris
  function quality(text) {
    if (S.pending) return P.yesNo(text) ? 3 : 0;
    const evs = P.parse(text, S.prepared);
    if (!evs.length) return 0;
    let q = 3;
    for (const e of evs) {
      if (e.type === 'skip') continue;
      if (e.noName) { if (S.mode !== 'ordered' && S.selected == null) q = Math.min(q, 1); continue; }
      if (e.status === 'bad' || !e.candidates.length) return 0;
      if (e.candidates.length > 1) q = Math.min(q, 1);
      else if (e.status === 'check') q = Math.min(q, 2);
    }
    return q;
  }
  // pendant une question : une autre phrase ne remplace la réponse que si c'est une vraie saisie (note ou absent)
  function isNewEntry(text) {
    const p = S.pending; S.pending = null;
    const q = quality(text);
    const evs = P.parse(text, S.prepared);
    S.pending = p;
    return q >= 2 && evs.some((e) => e.type === 'grade' || e.type === 'absent');
  }
  function handleSpeech(alts) {
    if (S.screen !== 'dictate') return;
    let best = alts[0]; let bq = -1;
    for (const a of alts) { const q = quality(a); if (q > bq) { bq = q; best = a; } if (q === 3) break; }
    processText(best);
  }
  // traite une phrase et la garde dans l'historique (utile pour comprendre les erreurs de reconnaissance)
  function processText(text) {
    onText(text);
    S.log.unshift({ text, kind: S.feedback ? S.feedback.kind : '', msg: S.feedback ? S.feedback.text : '' });
    if (S.log.length > 15) S.log.length = 15;
    const el = $('#log'); if (el) el.innerHTML = logHtml();
  }

  let batch = false; // plusieurs élèves dans une même phrase : on cumule les confirmations
  function ok(text) {
    if (batch && S.feedback && S.feedback.kind === 'ok') S.feedback.text += ' · ' + text; else S.feedback = { kind: 'ok', text };
    batch = true;
  }
  function fail(kind, st) {
    const fb = { notUnderstood: 'fb.notUnderstood', ambiguous: 'fb.ambiguous', noName: 'fb.noName', full: 'fb.sayFull', range: 'fb.range' }[kind];
    S.feedback = { kind: 'err', text: t(fb) };
    const target = st || (S.mode === 'ordered' ? students()[S.current] : null);
    if (target && !handled(target)) entry(target.row).mark = 'err';
    say({ notUnderstood: 'say.notUnderstood', ambiguous: 'say.ambiguous', noName: 'say.noName', full: 'say.full', range: 'say.range' }[kind]);
    commit();
  }

  function onText(text) {
    S.heard = text;
    if (S.pending) { onAnswer(text); return; }
    const events = P.parse(text, S.prepared);
    batch = false;
    if (!events.length) return fail('notUnderstood');
    for (const ev of events) {
      if (ev.type === 'skip') {
        if (S.mode !== 'ordered') return fail('notUnderstood');
        const st = students()[S.current];
        if (!st) return finish();
        const e = entry(st.row); e.skipped = true; e.mark = 'skip';
        ok(t('fb.skipped', { name: st.name }));
        advance();
        continue;
      }
      // élève visé
      let st;
      if (ev.noName) {
        st = S.mode === 'ordered' ? students()[S.current] : S.selected != null ? byRow(S.selected) : null;
        if (!st) return fail('noName');
      } else {
        if (ev.candidates.length !== 1 || ev.status === 'check') {
          // copies dans l'ordre : un nom seul et incertain est sans doute un bruit
          if (ev.type === 'name' && S.mode === 'ordered') return fail('notUnderstood');
          if (ev.type === 'grade' && !(ev.value >= 0 && ev.value <= 20)) return fail('range');
          // nom pas sûr ou homonymes : proposer les élèves les plus proches
          const list = ev.candidates.length > 1 ? ev.candidates : ev.candidates.concat(ev.suggestions || []);
          const options = [...new Set(list.map((c) => c.row))].slice(0, 3);
          if (!options.length) return fail('notUnderstood');
          askWho(options, ev, ev.candidates.length > 1);
          return;
        }
        st = byRow(ev.candidates[0].row);
      }
      if (!act(st, ev.type, ev.value)) return;
    }
    commit();
  }

  // applique une saisie ; renvoie false si une question a été posée (on s'arrête)
  function act(st, kind, value) {
    if (kind === 'name') {
      if (S.mode === 'ordered') { S.current = students().indexOf(st); announce(); } else S.selected = st.row;
      S.feedback = { kind: 'warn', text: t('fb.selected', { name: st.name }) };
      return true;
    }
    if (kind === 'absent') {
      const e = entry(st.row); delete e.value; e.absent = true; e.skipped = false; e.mark = 'absent'; e.seq = ++S.seq;
      ok(t('fb.absent', { name: st.name }));
      afterEntry(st);
      return true;
    }
    if (value == null) { fail('notUnderstood', st); return false; }
    if (!(value >= 0 && value <= 20)) { fail('range', st); return false; }
    const old = effective(st);
    if (old != null && old !== value) {
      S.pending = { type: 'replace', row: st.row, value, old };
      entry(st.row).mark = 'warn';
      S.feedback = { kind: 'warn', text: t('fb.replaceQ', { name: st.name, old: fmt(old), v: fmt(value) }) };
      say('say.replace', { old: S.ui === 'fr' ? fmt(old) : P.speakValue(old) });
      commit();
      return false;
    }
    setValue(st, value);
    ok(t('fb.saved', { name: st.name, v: fmt(value) }));
    afterEntry(st);
    return true;
  }

  function askWho(options, ev, homonyms) {
    S.pending = { type: 'who', options, kind: ev.type, value: ev.value };
    const names = options.map((r) => byRow(r).name);
    if (options.length === 1) {
      S.feedback = { kind: 'warn', text: t('fb.whoQ', { name: names[0] }) };
      say('say.who', { name: names[0] });
    } else {
      S.feedback = { kind: 'warn', text: t(homonyms ? 'fb.ambiguous' : 'fb.chooseQ') };
      say(homonyms ? 'say.ambiguous' : 'say.choose');
    }
    commit();
  }

  function onAnswer(text) {
    S.heard = text;
    const p = S.pending;
    if (p.type === 'who') { answerWho(text, p); return; }
    const a = P.yesNo(text);
    const st = byRow(p.row);
    if (!a) {
      // l'enseignant a dit autre chose qu'oui / non : si c'est une saisie compréhensible, on la prend
      if (isNewEntry(text)) { S.pending = null; entry(p.row).mark = 'ok'; onText(text); return; }
      S.feedback = { kind: 'warn', text: t('fb.replaceQ', { name: st.name, old: fmt(p.old), v: fmt(p.value) }) + ' ' + t('fb.sayYesNo') };
      say('say.yesNo');
      commit();
      return;
    }
    S.pending = null; batch = false;
    if (a === 'yes') { setValue(st, p.value); ok(t('fb.replaced', { name: st.name, v: fmt(p.value), old: fmt(p.old) })); }
    else { entry(st.row).mark = 'ok'; ok(t('fb.kept', { name: st.name, old: fmt(p.old) })); }
    afterEntry(st);
    commit();
  }

  // réponse à « هل تقصد … ؟ » / « من تقصد ؟ » : numéro, oui / non, ou nouvelle phrase
  function answerWho(text, p) {
    let pick = P.choice(text, p.options.length);
    const a = P.yesNo(text);
    if (!pick && a === 'yes' && p.options.length === 1) pick = 1;
    if (pick) { S.pending = null; batch = false; act(byRow(p.options[pick - 1]), p.kind, p.value); commit(); return; }
    if (a === 'no') { S.pending = null; fail('full'); return; }
    if (isNewEntry(text)) { S.pending = null; onText(text); return; }
    say(p.options.length === 1 ? 'say.yesNo' : 'say.choose');
    commit();
  }

  function setValue(st, v) {
    const e = entry(st.row);
    if (v === original(st)) delete e.value; else e.value = v;
    e.absent = false; e.skipped = false; e.mark = 'ok'; e.seq = ++S.seq;
  }

  function afterEntry(st) {
    if (S.selected === st.row) S.selected = null;
    if (S.mode === 'ordered') {
      if (students().indexOf(st) === S.current) advance();
      else { // saut vers un autre élève : retour au premier non rempli
        const first = students().findIndex((s) => !handled(s));
        if (first === -1) return finish();
        S.current = first; announce();
      }
    } else if (students().every(handled)) finish();
  }
  function advance() {
    const list = students();
    let i = S.current + 1;
    while (i < list.length && handled(list[i])) i++;
    if (i >= list.length) return finish(); // fin de la liste = fin de la dictée
    S.current = i; announce();
  }
  function announce() {
    if (S.speakNames && S.mode === 'ordered') { const st = students()[S.current]; if (st) say(null, st.name, { onlyArabic: true }); }
  }
  let finishing = false;
  function finish() {
    if (finishing) return; finishing = true;
    stopListening();
    setTimeout(() => { finishing = false; S.pending = null; S.selected = null; S.screen = 'review'; commit(); }, 900);
    commit();
  }

  function commit() { persist(); render(); }

  // ------------------------------------------------------------------ ouverture du fichier
  async function openFile(file) {
    S.error = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadBook(bytes, file.name);
      Object.assign(S, { byCol: {}, seq: 0, col: null, mode: null, current: 0, selected: null, pending: null, feedback: null, heard: '', screen: 'setup' });
      commit();
    } catch (e) {
      S.error = e instanceof M.MassarError ? (S.ui === 'ar' ? e.message : t('err.notMassar')) : t('err.open', { m: e.message });
      render();
    }
  }
  async function loadBook(bytes, name) {
    S.book = await M.read(bytes, window.JSZip);
    S.bytes = bytes; S.fileName = name;
    S.prepared = P.prepareStudents(S.book.students.map((s) => ({ row: s.row, name: s.name })));
  }
  async function resume(saved) {
    try {
      await loadBook(fromB64(saved.b64), saved.fileName);
      Object.assign(S, { col: saved.col, mode: saved.mode, lang: saved.lang || 'ar-MA', speakNames: !!saved.speakNames,
        byCol: saved.byCol || {}, seq: saved.seq || 0, current: saved.current || 0, selected: null, pending: null, feedback: null, heard: '' });
      if (!S.book.columns.some((c) => c.col === S.col)) S.col = null;
      S.screen = saved.screen === 'review' ? 'review' : 'setup';
      render();
    } catch (e) { clearSaved(); S.error = t('err.resume'); render(); }
  }

  // ------------------------------------------------------------------ affichage
  function render() {
    const d = window.I18N[S.ui];
    document.documentElement.lang = S.ui; document.documentElement.dir = d.dir;
    document.title = t('title');
    renderTop();
    renderSteps();
    const app = $('#app');
    app.innerHTML = { open: viewOpen, setup: viewSetup, dictate: viewDictate, review: viewReview }[S.screen]();
    if (S.screen === 'dictate') {
      const target = S.mode === 'ordered' ? $('.stu.cur') : $('.stu.last');
      if (target) target.scrollIntoView({ block: 'nearest' });
    }
    const fb = $('.feedback'); if (fb && S.feedback) { fb.classList.remove('flash'); void fb.offsetWidth; fb.classList.add('flash'); }
  }
  function renderLive() {
    const h = $('#heard'); if (h) h.innerHTML = heardHtml();
    const m = $('#mic'); if (m) { m.classList.toggle('on', wantListening); m.setAttribute('aria-pressed', String(wantListening)); }
    const ms = $('#micState'); if (ms) ms.textContent = micStateText();
    const ph = $('#permHint'); if (ph) ph.hidden = !(micPerm === 'prompt' || fromFile);
  }
  function renderTop() {
    $('#appTitle').textContent = t('title');
    $('#langBtn').textContent = t('switchLang');
    $('#homeLabel').textContent = t('home');
    $('#homeBtn').hidden = S.screen === 'open';
    $('#credit').textContent = t('credit');
    const i = S.book ? S.book.info : {};
    // القسم، المادة، الدورة، نوع المراقبة، الأستاذ
    const parts = S.book ? [i.classe, i.matiere, i.session, column() && column().label, i.prof && t('top.prof', { name: i.prof })].filter(Boolean) : [];
    $('#topInfo').innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('');
  }
  // étapes : on peut revenir à une étape déjà atteinte ; l'action principale reste toujours en haut
  function renderSteps() {
    const bar = $('#stepbar');
    bar.hidden = !S.book || S.screen === 'open';
    if (bar.hidden) return;
    const order = ['open', 'setup', 'dictate', 'review'];
    const names = { open: 'step.file', setup: 'step.setup', dictate: 'step.dictate', review: 'step.review' };
    const can = { open: true, setup: true, dictate: !!(S.col && S.mode), review: !!S.col };
    const cur = order.indexOf(S.screen);
    const items = order.map((k, i) => `<li><button class="step ${i < cur ? 'done' : ''}" data-step="${k}" ${k === S.screen ? 'aria-current="step"' : ''} ${can[k] ? '' : 'disabled'}>
      <span class="n">${i < cur ? '✓' : i + 1}</span><span class="t">${esc(t(names[k]))}</span></button></li>`).join('');
    const action = { setup: S.col && S.mode ? `<button class="btn btn-primary" data-act="start">${esc(t('setup.start'))}</button>` : '',
      dictate: `<button class="btn btn-primary" data-act="toReview">${esc(t('dict.finish'))}</button>`,
      review: `<button class="btn btn-primary" data-act="save">${esc(t('rev.save'))}</button>` }[S.screen] || '';
    bar.innerHTML = `<div class="stepbar-in"><ol class="steps">${items}</ol><span class="spacer"></span>${action}</div>`;
  }
  function startDictation() {
    if (!S.col || !S.mode) return;
    Object.assign(S, { screen: 'dictate', feedback: null, heard: '', pending: null, selected: null });
    if (S.mode === 'ordered') { const f = students().findIndex((s) => !handled(s)); S.current = f === -1 ? 0 : f; }
    commit(); announce(); startListening();
  }
  function goHome() { stopListening(); S.pending = null; S.selected = null; S.screen = 'open'; persist(); render(); }

  const micStateText = () => (!SR ? t('mic.na') : wantListening ? (S.pending ? t('mic.waiting') : t('mic.on')) : t('mic.off'));
  const heardHtml = () => (S.interim ? `<span class="interim">${esc(S.interim)}…</span>` : S.heard ? esc(t('dict.heard', { t: S.heard })) : `<span class="muted">${esc(t('dict.heardEmpty'))}</span>`);
  const logHtml = () => S.log.map((l) => `<li class="lg-${l.kind}"><b>${esc(l.text)}</b><span>${esc(l.msg)}</span></li>`).join('');
  const errorHtml = () => (S.error ? `<div class="alert alert-err" role="alert">${esc(S.error)}</div>` : '');
  const dateFmt = (ts) => new Date(ts).toLocaleString(S.ui === 'fr' ? 'fr-FR' : 'ar-MA-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' });

  function viewOpen() {
    const saved = loadSaved();
    let resumeHtml = '';
    if (saved) {
      const n = Object.values(saved.byCol || {}).flatMap((c) => Object.values(c)).filter((e) => e.value !== undefined || e.absent || e.skipped).length;
      const label = `${saved.fileName}، ${t('resume.entries', { n })}، ${dateFmt(saved.ts)}`.replace(/،/g, S.ui === 'fr' ? ',' : '،');
      resumeHtml = `<div class="alert alert-info stack"><div>${esc(t('resume.q', { label }))}</div>
        <div class="row"><button class="btn btn-primary" data-act="resume">${t('resume.yes')}</button><button class="btn btn-ghost" data-act="discard">${t('resume.no')}</button></div></div>`;
    }
    return `<div class="stack">
      ${resumeHtml}${errorHtml()}
      ${!SR ? `<div class="alert alert-warn">${esc(t('noSR'))}</div>` : ''}
      ${fromFile ? `<div class="alert alert-warn">${esc(t('fileProto'))}</div>` : ''}
      <label class="drop" id="drop" for="fileInput">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg>
        <h1>${esc(t('open.h'))}</h1>
        <p class="muted">${esc(t('open.p'))} <span class="num">(.xlsx)</span></p>
        <span class="btn btn-primary">${esc(t('open.btn'))}</span>
        <input type="file" id="fileInput" accept=".xlsx,${XLSX_TYPE}" hidden>
      </label>
      <p class="small muted">${esc(t('open.note'))}</p>
    </div>`;
  }

  function viewSetup() {
    const list = students();
    const colCards = S.book.columns.map((c) => {
      const filled = list.filter((s) => s.grades[c.col] != null).length;
      return `<button class="choice" data-col="${c.col}" aria-pressed="${S.col === c.col}">
        <span class="t">${esc(c.label)}</span><span class="small muted">${esc(t('setup.filled', { a: filled, b: list.length }))}</span>
        <span class="bar"><i style="width:${Math.round((filled / list.length) * 100)}%"></i></span></button>`;
    }).join('');
    const canStart = S.col && S.mode;
    const hasWork = Object.values(S.byCol).some((c) => Object.keys(c).length);
    return `<div class="stack">
      ${errorHtml()}
      <div class="card row">
        <div><div class="small muted">${esc(t('setup.file'))}</div><b class="num">${esc(S.fileName)}</b> <span class="muted">· ${esc(t('setup.students', { n: list.length }))}${S.book.info.niveau ? ' · ' + esc(S.book.info.niveau) : ''}</span></div>
        <span class="spacer"></span><button class="btn btn-ghost" data-act="close">${esc(t('setup.other'))}</button>
      </div>
      <div class="card stack"><h2>${esc(t('setup.step1'))}</h2><div class="choices">${colCards}</div></div>
      <div class="card stack"><h2>${esc(t('setup.step2'))}</h2>
        <div class="choices">
          <button class="choice" data-mode="ordered" aria-pressed="${S.mode === 'ordered'}"><span class="t">${esc(t('setup.ordered'))}</span><span class="small muted">${esc(t('setup.orderedDesc'))}</span></button>
          <button class="choice" data-mode="free" aria-pressed="${S.mode === 'free'}"><span class="t">${esc(t('setup.free'))}</span><span class="small muted">${esc(t('setup.freeDesc'))}</span></button>
        </div>
      </div>
      <div class="card stack"><h2>${esc(t('setup.step3'))}</h2>
        <div class="row"><label for="lang">${esc(t('setup.dictLang'))}</label>
          <select id="lang">
            <option value="ar-MA" ${S.lang === 'ar-MA' ? 'selected' : ''}>${esc(t('setup.langAr'))}</option>
            <option value="fr-FR" ${S.lang === 'fr-FR' ? 'selected' : ''}>Français</option>
            <option value="en-US" ${S.lang === 'en-US' ? 'selected' : ''}>English</option>
          </select></div>
        <label class="check"><input type="checkbox" id="speakNames" ${S.speakNames ? 'checked' : ''}> ${esc(t('setup.speakNames'))}</label>
      </div>
      <div class="row"><button class="btn btn-primary btn-big" data-act="start" ${canStart ? '' : 'disabled'}>${esc(t('setup.start'))}</button>
        ${!canStart ? `<span class="muted">${esc(t('setup.chooseFirst'))}</span>` : ''}
        ${hasWork ? `<span class="spacer"></span><button class="btn btn-ghost" data-act="toReview" ${S.col ? '' : 'disabled'}>${esc(t('setup.review'))}</button>` : ''}</div>
    </div>`;
  }

  function markHtml(st) {
    const m = (E()[st.row] || {}).mark;
    const marks = { ok: ['m-ok', '✓'], err: ['m-err', '✗'], warn: ['m-warn', '?'], absent: ['m-absent', S.ui === 'fr' ? 'A' : 'غ'], skip: ['m-skip', '–'] };
    return m && marks[m] ? `<span class="mark ${marks[m][0]}" aria-hidden="true">${marks[m][1]}</span>` : '<span></span>';
  }
  function stuRow(s, i, extra) {
    const e = E()[s.row] || {};
    const nv = e.absent ? `<span class="tag t-absent">${esc(t('st.absent'))}</span>` : e.value !== undefined ? `<span class="num">${fmt(e.value)}</span>` : e.skipped ? `<span class="tag t-skip">${esc(t('st.skip'))}</span>` : '';
    return `<div class="stu ${extra || ''}" data-idx="${i}">
      <span class="i num">${i + 1}</span><span class="n">${esc(s.name)}</span><span class="old num">${fmt(original(s))}</span><span class="new">${nv}</span>${markHtml(s)}</div>`;
  }
  // copies en désordre : d'abord les élèves saisis, dans l'ordre de saisie, puis les autres
  function entryOrder() {
    const list = students();
    const done = list.filter((s) => (E()[s.row] || {}).seq).sort((a, b) => E()[a.row].seq - E()[b.row].seq);
    const rest = list.filter((s) => !(E()[s.row] || {}).seq);
    return { done, rest };
  }

  function viewDictate() {
    const list = students();
    const st = list[S.current];
    const count = list.filter(handled).length;
    let current;
    if (S.mode === 'ordered') {
      current = `<div class="card current"><div class="label">${esc(t('dict.sayGrade'))}</div><div class="name">${st ? esc(st.name) : ''}</div>
        <div class="pos"><span class="num">${S.current + 1} / ${list.length}</span>${st && original(st) != null ? ` · ${esc(t('dict.inFile', { v: fmt(original(st)) }))}` : ''}</div></div>`;
    } else if (S.selected != null) {
      current = `<div class="card current"><div class="label">${esc(t('dict.selected'))}</div><div class="name">${esc(byRow(S.selected).name)}</div><div class="pos">&nbsp;</div></div>`;
    } else {
      current = `<div class="card current free"><div class="name">${esc(t('dict.freeTitle'))}</div><div class="pos">${esc(t('dict.freeEx'))}</div></div>`;
    }
    const fb = S.feedback;
    const fbHtml = fb
      ? `<div class="feedback fb-${fb.kind}" role="status"><span class="ic" aria-hidden="true">${fb.kind === 'ok' ? '✓' : fb.kind === 'err' ? '✗' : '?'}</span><span>${esc(fb.text)}</span></div>`
      : `<div class="feedback fb-idle">${esc(t('dict.idle'))}</div>`;
    let pendingBtns = '';
    if (S.pending && S.pending.type === 'who' && S.pending.options.length > 1) {
      pendingBtns = `<div class="options">${S.pending.options.map((r, k) => `<button class="opt" data-pick="${k + 1}"><span class="num">${k + 1}</span>${esc(byRow(r).name)}</button>`).join('')}</div>`;
    } else if (S.pending) {
      pendingBtns = `<div class="row"><button class="btn btn-ok" data-answer="yes">${esc(t('yes'))}</button><button class="btn btn-no" data-answer="no">${esc(t('no'))}</button></div>`;
    }

    let rows;
    if (S.mode === 'free') {
      const { done, rest } = entryOrder();
      const idx = (s) => list.indexOf(s);
      rows = done.map((s, k) => stuRow(s, idx(s), k === done.length - 1 ? 'last' : '')).join('')
        + (rest.length && done.length ? `<div class="sep">${esc(t('dict.notYet'))}</div>` : '')
        + rest.map((s) => stuRow(s, idx(s), S.selected === s.row ? 'cur' : '')).join('');
    } else {
      rows = list.map((s, i) => stuRow(s, i, 'clickable' + (i === S.current ? ' cur' : ''))).join('');
    }
    return `<div class="dictate">
      <div class="focus">
        ${errorHtml()}
        ${current}
        <div class="card stack">
          <div class="mic-row">
            <button class="mic ${wantListening ? 'on' : ''}" id="mic" data-act="mic" aria-pressed="${wantListening}" aria-label="${esc(t('mic.label'))}">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
            <div class="stack" style="gap:4px;min-width:0"><b id="micState">${esc(micStateText())}</b><div class="heard" id="heard">${heardHtml()}</div></div>
          </div>
          <p class="small muted" id="permHint" ${micPerm === 'prompt' || fromFile ? '' : 'hidden'}>${esc(t('permHint'))}</p>
          ${fbHtml}
          ${pendingBtns}
          <form class="typein" id="typeForm"><input id="typeIn" type="text" autocomplete="off" placeholder="${esc(t('dict.typePh'))}"><button class="btn btn-ghost">${esc(t('dict.enter'))}</button></form>
        </div>
        <details class="log-box"><summary>${esc(t('dict.log'))}</summary><ol id="log">${logHtml()}</ol></details>
      </div>
      <div class="list">
        <div class="list-head"><b>${esc(column() ? column().label : '')}</b><span class="muted">${esc(t('dict.count', { a: count, b: list.length }))}</span></div>
        <div class="stu head"><span>${esc(t('col.n'))}</span><span>${esc(t('col.name'))}</span><span class="old">${esc(t('col.file'))}</span><span class="new">${esc(t('col.new'))}</span><span></span></div>
        ${rows}
      </div>
    </div>`;
  }

  function statusOf(st) {
    const e = E()[st.row] || {};
    const o = original(st);
    if (e.absent) return 'absent';
    if (e.value !== undefined) return o == null ? 'new' : 'changed';
    if (e.skipped) return 'skip';
    return o != null ? 'same' : 'empty';
  }
  function viewReview() {
    const list = students();
    const count = (k) => list.filter((s) => statusOf(s) === k).length;
    const order = S.reviewOrder || (S.mode === 'free' ? 'entry' : 'massar');
    let shown = list;
    if (order === 'entry') { const { done, rest } = entryOrder(); shown = done.concat(rest); }
    const rows = shown.map((s) => {
      const k = statusOf(s);
      const e = E()[s.row] || {};
      return `<tr><td class="num">${list.indexOf(s) + 1}</td><td>${esc(s.name)}</td><td class="num muted">${fmt(original(s))}</td>
        <td><input type="number" min="0" max="20" step="0.01" inputmode="decimal" data-row="${s.row}" value="${e.absent ? '' : fmt(effective(s))}" aria-label="${esc(t('rev.gradeOf', { name: s.name }))}"></td>
        <td><span class="tag t-${k}">${esc(t('st.' + k))}</span></td></tr>`;
    }).join('');
    return `<div class="stack">
      ${errorHtml()}
      <h1>${esc(t('rev.title', { col: column() ? column().label : '' }))}</h1>
      <div class="stats">
        <div class="stat"><b style="color:var(--ok)">${count('new')}</b>${esc(t('rev.new'))}</div>
        <div class="stat"><b style="color:var(--warn)">${count('changed')}</b>${esc(t('rev.changed'))}</div>
        <div class="stat"><b style="color:var(--absent)">${count('absent')}</b>${esc(t('rev.absent'))}</div>
        <div class="stat"><b class="muted">${count('empty') + count('skip')}</b>${esc(t('rev.empty'))}</div>
      </div>
      <div class="row"><div class="seg" role="group">
        <button data-order="entry" aria-pressed="${order === 'entry'}">${esc(t('rev.orderEntry'))}</button>
        <button data-order="massar" aria-pressed="${order === 'massar'}">${esc(t('rev.orderMassar'))}</button></div>
        <span class="small muted">${esc(t('rev.orderNote'))}</span></div>
      <div class="table-wrap"><table><thead><tr><th>${esc(t('col.n'))}</th><th>${esc(t('col.name'))}</th><th>${esc(t('rev.before'))}</th><th>${esc(t('rev.grade'))}</th><th>${esc(t('rev.status'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small muted">${esc(t('rev.edit'))}</p>
    </div>`;
  }

  // ------------------------------------------------------------------ enregistrement et envoi
  // toutes les notes modifiées, dans toutes les colonnes travaillées ; les lignes restent à leur place
  function changes() {
    const out = {};
    for (const [col, entries] of Object.entries(S.byCol)) {
      for (const st of students()) {
        const e = entries[st.row];
        if (e && e.value !== undefined && e.value !== st.grades[col]) out[col + st.row] = e.value;
      }
    }
    return out;
  }
  async function save() {
    const ch = changes();
    let bytes;
    try { bytes = await M.write(S.book, ch); } catch (e) { S.error = t('err.save', { m: e.message }); render(); return; }
    // le fichier est téléchargé tout de suite ; l'enseignant le place ensuite où il veut
    const file = new File([bytes], S.fileName, { type: XLSX_TYPE });
    download(file);
    const card = $('#modalCard');
    card.innerHTML = `<h2 id="modalTitle">${esc(t('save.title'))}</h2>
      <p>${esc(t('save.text', { n: Object.keys(ch).filter((k) => ch[k] != null).length, file: S.fileName }))}</p>
      <p class="muted">${esc(t('save.where'))}</p>
      <div class="row"><button class="btn btn-ghost" data-act="download">${esc(t('save.again'))}</button><span class="spacer"></span>
        <button class="btn btn-ghost" data-act="closeModal">${esc(t('save.close'))}</button><button class="btn btn-primary" data-act="newWork">${esc(t('save.new'))}</button></div>`;
    $('#modal').hidden = false;
    card._file = file;
    card.querySelector('[data-act="closeModal"]').focus();
  }
  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.parentNode.removeChild(a); }, 2000);
  }
  function reset() {
    stopListening(); clearSaved();
    Object.assign(S, { screen: 'open', book: null, bytes: null, byCol: {}, seq: 0, col: null, mode: null, feedback: null, selected: null, pending: null, heard: '', reviewOrder: null });
    render();
  }

  // ------------------------------------------------------------------ événements
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('button, [data-idx]');
    if (!el) return;
    if (el.id === 'langBtn') { S.ui = S.ui === 'ar' ? 'fr' : 'ar'; try { localStorage.setItem(UI_KEY, S.ui); } catch (e) { /* rien */ } render(); return; }
    if (el.dataset.step) {
      const k = el.dataset.step;
      if (k === 'open') return goHome();
      if (k === 'dictate') { if (S.screen !== 'dictate') startDictation(); return; }
      stopListening(); S.pending = null; S.selected = null; S.screen = k; commit(); return;
    }
    if (el.dataset.col) { S.col = el.dataset.col; commit(); return; }
    if (el.dataset.mode) { S.mode = el.dataset.mode; commit(); return; }
    if (el.dataset.order) { S.reviewOrder = el.dataset.order; render(); return; }
    if (el.dataset.pick) { if (S.pending && S.pending.type === 'who') processText(el.dataset.pick); return; }
    if (el.dataset.answer) { if (S.pending) onAnswer(el.dataset.answer === 'yes' ? 'نعم' : 'لا'); return; }
    if (el.dataset.idx && S.screen === 'dictate' && !S.pending) {
      const i = +el.dataset.idx;
      if (S.mode === 'ordered') { S.current = i; announce(); } else S.selected = students()[i].row;
      commit(); return;
    }
    switch (el.dataset.act) {
      case 'home': goHome(); break;
      case 'resume': { const s = loadSaved(); if (s) await resume(s); break; }
      case 'discard': clearSaved(); render(); break;
      case 'close': reset(); break;
      case 'start': startDictation(); break;
      case 'mic': if (wantListening) { stopListening(); renderLive(); } else startListening(); break;
      case 'toSetup': stopListening(); S.screen = 'setup'; commit(); break;
      case 'toReview': stopListening(); S.pending = null; S.selected = null; S.screen = 'review'; commit(); break;
      case 'toDictate': startDictation(); break;
      case 'save': save(); break;
      case 'download': download($('#modalCard')._file); break;
      case 'closeModal': $('#modal').hidden = true; break;
      case 'newWork': $('#modal').hidden = true; reset(); break;
      default: break;
    }
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'fileInput' && el.files[0]) openFile(el.files[0]);
    else if (el.id === 'lang') { S.lang = el.value; persist(); }
    else if (el.id === 'speakNames') { S.speakNames = el.checked; persist(); }
    else if (el.dataset && el.dataset.row) {
      const st = byRow(+el.dataset.row);
      const raw = el.value.trim().replace(',', '.');
      const e = entry(st.row);
      if (raw === '') { if (original(st) != null) e.value = null; else delete e.value; e.absent = false; }
      else {
        const v = Number(raw);
        if (!(v >= 0 && v <= 20)) { el.value = fmt(effective(st)); return; }
        const keepSeq = e.seq; setValue(st, Math.round(v * 100) / 100); if (keepSeq) e.seq = keepSeq;
      }
      commit();
    }
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'typeForm') return;
    ev.preventDefault();
    const v = $('#typeIn').value.trim(); if (!v) return;
    processText(v);
    const inp = $('#typeIn'); if (inp) inp.focus();
  });
  document.addEventListener('dragover', (ev) => { const d = $('#drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', () => { const d = $('#drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', (ev) => { const d = $('#drop'); if (!d) return; ev.preventDefault(); d.classList.remove('over'); const f = ev.dataTransfer.files[0]; if (f) openFile(f); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { const m = $('#modal'); if (!m.hidden) m.hidden = true; } });

  render();
})();
