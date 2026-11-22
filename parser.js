/*
 * Analyse d'une phrase dictée par le professeur :
 *   « ندى طناش ونص، يوسف غايب، Salma quinze virgule vingt-cinq »
 * → liste d'événements { type: 'grade' | 'absent' | 'command' | 'unknown', ... }
 *
 * Langues : darija marocaine, hassaniya, arabe standard, français, anglais.
 * Fonctionne dans le navigateur (window.NotesParser) et sous Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotesParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- normalisation
  function norm(s) {
    return String(s || '')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
      .replace(/٫/g, '.')
      .normalize('NFD')
      .replace(/[̀-ͯؐ-ًؚ-ٰٟۖ-ۭ]/g, '')
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ـ/g, '')
      .toLowerCase()
      .replace(/(\d)\s*[,،]\s*(\d)/g, '$1.$2') // 12,5 → 12.5
      .replace(/[’'`]/g, ' ')
      .replace(/[-–]/g, ' ')
      .replace(/[^\p{L}\p{N}.\s،؛;,!?]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const words = (s) => norm(s).split(' ').filter(Boolean);

  // ---------------------------------------------------------------- nombres
  const NUM = Object.create(null);
  function add(v, list) {
    list.split(/\s*\|\s*/).forEach((w) => { if (w) NUM[norm(w)] = v; });
  }
  // darija + hassaniya + arabe standard
  add(0, 'صفر|zero|zéro|zero');
  add(1, 'واحد|وحده|واحده|احد|un|une|one');
  add(2, 'جوج|زوج|اثنين|اثنان|اثنا|اثني|ثنين|اثنين|deux|two');
  add(3, 'تلاته|ثلاثه|ثلاث|اتلاته|اثلاثه|trois|three');
  add(4, 'ربعه|اربعه|اربع|quatre|four');
  add(5, 'خمسه|خمس|cinq|five');
  add(6, 'سته|ست|six');
  add(7, 'سبعه|سبع|sept|seven');
  add(8, 'تمنيه|ثمانيه|ثماني|ثمنيه|اثمنيه|تمانيه|huit|eight');
  add(9, 'تسعود|تسعه|تسع|اتسعه|neuf|nine');
  add(10, 'عشره|عشر|dix|ten');
  add(11, 'حضاش|حداش|احداش|احداعش|حداعش|onze|eleven');
  add(12, 'طناش|اطناش|تناش|اثناش|اثناعش|اطناعش|طناعش|douze|twelve');
  add(13, 'تلطاش|ثلطاش|اتلطاعش|تلطاعش|ثلطاعش|treize|thirteen');
  add(14, 'ربعطاش|اربعطاش|اربعطاعش|ربعطاعش|quatorze|fourteen');
  add(15, 'خمسطاش|خمسطاعش|quinze|fifteen');
  add(16, 'سطاش|سطاعش|seize|sixteen');
  add(17, 'سبعطاش|سبعطاعش|seventeen');
  add(18, 'تمنطاش|ثمنطاش|ثمنطاعش|اثمنطاعش|تمنطاعش|eighteen');
  add(19, 'تسعطاش|تسعطاعش|nineteen');
  add(20, 'عشرين|عشرون|vingt|twenty');
  // français transcrit en lettres arabes (reconnaissance « ar-MA »)
  add(5, 'سانك|سنك'); add(6, 'سيس'); add(7, 'سيت'); add(8, 'ويت'); add(9, 'نوف');
  add(10, 'ديس|ديز'); add(11, 'اونز|اونس'); add(12, 'دوز|دوس'); add(13, 'تريز|ترايز'); add(14, 'كاتورز|كاطورز');
  add(15, 'كانز|كينز|كنز'); add(16, 'سيز|سايز'); add(17, 'ديسيت|ديزسيت'); add(18, 'ديزويت'); add(19, 'ديزنوف');
  add(20, 'فان');
  add(30, 'trente|thirty'); add(40, 'quarante|forty'); add(50, 'cinquante|fifty');
  add(60, 'soixante|sixty'); add(70, 'seventy'); add(80, 'eighty'); add(90, 'ninety');

  const DEC_SEP = new Set(['virgule', 'point', 'فاصله', 'فاصل', 'فاصلة', 'فيرغول', 'فرغول', 'فيركول'].map(norm));

  // fractions placées après le nombre : [tokens, valeur]
  const FRACTIONS = [
    ['ونص', 0.5], ['و نص', 0.5], ['ونصف', 0.5], ['و نصف', 0.5],
    ['اي دمي', 0.5], ['ي دمي', 0.5], ['et demi', 0.5], ['et demie', 0.5], ['and a half', 0.5], ['and half', 0.5],
    ['وربع', 0.25], ['و ربع', 0.25], ['et quart', 0.25], ['and a quarter', 0.25],
    ['وتلت ارباع', 0.75], ['و تلت ارباع', 0.75], ['وثلاث ارباع', 0.75], ['و ثلاث ارباع', 0.75],
    ['وثلاثه ارباع', 0.75], ['et trois quarts', 0.75], ['and three quarters', 0.75],
    ['الا ربع', -0.25], ['غير ربع', -0.25], ['قل ربع', -0.25], ['moins le quart', -0.25], ['moins quart', -0.25],
  ].map(([p, v]) => [norm(p).split(' '), v]).sort((a, b) => b[0].length - a[0].length);

  // mots qui suivent la note et ne font pas partie du nom
  const OUT_OF = /(?:^|\s)(?:sur|على|علي|من|out of|over)\s+(?:20|vingt|twenty|عشرين)(?=\s|$)/g;
  const FILLERS = new Set(words(
    'عندو عندها عندهم خدا خدات خدي جاب جابت جابو داير دايره دار دارت نقطه النقطه نقطتو نقطتها هو هي ' +
    'التلميذ التلميذه تلميذ a eu obtient obtenu note noté notée la le les l élève got gets has scored the student'
  ));

  const ABSENT = new Set(words('غايب غايبه غائب غائبه غائبة غايبة غياب متغيب متغيبه ماجاش ماجاتش ماحاضرش absent absente absents'));
  // « لم أجد ورقته، مر للتالي » : laisser la case vide et passer (mode ordonné)
  const SKIP = new Set(words('التالي الموالي الموالية لموالي موراه مر مري فوت فوتو زيد سير نجد اجد لقيت لقيتش مالقيتش ماكايناش ماكاينش ماكاينه ورقته ورقتها ورقه suivant suivante passe passer next skip trouve trouvé'));
  // réponses à « هل تود تغييرها؟ »
  const YES = new Set(words('نعم اه آه ايه ايه ايوا ايوه اييه واخا وخا ياه بدلها بدل غيرها oui ouais ouai yes yeah yep ok okay daccord'));
  const NO = new Set(words('لا لالا لاء خليها خليه بلاش ماشي non no nope'));

  function isNumberStart(tokens, i) {
    const t = tokens[i];
    if (/^\d+(\.\d+)?$/.test(t)) return true;
    if (t in NUM) return true;
    if (t.length > 1 && t[0] === 'و' && t.slice(1) in NUM && NUM[t.slice(1)] <= 20) return true;
    return false;
  }

  // lit un nombre à partir de tokens[i] ; renvoie { value, end } (end exclusif) ou null
  function readNumber(tokens, i) {
    let t = tokens[i];
    let v; let j = i + 1;
    if (/^\d+(\.\d+)?$/.test(t)) v = parseFloat(t);
    else if (t in NUM) v = NUM[t];
    else if (t[0] === 'و' && t.slice(1) in NUM) v = NUM[t.slice(1)];
    else return null;

    // « خمسة عشر », « اثنا عشر » (arabe standard)
    if (v >= 1 && v <= 9 && (tokens[j] === 'عشر' || tokens[j] === 'عشره')) { v += 10; j++; }
    // « dix sept », « dix huit », « dix neuf » (sans trait d'union)
    else if (v === 10 && tokens[j] in NUM && NUM[tokens[j]] >= 7 && NUM[tokens[j]] <= 9 && /^[a-z]/.test(tokens[j])) { v += NUM[tokens[j]]; j++; }
    // « vingt cinq », « soixante quinze », « twenty five » (décimales dites en mots)
    else if (v >= 20 && v % 10 === 0 && tokens[j] in NUM && NUM[tokens[j]] >= 1 && NUM[tokens[j]] <= 19 && /^[a-z]/.test(tokens[j])) { v += NUM[tokens[j]]; j++; }

    // partie décimale : « virgule 25 », « point five », « فاصلة خمسة »
    if (tokens[j] && DEC_SEP.has(tokens[j]) && tokens[j + 1] !== undefined && isNumberStart(tokens, j + 1)) {
      const d = tokens[j + 1];
      if (/^\d+$/.test(d)) { v += parseFloat('0.' + d); j += 2; }
      else {
        const dn = readNumber(tokens, j + 1);
        if (dn) { v += dn.value < 10 ? dn.value / 10 : dn.value / 100; j = dn.end; }
      }
    }
    // fractions : « ونص », « et demi », « الا ربع »
    for (const [ph, fv] of FRACTIONS) {
      if (ph.every((w, k) => tokens[j + k] === w)) { v += fv; j += ph.length; break; }
    }
    return { value: Math.round(v * 100) / 100, end: j };
  }

  // ---------------------------------------------------------------- noms
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let p = Array.from({ length: n + 1 }, (_, k) => k);
    for (let i = 1; i <= m; i++) {
      const c = [i];
      for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      p = c;
    }
    return p[n];
  }
  const ratio = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);
  const stripAl = (t) => t.replace(/^ال(?=..)/, '').replace(/^ل(?=...)/, '');

  // translittération latin → lettres arabes (approximative, pour comparer des squelettes)
  const LAT = [['tch', 'تش'], ['dj', 'ج'], ['ch', 'ش'], ['sh', 'ش'], ['kh', 'خ'], ['gh', 'غ'], ['th', 'ث'], ['dh', 'ذ'], ['ph', 'ف'],
    ['ou', 'و'], ['oo', 'و'], ['gu', 'ك'], ['qu', 'ك'], ['ce', 'س'], ['ci', 'س'], ['cy', 'س'],
    ['b', 'ب'], ['t', 'ت'], ['j', 'ج'], ['h', 'ه'], ['d', 'د'], ['r', 'ر'], ['z', 'ز'], ['s', 'س'], ['c', 'ك'], ['q', 'ق'],
    ['k', 'ك'], ['l', 'ل'], ['m', 'م'], ['n', 'ن'], ['w', 'و'], ['y', 'ي'], ['f', 'ف'], ['v', 'ف'], ['p', 'ب'], ['g', 'ك'],
    ['x', 'كس'], ['a', ''], ['e', ''], ['i', ''], ['o', ''], ['u', '']];
  function latinToArabic(t) {
    let out = ''; let i = 0;
    while (i < t.length) {
      const hit = LAT.find(([l]) => t.startsWith(l, i));
      if (hit) { out += hit[1]; i += hit[0].length; } else i++;
    }
    return out.replace(/(.)\1+/g, '$1');
  }
  // squelette consonantique (comparaison latin ↔ arabe) : sans ال, sans voyelles ni ع/ء, lettres proches fusionnées
  // keepL : garder un ل initial (« لحلو » est un nom, « لعلوي » = « العلوي »)
  function skeleton(t, keepL) {
    const ar = keepL ? t.replace(/^ال(?=..)/, '') : stripAl(t);
    let s = /^[a-z]/.test(t) ? latinToArabic(t) : ar.replace(/[هة]$/, '');
    s = s.replace(/[اويعءئؤ]/g, '')
      .replace(/[ثت]/g, 'ت').replace(/[ذدض]/g, 'د').replace(/[صس]/g, 'س').replace(/[ظزط]/g, 'ز')
      .replace(/[حه]/g, 'ه').replace(/[قكگڭ]/g, 'ك').replace(/(.)\1+/g, '$1');
    return s;
  }
  const arLight = (t) => stripAl(t).replace(/[گڭ]/g, 'ك').replace(/[هة]$/, '');
  // forme « phonétique » d'un nom arabe : ce que la reconnaissance vocale écrit souvent autrement
  //  - voyelle finale ا / ه / ء (داها ↔ دها ↔ دهاء, حبة ↔ حب)
  //  - ا long au milieu (صابر ↔ صبر), lettres emphatiques (ص/س, ط/ت, ض/د, ظ/ز, ق/ك/گ, ح/ه), ع / ء
  function arPhon(t) {
    let s = stripAl(t).replace(/[گڭق]/g, 'ك');
    s = s.replace(/[اهءئ]+$/, '');
    s = s.charAt(0) + s.slice(1).replace(/[اءعئ]/g, '');
    return s.replace(/^[اعء]/, 'ا').replace(/ص/g, 'س').replace(/ط/g, 'ت').replace(/ض/g, 'د').replace(/ظ/g, 'ز').replace(/ح/g, 'ه').replace(/ث/g, 'ت').replace(/ذ/g, 'د').replace(/(.)\1+/g, '$1');
  }
  const isLatin = (t) => /^[a-z]/.test(t);
  function tokenSim(q, a) {
    if (isLatin(q) || isLatin(a)) {
      // écritures différentes (nom dit en français, ou fichier Massar en lettres latines) : comparer les squelettes
      let best = 0;
      for (const keepL of [false, true]) {
        const sq = skeleton(q, keepL), sa = skeleton(a, keepL);
        if (!sq || !sa) continue;
        if (Math.min(sq.length, sa.length) === 1 && (Math.min(q.length, a.length) < 3 || sq !== sa)) continue;
        best = Math.max(best, ratio(sq, sa) * 0.95);
      }
      return best;
    }
    const pq = arPhon(q), pa = arPhon(a);
    const phon = pq && pa ? ratio(pq, pa) * 0.92 : 0;
    return Math.max(ratio(q, a), ratio(arLight(q), arLight(a)), phon);
  }
  function prepareStudents(students) {
    return students.map((s) => {
      const tokens = words(s.name).filter((t) => t.length >= 2 && !/^(el|al)$/.test(t));
      // ى final se prononce « a » : يسرى ↔ يسرا
      const phon = words(String(s.name).replace(/ى(?=\s|$)/g, 'ا')).filter((t) => t.length >= 2).map(arPhon);
      // morceaux collés : nom entier dans les deux sens, et chaque suite de mots du nom
      // (« بو زيد » ↔ « بوزيد », « بن عبد الكريم » ↔ « بنعبد الكريم »)
      const raw = words(String(s.name).replace(/ى(?=\s|$)/g, 'ا')).filter((t) => t.length >= 2);
      const whole = [phon.slice().reverse().join(''), arPhon(raw.slice().reverse().join(''))];
      for (let i = 0; i < phon.length; i++) {
        for (let j = i + 1; j <= phon.length; j++) {
          whole.push(phon.slice(i, j).join(''));
          whole.push(arPhon(raw.slice(i, j).join(''))); // mots collés tels qu'ils se prononcent (« بنعبد الكريم » ↔ « بن عبدالكريم »)
        }
      }
      // mêmes morceaux en squelette consonantique, pour comparer arabe ↔ latin
      const sk = tokens.map(skeleton);
      const skWhole = [sk.slice().reverse().join('')];
      for (let i = 0; i < sk.length; i++) for (let j = i + 1; j <= sk.length; j++) skWhole.push(sk.slice(i, j).join(''));
      return { ...s, tokens, phon, whole, skWhole, latin: tokens.some(isLatin) };
    });
  }

  /**
   * @returns {{candidates: Array, score: number, suggestions: Array}}
   *   candidates : élève(s) retenu(s) (plusieurs = homonymes)
   *   score      : confiance 0..1
   *   suggestions: les 3 élèves les plus proches, même incertains (pour demander « من تقصد ؟ »)
   */
  function matchStudent(nameTokens, prepared) {
    // « ابن » = « بن » ; les mots d'une lettre sont ignorés
    const toks = nameTokens.map((t) => (t === 'ابن' ? 'بن' : t)).filter((t) => t.length >= 2 && !FILLERS.has(t));
    if (!toks.length) return { candidates: [], score: 0, suggestions: [] };
    const latin = toks.every((t) => /^[a-z]/.test(t));
    const qWhole = latin ? '' : toks.map(arPhon).join('');
    const qRaw = latin ? '' : arPhon(toks.join(''));
    const scored = prepared.map((s) => {
      let sc = 0; let hits = 0;
      for (const q of toks) {
        let b = 0;
        for (const a of s.tokens) b = Math.max(b, tokenSim(q, a));
        if (!isLatin(q) && !s.latin) { const pq = arPhon(q); for (const pa of s.phon) if (pq && pa) b = Math.max(b, ratio(pq, pa) * 0.92); }
        if (b >= 0.6) { sc += b; hits++; }
      }
      let norm = sc / toks.length;
      // écritures différentes : comparer aussi les squelettes collés (« بن عمر » ↔ « BENOMAR »)
      if (latin !== s.latin) {
        const qs = toks.map(skeleton).join('');
        if (qs.length >= 3) {
          const w = Math.max(...s.skWhole.map((x) => ratio(qs, x)));
          if (w >= 0.75) { norm = Math.max(norm, w * 0.9); hits = Math.max(hits, 1); }
        }
      }
      // mots collés ou coupés autrement par la reconnaissance : comparer le nom entier
      if (qWhole.length >= 3 && !s.latin) {
        const w = Math.max(...s.whole.map((x) => Math.max(ratio(qWhole, x), ratio(qRaw, x))));
        if (w >= 0.7) { norm = Math.max(norm, w * 0.95); hits = Math.max(hits, 1); }
      }
      return { s, norm, hits };
    }).sort((a, b) => b.norm - a.norm);
    const suggestions = scored.filter((x) => x.norm >= 0.35).slice(0, 3).map((x) => x.s);
    const good = scored.filter((x) => x.hits > 0);
    if (!good.length) return { candidates: [], score: 0, suggestions, second: 0 };
    const top = good[0].norm;
    const tied = good.filter((x) => top - x.norm < 0.05).map((x) => x.s);
    const second = (scored.find((x) => !tied.includes(x.s)) || { norm: 0 }).norm; // élève suivant le plus proche
    return { candidates: tied, score: Math.min(1, top), suggestions, second };
  }

  // ---------------------------------------------------------------- phrase complète
  /**
   * @param {string} text       transcription (une ou plusieurs entrées)
   * @param {Array}  prepared   résultat de prepareStudents()
   * @returns {Array} événements
   */
  function parse(text, prepared) {
    const n = norm(text).replace(OUT_OF, ' ').replace(/\/\s*20(?=\s|$)/g, ' ');
    const tokens = n.split(/[\s،؛;,!?]+/).filter(Boolean);
    const events = [];

    // « لم أجد ورقته، مر للتالي » (sans note ni « absent »)
    if (tokens.length && !tokens.some((t, i) => isNumberStart(tokens, i)) && !tokens.some((t) => ABSENT.has(t))) {
      const skipHits = tokens.filter((t) => SKIP.has(t) || SKIP.has(t.replace(/^(ل|لل|و)/, ''))).length;
      if (skipHits && skipHits >= tokens.length / 3) return [{ type: 'skip', raw: text }];
    }

    let buf = []; let absentFirst = false;
    const flush = (kind, value) => {
      const m = matchStudent(buf, prepared);
      const raw = buf.join(' ');
      const ev = { type: kind, raw, value: kind === 'grade' ? value : null, candidates: m.candidates, score: m.score, suggestions: m.suggestions };
      if (kind === 'grade' && (value < 0 || value > 20)) { ev.status = 'bad'; ev.reason = 'النقطة خارج المجال 0–20'; }
      else if (!m.candidates.length) { ev.status = 'bad'; ev.reason = raw ? 'التلميذ غير موجود في اللائحة' : 'لم أسمع اسم التلميذ'; }
      else if (m.candidates.length > 1) { ev.status = 'ambiguous'; ev.reason = 'عدة تلاميذ بهذا الاسم'; }
      // nom approximatif : on ne demande confirmation que si un autre élève lui ressemble aussi
      else if (m.score < 0.8 && !(m.score >= 0.65 && m.second < 0.5)) { ev.status = 'check'; ev.reason = 'تأكد من اسم التلميذ'; }
      else ev.status = 'ok';
      events.push(ev);
      buf = [];
    };

    for (let i = 0; i < tokens.length;) {
      const t = tokens[i];
      if (ABSENT.has(t)) {
        if (buf.length) flush('absent'); else absentFirst = true;
        i++; continue;
      }
      if (isNumberStart(tokens, i)) {
        const num = readNumber(tokens, i);
        if (num && buf.length) { flush('grade', num.value); i = num.end; continue; }
        // note sans nom : en mode « ordonné » elle s'applique à l'élève courant
        if (num) {
          const bad = num.value < 0 || num.value > 20;
          events.push({ type: 'grade', raw: '', value: num.value, candidates: [], score: 0, noName: true,
            status: bad ? 'bad' : 'noname', reason: bad ? 'النقطة خارج المجال 0–20' : 'لم أسمع اسم التلميذ' });
          i = num.end; continue;
        }
      }
      if (!FILLERS.has(t)) buf.push(t);
      i++;
      // « غايب ندى » : le nom suit le mot « absent »
      if (absentFirst && buf.length && (i >= tokens.length || ABSENT.has(tokens[i]) || isNumberStart(tokens, i))) {
        // attendre la fin du nom : on prend tous les tokens non numériques qui suivent
        while (i < tokens.length && !ABSENT.has(tokens[i]) && !isNumberStart(tokens, i)) { if (!FILLERS.has(tokens[i])) buf.push(tokens[i]); i++; }
        flush('absent'); absentFirst = false;
      }
    }
    if (absentFirst && !buf.length) {
      // « غايب » seul : l'élève courant (mode ordonné)
      events.push({ type: 'absent', raw: '', value: null, candidates: [], score: 0, noName: true, status: 'noname', reason: 'لم أسمع اسم التلميذ' });
    } else if (buf.length) {
      if (absentFirst) flush('absent');
      else flush('name'); // nom seul, sans note : l'élève est sélectionné, la note viendra ensuite
    }
    return events;
  }

  // nombre → texte arabe lisible pour la confirmation vocale
  function speakValue(v) {
    const int = Math.floor(v); const frac = Math.round((v - int) * 100);
    const s = String(int);
    if (frac === 0) return s;
    if (frac === 50) return s + ' ونصف';
    if (frac === 25) return s + ' وربع';
    if (frac === 75) return s + ' وثلاثة أرباع';
    return String(v).replace('.', ' فاصلة ');
  }

  // réponse oui / non ; null si la phrase n'est ni l'un ni l'autre
  function yesNo(text) {
    const t = words(text);
    const y = t.some((w) => YES.has(w)); const n = t.some((w) => NO.has(w));
    if (y && !n) return 'yes';
    if (n && !y) return 'no';
    return null;
  }

  // choix « 1 / 2 / 3 » parmi des propositions ; null si ce n'est pas un choix
  function choice(text, max) {
    const t = words(text);
    for (let i = 0; i < t.length; i++) {
      const r = readNumber(t, i);
      if (r && Number.isInteger(r.value) && r.value >= 1 && r.value <= max) return r.value;
    }
    return null;
  }

  return { norm, words, parse, yesNo, choice, prepareStudents, matchStudent, readNumber, speakValue, skeleton, arPhon };
});
