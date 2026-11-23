// node tests/android.test.js — application Android simulée (Capacitor factice)
const { chromium, devices } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const JSZip = require('jszip');
const M = require('../massar.js');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

// Capacitor factice : le test fournit les phrases « entendues » une par une
const FAKE = `
  window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
  const log = window.__log = { spoken: [], files: {}, shared: null, started: 0, back: null };
  const queue = window.__say = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      SpeechRecognition: {
        checkPermissions: async () => ({ speechRecognition: 'prompt' }),
        requestPermissions: async () => ({ speechRecognition: 'granted' }),
        start: () => new Promise((resolve, reject) => {
          log.started++;
          const tick = () => { if (queue.length) resolve({ matches: queue.shift() }); else setTimeout(tick, 50); };
          setTimeout(() => (queue.length ? tick() : reject(new Error('No match'))), 120);
        }),
        stop: async () => {},
      },
      TextToSpeech: { speak: async (o) => { log.spoken.push(o); } },
      Filesystem: { writeFile: async (o) => { log.files[o.directory + '/' + o.path] = o.data; return { uri: 'file:///cache/' + o.path }; } },
      Share: { share: async (o) => { log.shared = o; } },
      App: { addListener: (ev, fn) => { if (ev === 'backButton') log.back = fn; }, exitApp: () => { log.exited = true; } },
    },
  };
`;

let fail = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) fail++; };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['Pixel 5'] })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(FAKE);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://localhost:${server.address().port}/`);

  ok(!(await page.$('.alert-warn')), 'pas d\'alerte « reconnaissance vocale non disponible » dans l\'application');
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixture-massar.xlsx'));
  await page.click('[data-col="I"]');
  await page.click('[data-mode="ordered"]');
  await page.click('.stepbar [data-act="start"]');
  await page.waitForSelector('.current');
  ok(await page.isHidden('#permHint'), 'pas de consigne sur la permission du navigateur');

  const hear = (alts) => page.evaluate((a) => window.__say.push(a), alts);
  const cur = () => page.textContent('.current .name');
  await hear(['طناش ونص', 'طناش و نص']);
  await page.waitForFunction(() => document.querySelector('.current .name').textContent === 'بناني أمين');
  ok(true, 'phrase reconnue par Android → note enregistrée, élève suivant');
  await hear(['بلا بلا']);
  await page.waitForSelector('.feedback.fb-err');
  await page.waitForTimeout(200);
  const spoken = await page.evaluate(() => window.__log.spoken);
  ok(spoken.length > 0 && spoken[spoken.length - 1].lang === 'ar', 'la voix Android dit le message en arabe : ' + JSON.stringify(spoken[spoken.length - 1]));
  await hear(['quatorze']);
  await page.waitForFunction(() => document.querySelector('.current .name').textContent === 'الإدريسي يوسف');
  ok((await page.evaluate(() => window.__log.started)) >= 3, 'l\'écoute est relancée après chaque phrase');

  await page.click('.stepbar [data-act="toReview"]');
  await page.click('.stepbar [data-act="save"]');
  await page.waitForSelector('[data-act="share"]');
  ok((await page.textContent('#modalCard')).includes('Documents/Massar/fixture-massar.xlsx'), 'fichier enregistré dans Documents/Massar du téléphone');
  const saved = await page.evaluate(() => window.__log.files['DOCUMENTS/Massar/fixture-massar.xlsx']);
  const book = await M.read(Buffer.from(saved, 'base64'), JSZip);
  ok(book.students[0].grades.I === 12.5 && book.students[1].grades.I === 14, 'le fichier enregistré contient les notes (12.5, 14)');
  ok(!(await page.$('[data-act="download"]')), 'pas de bouton « télécharger » inutile dans l\'application');

  await page.click('[data-act="share"]');
  await page.waitForTimeout(200);
  const shared = await page.evaluate(() => window.__log.shared);
  ok(shared && shared.files && shared.files[0].endsWith('fixture-massar.xlsx'), 'WhatsApp : le fichier lui-même est partagé (' + (shared && shared.files) + ')');

  // bouton retour d'Android
  await page.evaluate(() => window.__log.back());
  ok(await page.isHidden('#modal'), 'retour : ferme la fenêtre');
  await page.evaluate(() => window.__log.back());
  ok((await page.$('#drop')) !== null, 'retour : revient à l\'accueil');
  await page.evaluate(() => window.__log.back());
  ok(await page.evaluate(() => !!window.__log.exited), 'retour depuis l\'accueil : quitte l\'application');

  ok(errors.length === 0, 'aucune erreur JavaScript ' + errors.join(' | '));
  await browser.close();
  server.close();
  console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests passent');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
