// node tests/speech.test.js — reconnaissance vocale simulée (résultats provisoires puis définitifs)
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

// remplace la reconnaissance de Chrome par un objet piloté par le test
const FAKE = `
  class FakeSR { constructor() { window.__sr = this; } start() { this.onstart && this.onstart(); } stop() { this.onend && this.onend(); } abort() {} }
  window.SpeechRecognition = undefined;
  window.webkitSpeechRecognition = FakeSR;
  window.__emit = (idx, text, isFinal) => {
    const results = []; results[idx] = { isFinal, length: 1, 0: { transcript: text } };
    window.__sr.onresult({ resultIndex: idx, results });
  };
`;

let fail = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) fail++; };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(FAKE);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixture-massar.xlsx'));
  await page.click('[data-col="I"]');
  await page.click('[data-mode="ordered"]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.current');

  const emit = (i, t, f) => page.evaluate(([i, t, f]) => window.__emit(i, t, f), [i, t, f]);
  const cur = () => page.textContent('.current .name');
  const val = (n) => page.$$eval('.stu:not(.head) .new', (e, n) => e[n].textContent.trim(), n);

  await emit(0, 'طناش', false);
  await page.waitForTimeout(700);
  ok((await cur()) === 'العلوي سلمى' && (await val(0)) === '', 'note entière provisoire : on attend la fin');
  await emit(0, 'طناش ونص', false);
  await page.waitForTimeout(700);
  ok((await val(0)) === '12.5' && (await cur()) === 'بناني أمين', 'note décimale provisoire et stable → enregistrée sans attendre');
  await emit(0, 'طناش ونص', true);
  await page.waitForTimeout(200);
  ok((await cur()) === 'بناني أمين' && (await val(1)) === '', 'résultat définitif identique → pas de double saisie');

  await emit(1, '14', false);
  await page.waitForTimeout(700);
  ok((await val(1)) === '', '« 14 » provisoire : pas encore enregistré');
  await emit(1, '14', true);
  await page.waitForTimeout(200);
  ok((await val(1)) === '14' && (await cur()) === 'الإدريسي يوسف', '« 14 » définitif → enregistré');

  await emit(2, 'quinze virgule vingt-cinq', false);
  await page.waitForTimeout(700);
  ok((await val(2)) === '15.25', 'virgule en français → enregistrée sans attendre');
  await emit(2, 'quinze virgule vingt-cinq غايب', true);
  await page.waitForTimeout(200);
  ok((await page.textContent('.feedback')).includes('غائب') && (await cur()) === 'برادة حمزة', 'mot ajouté après coup → traité aussi');

  await emit(3, '25', true);
  await page.waitForTimeout(200);
  ok((await page.textContent('.feedback')).includes('بين 0 و20'), 'note hors 0–20 → rappel de l\'intervalle');

  ok(errors.length === 0, 'aucune erreur JavaScript ' + errors.join(' | '));
  await browser.close();
  server.close();
  console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests passent');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
