/*
 * Lecture et écriture d'un fichier de notes exporté de Massar (.xlsx).
 *
 * Principe : on NE reconstruit PAS le classeur. On lit le XML de la feuille,
 * puis on remplace uniquement le contenu des cellules de notes. Tout le reste
 * (protection, lignes cachées, codes #1# #2#…, validations) reste identique
 * octet pour octet, pour que Massar accepte le fichier au retour.
 *
 * Dépend de JSZip (window.JSZip dans le navigateur, require('jszip') sous Node).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Massar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ utilitaires XML
  const decodeXml = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

  const colToNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const numToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const clean = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').toLowerCase()
    .replace(/[آأإ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim();

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g; let m;
    while ((m = re.exec(xml))) {
      const inner = m[1] || '';
      let text = ''; const tr = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let t;
      while ((t = tr.exec(inner))) text += decodeXml(t[1]);
      out.push(text);
    }
    return out;
  }

  // renvoie Map "G19" → { col, row, value, raw }
  function parseCells(sheetXml, shared) {
    const cells = new Map();
    const re = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let m;
    while ((m = re.exec(sheetXml))) {
      const [, col, row, attrs, inner] = m;
      let value = null;
      if (inner) {
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (type === 's' && v != null) value = shared[+v] ?? '';
        else if (type === 'inlineStr') value = decodeXml((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
        else if (type === 'str' || type === 'e') value = v != null ? decodeXml(v) : null;
        else if (type === 'b') value = v === '1';
        else if (v != null && v !== '') value = Number(v);
      }
      cells.set(col + row, { col, row: +row, value });
    }
    return cells;
  }

  // ------------------------------------------------------------ lecture
  async function locateSheet(zip) {
    const wb = await zip.file('xl/workbook.xml').async('string');
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    const rels = relsFile ? await relsFile.async('string') : '';
    const sheets = [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
      name: decodeXml((m[1].match(/\bname="([^"]*)"/) || [])[1] || ''),
      rid: (m[1].match(/\br:id="([^"]*)"/) || [])[1],
      hidden: /\bstate="(hidden|veryHidden)"/.test(m[1]),
    }));
    const pick = sheets.find((s) => /notes/i.test(s.name)) || sheets.find((s) => !s.hidden) || sheets[0];
    const rel = pick && rels.match(new RegExp('<Relationship[^>]*Id="' + escRe(pick.rid) + '"[^>]*>'));
    let target = rel && (rel[0].match(/Target="([^"]+)"/) || [])[1];
    if (!target) target = 'worksheets/sheet1.xml';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    return { name: pick ? pick.name : '', path: 'xl/' + target };
  }

  /**
   * @param {ArrayBuffer|Uint8Array} data  contenu du fichier
   * @param {object} JSZip
   * @returns {Promise<object>} classeur analysé
   */
  async function read(data, JSZip) {
    let zip;
    try { zip = await JSZip.loadAsync(data); } catch (e) { throw new MassarError('هذا الملف ليس ملف Excel (.xlsx).'); }
    if (!zip.file('xl/workbook.xml')) throw new MassarError('هذا الملف ليس ملف Excel (.xlsx).');
    const sheet = await locateSheet(zip);
    const sheetFile = zip.file(sheet.path);
    if (!sheetFile) throw new MassarError('ورقة النقط غير موجودة داخل الملف.');
    const sheetXml = await sheetFile.async('string');
    const ssFile = zip.file('xl/sharedStrings.xml');
    const shared = parseSharedStrings(ssFile ? await ssFile.async('string') : '');
    const cells = parseCells(sheetXml, shared);
    const layout = detectLayout(cells);
    return { zip, sheetPath: sheet.path, sheetXml, ...layout };
  }

  function detectLayout(cells) {
    const all = [...cells.values()];
    const text = (c) => (typeof c.value === 'string' ? clean(c.value) : '');
    const at = (col, row) => cells.get(col + row);

    // ligne des sous-titres « النقطة »
    // en-têtes en arabe ou en français
    const noteCells = all.filter((c) => text(c) === 'النقطه' || text(c) === 'note');
    if (!noteCells.length) throw new MassarError('هذا الملف ليس ملف نقط مستخرجا من مسار (أعمدة «النقطة» غير موجودة).');
    const subRow = Math.min(...noteCells.map((c) => c.row));
    const gradeCells = noteCells.filter((c) => c.row === subRow).sort((a, b) => colToNum(a.col) - colToNum(b.col));

    // colonne du nom de l'élève
    const nameHead = all.find((c) => c.row <= subRow && /اسم\s*التلميذ|^nom\b|nom (de l')?eleve|nom et prenom/.test(text(c)));
    if (!nameHead) throw new MassarError('هذا الملف ليس ملف نقط مستخرجا من مسار (عمود «اسم التلميذ» غير موجود).');
    const codeHead = all.find((c) => c.row <= subRow && /رقم\s*التلميذ|code/.test(text(c)));

    // libellé de chaque colonne de notes (ligne au-dessus, ou cellule fusionnée à gauche)
    const columns = gradeCells.map((g) => {
      let label = '';
      for (let n = colToNum(g.col); n >= 1 && !label; n--) {
        const c = at(numToCol(n), subRow - 1);
        if (c && typeof c.value === 'string' && c.value.trim()) label = c.value.trim();
      }
      const next = at(numToCol(colToNum(g.col) + 1), subRow);
      return { col: g.col, label: label || 'عمود ' + g.col, absenceCol: next && /^(التغيب|absence)$/.test(text(next)) ? next.col : null };
    }).filter((c) => !/ملاحظات|observation|remarque|appreciation/.test(clean(c.label)));

    // élèves : lignes après les sous-titres tant que le nom est rempli
    const students = [];
    for (let r = subRow + 1; r < subRow + 2000; r++) {
      const nc = at(nameHead.col, r);
      const name = nc && typeof nc.value === 'string' ? nc.value.replace(/\s+/g, ' ').trim() : '';
      if (!name) { if (students.length) break; else continue; }
      const grades = {};
      for (const col of columns) {
        const v = at(col.col, r);
        grades[col.col] = v && typeof v.value === 'number' ? v.value : null;
      }
      students.push({ row: r, name, code: codeHead ? (at(codeHead.col, r) || {}).value || '' : '', grades });
    }
    if (!students.length) throw new MassarError('لا يوجد أي تلميذ في الملف.');

    // informations du groupe : valeur à droite de l'étiquette
    const info = {};
    const labels = { niveau: ['المستوي', 'niveau'], classe: ['القسم', 'classe'], prof: ['الاستاذ', 'enseignant', 'professeur'],
      session: ['الدوره', 'session', 'semestre'], matiere: ['الماده', 'matiere'], annee: ['السنه الدراسيه', 'annee scolaire'] };
    for (const [key, labs] of Object.entries(labels)) {
      const lc = all.find((c) => c.row < subRow - 1 && labs.includes(text(c).replace(/[:：]/g, '').trim()));
      if (!lc) continue;
      for (let n = colToNum(lc.col) + 1; n < colToNum(lc.col) + 8; n++) {
        const v = at(numToCol(n), lc.row);
        if (v && v.value != null && String(v.value).trim()) { info[key] = String(v.value).trim(); break; }
      }
    }
    return { info, columns, students };
  }

  // ------------------------------------------------------------ écriture
  const fmt = (v) => String(Math.round(v * 100) / 100);

  // remplace / vide / insère une cellule numérique dans le XML de la feuille
  function setCell(xml, ref, value) {
    const re = new RegExp('<c r="' + ref + '"([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)');
    const m = xml.match(re);
    const build = (attrs) => {
      attrs = attrs.replace(/\s+t="[^"]*"/, '');
      return value == null ? '<c r="' + ref + '"' + attrs + '/>' : '<c r="' + ref + '"' + attrs + '><v>' + fmt(value) + '</v></c>';
    };
    if (m) return xml.replace(re, () => build(m[1]));
    if (value == null) return xml;

    // cellule absente : l'insérer dans la ligne, à la bonne place
    const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/);
    const rowRe = new RegExp('<row r="' + row + '"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/row>)');
    const rm = xml.match(rowRe);
    const cell = '<c r="' + ref + '"><v>' + fmt(value) + '</v></c>';
    if (!rm) throw new MassarError('السطر ' + row + ' غير موجود في الملف.');
    const inner = rm[2] || '';
    const parts = inner.match(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    let placed = false; const out = [];
    for (const p of parts) {
      const pc = p.match(/<c r="([A-Z]+)/)[1];
      if (!placed && colToNum(pc) > colToNum(col)) { out.push(cell); placed = true; }
      out.push(p);
    }
    if (!placed) out.push(cell);
    const attrs = rm[1].replace(/\s+spans="[^"]*"/, '');
    return xml.replace(rowRe, () => '<row r="' + row + '"' + attrs + '>' + out.join('') + '</row>');
  }

  /**
   * @param {object} book     résultat de read()
   * @param {object} changes  { "I19": 12.5, "I20": null, … }  (null = vider)
   * @returns {Promise<Uint8Array>}
   */
  async function write(book, changes) {
    let xml = book.sheetXml;
    for (const [ref, v] of Object.entries(changes)) {
      if (v != null && (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 20)) throw new MassarError('نقطة غير صالحة في ' + ref);
      xml = setCell(xml, ref, v);
    }
    const zip = book.zip;
    zip.file(book.sheetPath, xml, { createFolders: false });
    const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    zip.file(book.sheetPath, book.sheetXml, { createFolders: false }); // remettre l'original en mémoire
    return out;
  }

  class MassarError extends Error {}

  return { read, write, setCell, parseCells, parseSharedStrings, detectLayout, colToNum, numToCol, MassarError };
});
