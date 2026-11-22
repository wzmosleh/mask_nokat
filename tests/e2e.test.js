// node tests/e2e.test.js — parcours complet dans Chromium (la voix est simulée par la saisie texte)
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const JSZip = require('jszip');
const M = require('../massar.js');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let fail = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) fail++; };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);

  const say = async (t) => { await page.fill('#typeIn', t); await page.press('#typeIn', 'Enter'); await page.waitForTimeout(80); };
  const fb = () => page.textContent('.feedback');
  const cur = () => page.textContent('.current .name');

  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixture-massar.xlsx'));
  await page.waitForSelector('[data-col]');
  ok((await page.$$('[data-col]')).length === 3, 'trois colonnes proposées');
  ok(await page.isDisabled('[data-act="start"]'), 'impossible de commencer sans choix');
  await page.click('[data-col="I"]');
  await page.click('[data-mode="ordered"]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.current');

  // mode ordonné
  ok((await cur()) === 'العلوي سلمى', 'commence au premier élève');
  await say('طناش ونص');
  ok((await fb()).includes('12.5') && (await cur()) === 'بناني أمين', 'note seule → enregistrée, passe au suivant');
  await say('غايب');
  ok((await fb()).includes('غائب') && (await cur()) === 'الإدريسي يوسف', 'absent → marqué, suivant');
  await say('لم أجد ورقته مر للتالي');
  ok((await cur()) === 'التازي فاطمة الزهراء', 'feuille manquante → case vide, suivant');
  await say('بلا بلا');
  ok((await page.$('.feedback.fb-err')) !== null && (await cur()) === 'التازي فاطمة الزهراء', 'phrase incomprise → croix rouge, reste sur l\'élève');
  await say('25');
  ok((await page.$('.feedback.fb-err')) !== null && (await fb()).includes('بين 0 و20'), 'note > 20 refusée avec le bon message');
  await say('quinze virgule vingt-cinq');
  ok((await cur()) === 'برادة حمزة', 'français accepté');
  await say('الأنصاري بدر سبعطاش');
  ok((await fb()).includes('الأنصاري بدر') && (await cur()) === 'برادة حمزة', 'nom + note → saut puis retour au premier non rempli');
  await say('سلمى العلوي 14');
  ok((await page.$('.feedback.fb-warn')) !== null && (await fb()).includes('12.5'), 'note existante → question');
  await say('ممم');
  ok((await page.$('.feedback.fb-warn')) !== null, 'autre réponse → redemande oui/non');
  await say('نعم');
  ok((await fb()).includes('14'), '« نعم » → note changée');
  await say('بناني أمين 9');
  ok((await page.$('.feedback.fb-warn')) === null && (await fb()).includes('9'), 'absent puis note → note enregistrée');
  await say('سلمى 11');
  ok((await fb()).includes('الاسم الكامل'), 'homonymes → demander le nom complet');

  // reprise après fermeture du navigateur
  await page.reload();
  await page.waitForSelector('[data-act="resume"]');
  ok(true, 'au retour : proposition de reprendre');
  await page.click('[data-act="resume"]');
  await page.waitForSelector('[data-act="start"]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.current');
  ok((await cur()) === 'برادة حمزة', 'reprise au bon élève');

  // finir la liste en mode ordonné
  for (let i = 0; i < 40; i++) {
    if (await page.$('h1:has-text("مراجعة")')) break;
    if (!(await page.$('#typeIn'))) { await page.waitForTimeout(300); continue; }
    await say(String(10 + (i % 10)));
  }
  await page.waitForSelector('h1:has-text("مراجعة")', { timeout: 3000 });
  ok(true, 'arrêt automatique après le dernier élève → révision');
  const stats = await page.$$eval('.stat b', (b) => b.map((x) => x.textContent));
  ok(stats[2] === '0', 'absent remplacé par une note : 0 absent (' + stats.join('/') + ')');

  // modification manuelle en révision
  await page.fill('input[data-row="19"]', '13.5');
  await page.press('input[data-row="19"]', 'Tab');

  // sauvegarde
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
  await page.waitForSelector('[data-act="closeModal"]');
  ok((await page.$('[data-act="share"]')) === null, 'pas de bouton d\'envoi : téléchargement seulement');
  ok(dl.suggestedFilename() === 'fixture-massar.xlsx', 'même nom de fichier');
  const out = path.join(os.tmpdir(), 'notes-vocales-e2e.xlsx');
  await dl.saveAs(out);
  const book = await M.read(fs.readFileSync(out), JSZip);
  const I = (row) => book.students.find((s) => s.row === row).grades.I;
  ok(I(18) === 14 && I(19) === 13.5 && I(20) === null && I(21) === 15.25 && I(44) === 17, `notes écrites : ${I(18)}, ${I(19)}, ${I(20)}, ${I(21)}, ${I(44)}`);
  const orig = await M.read(fs.readFileSync(path.join(__dirname, 'fixture-massar.xlsx')), JSZip);
  ok(book.students.every((s, i) => s.grades.G === orig.students[i].grades.G && s.grades.K === orig.students[i].grades.K), 'autres colonnes intactes');
  const xml = await (await JSZip.loadAsync(fs.readFileSync(out))).file('xl/worksheets/sheet1.xml').async('string');
  ok(!/<c r="J(1[89]|[2-9]\d)"[^>]*><v>/.test(xml), 'colonne d\'absence laissée vide');

  // mode éparpillé
  await page.click('[data-act="closeModal"]');
  await page.click('[data-step="setup"]');
  await page.click('[data-col="K"]');
  await page.click('[data-mode="free"]');
  await page.click('.stepbar [data-act="start"]');
  await page.waitForSelector('.current.free');
  await say('طناش ونص');
  ok((await fb()).includes('ذكر اسم التلميذ'), 'mode éparpillé : note sans nom → demander le nom');
  await say('حمزة تسعود، مريم عشرين');
  ok((await fb()).includes('20') && (await fb()).includes('9'), 'plusieurs élèves dans une phrase, deux confirmations');
  // nom seul, puis la note
  await say('خديجة العمراني');
  ok((await cur()) === 'العمراني خديجة', 'nom seul → élève sélectionné');
  await say('خمسطاش');
  ok((await fb()).includes('العمراني خديجة') && (await fb()).includes('15'), 'puis la note seule → enregistrée pour cet élève');
  // nom incertain → question
  await say('عثمان الفاسي البناني 13');
  ok((await fb()).includes('الفاسي عثمان') && (await fb()).includes('13'), 'nom approximatif sans autre élève proche → enregistré sans question');
  await say('سلمى العزيز 14');
  const opts = await page.$$eval('.opt', (o) => o.map((x) => x.textContent));
  ok(opts.length === 2 && opts[1].includes('بوزيد سلمى'), 'deux élèves proches → proposés et numérotés : ' + opts.join(' | '));
  await say('2');
  ok((await fb()).includes('بوزيد سلمى') && (await fb()).includes('14'), '« 2 » → note enregistrée pour le deuxième proposé');
  // nom introuvable mais proche : propositions, puis le nom complet répété
  await say('زكريا الخليفة البناني 11');
  await say('زكرياء الخليفي 11');
  ok((await fb()).includes('الخليفي زكرياء') && (await fb()).includes('11'), 'répéter le nom complet pendant la question → pris en compte');
  // liste dans l'ordre de saisie
  const order = await page.$$eval('.list .stu:not(.head) .n', (n) => n.slice(0, 4).map((x) => x.textContent));
  ok(JSON.stringify(order) === JSON.stringify(['برادة حمزة', 'الشرايبي مريم', 'العمراني خديجة', 'الفاسي عثمان']), 'liste dans l\'ordre de saisie : ' + order.join(', '));
  // révision : ordre de saisie, puis enregistrement dans l'ordre Massar
  await page.click('[data-act="toReview"]');
  await page.waitForSelector('[data-order="entry"][aria-pressed="true"]');
  const revFirst = await page.$$eval('tbody tr td:nth-child(2)', (n) => n.slice(0, 2).map((x) => x.textContent));
  ok(revFirst[0] === 'برادة حمزة', 'révision dans l\'ordre de saisie');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
  await dl2.saveAs(out);
  const b2 = await M.read(fs.readFileSync(out), JSZip);
  ok(JSON.stringify(b2.students.map((s) => s.name)) === JSON.stringify(orig.students.map((s) => s.name)), 'fichier enregistré dans l\'ordre Massar');
  const K = (row) => b2.students.find((s) => s.row === row).grades.K;
  ok(K(22) === 9 && K(23) === 20 && K(27) === 15 && K(24) === 13 && b2.students.find((s) => s.row === 18).grades.I === 14, 'deux colonnes enregistrées (I et K)');
  await page.click('[data-act="closeModal"]');

  // navigation : bouton « الرئيسية » toujours en haut, travail conservé
  await page.click('#homeBtn');
  ok((await page.$('#drop')) !== null && (await page.$('[data-act="resume"]')) !== null, '« الرئيسية » → écran d\'accueil, saisie proposée à la reprise');
  await page.click('[data-act="resume"]');
  await page.waitForSelector('[data-step="review"]');
  await page.click('[data-step="review"]');
  await page.waitForSelector('h1:has-text("مراجعة")');
  ok(true, 'barre des étapes → retour direct à la vérification');

  // interface en français
  await page.click('#langBtn');
  ok((await page.getAttribute('html', 'dir')) === 'ltr' && (await page.textContent('h1')).startsWith('Vérification'), 'interface en français');
  await page.click('#langBtn');
  ok((await page.getAttribute('html', 'dir')) === 'rtl', 'retour à l\'arabe');

  ok(errors.length === 0, 'aucune erreur JavaScript ' + errors.join(' | '));
  await page.screenshot({ path: path.join(os.tmpdir(), 'notes-vocales-e2e.png') });
  await browser.close();
  server.close();
  console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests passent');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
