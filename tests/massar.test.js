// node tests/massar.test.js — lecture / écriture d'un fichier Massar (fichier de test anonymisé)
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const M = require('../massar.js');

let fail = 0;
const ok = (cond, msg) => { console.log(cond ? '✓' : '✗', msg); if (!cond) fail++; };

(async () => {
  const data = fs.readFileSync(path.join(__dirname, 'fixture-massar.xlsx'));
  const book = await M.read(data, JSZip);

  ok(book.students.length === 27, '27 élèves lus');
  ok(book.students[0].name === 'العلوي سلمى' && book.students[0].row === 18, 'premier élève, ligne 18');
  ok(book.students[26].name === 'الأنصاري بدر' && book.students[26].row === 44, 'dernier élève, ligne 44');
  ok(JSON.stringify(book.columns.map((c) => c.label)) === JSON.stringify(['الفرض الأول', 'الفرض الثاني', 'الأنشطة المندمجة']), 'colonnes détectées : ' + book.columns.map((c) => c.label).join(', '));
  ok(book.columns.every((c) => c.absenceCol), 'colonnes d\'absence repérées (non modifiées)');
  ok(book.info.classe === '3APIC-T' && book.info.session === 'الدورة الأولى', 'informations du groupe');
  ok(book.students[0].grades.G === null && typeof book.students[1].grades.G === 'number', 'notes existantes lues');

  // écriture
  const out = await M.write(book, { I18: 12.5, I19: 0, I44: 20, G19: 7.25 });
  const before = await JSZip.loadAsync(data);
  const after = await JSZip.loadAsync(out);
  const names = Object.keys(before.files);
  ok(JSON.stringify(names) === JSON.stringify(Object.keys(after.files)), 'mêmes fichiers internes, même ordre');
  let changed = [];
  for (const n of names) {
    const a = await before.file(n).async('uint8array');
    const b = await after.file(n).async('uint8array');
    if (Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0) changed.push(n);
  }
  ok(JSON.stringify(changed) === JSON.stringify(['xl/worksheets/sheet1.xml']), 'seule la feuille de notes change : ' + changed.join(', '));

  const xa = await before.file('xl/worksheets/sheet1.xml').async('string');
  const xb = await after.file('xl/worksheets/sheet1.xml').async('string');
  ok((xb.match(/<sheetProtection[^>]*>/) || [])[0] === (xa.match(/<sheetProtection[^>]*>/) || [])[0], 'protection de la feuille conservée');
  ok(xb.includes('x14:dataValidation') && xb.includes('Data!$A$1:$A$2'), 'liste « مبرر » conservée');

  const reread = await M.read(out, JSZip);
  const g = (row, col) => reread.students.find((s) => s.row === row).grades[col];
  ok(g(18, 'I') === 12.5 && g(19, 'I') === 0 && g(44, 'I') === 20 && g(19, 'G') === 7.25, 'notes écrites relues : 12.5, 0, 20, 7.25');
  ok(g(20, 'G') === book.students[2].grades.G, 'autres notes inchangées');
  ok(xb.length - xa.length < 200, 'différence minimale dans la feuille');

  // le livre reste réutilisable (deuxième sauvegarde)
  const out2 = await M.write(book, { K18: 15 });
  const r2 = await M.read(out2, JSZip);
  ok(r2.students[0].grades.K === 15 && r2.students[0].grades.I === null, 'deuxième sauvegarde repart du fichier d\'origine');

  // valeurs refusées
  let threw = false; try { await M.write(book, { I18: 21 }); } catch (e) { threw = e instanceof M.MassarError; }
  ok(threw, 'note > 20 refusée');

  // cellule absente du XML : insertion à la bonne place
  const xml = '<sheetData><row r="5" spans="1:3"><c r="A5" t="s"><v>0</v></c><c r="C5"><v>1</v></c></row></sheetData>';
  const x2 = M.setCell(xml, 'B5', 9.5);
  ok(x2.includes('<c r="A5" t="s"><v>0</v></c><c r="B5"><v>9.5</v></c><c r="C5"><v>1</v></c>'), 'insertion d\'une cellule manquante');
  ok(M.setCell('<row r="2"><c r="D2" s="3" t="s"><v>4</v></c></row>', 'D2', 11).includes('<c r="D2" s="3"><v>11</v></c>'), 'remplacement d\'une cellule texte (style conservé)');
  ok(M.setCell('<row r="2"><c r="D2" s="3"><v>4</v></c></row>', 'D2', null).includes('<c r="D2" s="3"/>'), 'vidage d\'une cellule');

  // fichier qui n'est pas un export Massar
  threw = false; try { await M.read(Buffer.from('pas un zip'), JSZip); } catch (e) { threw = e instanceof M.MassarError; }
  ok(threw, 'fichier invalide refusé avec un message clair');

  console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests passent');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
