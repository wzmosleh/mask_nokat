// node tests/share.test.js — partage WhatsApp : fichier envoyé quand le navigateur le permet
const { chromium, devices } = require('playwright');
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

// navigateur qui accepte le partage de fichiers (comme Safari sur iPhone)
const SHARE_OK = `
  window.__shared = null;
  navigator.canShare = (d) => !!(d && d.files);
  navigator.share = (d) => { window.__shared = { names: d.files.map((f) => f.name), sizes: d.files.map((f) => f.size), text: d.text }; return Promise.resolve(); };
`;

let fail = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) fail++; };

async function toDownload(page, url) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixture-massar.xlsx'));
  await page.click('[data-col="I"]');
  await page.click('[data-mode="ordered"]');
  await page.click('.stepbar [data-act="start"]');
  await page.waitForSelector('.current');
  await page.fill('#typeIn', '12');
  await page.press('#typeIn', 'Enter');
  await page.click('.stepbar [data-act="toReview"]');
  await page.click('.stepbar [data-act="save"]');
  await page.waitForSelector('[data-act="whatsapp"]');
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();

  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const page = await ctx.newPage();
  await page.addInitScript(SHARE_OK);
  await toDownload(page, url);
  ok(!(await page.isVisible('#waHint')), 'partage possible : pas de consigne inutile');
  await page.click('[data-act="whatsapp"]');
  await page.waitForTimeout(200);
  const shared = await page.evaluate(() => window.__shared);
  ok(shared && shared.names[0] === 'fixture-massar.xlsx' && shared.sizes[0] > 10000, 'le fichier Excel lui-même est partagé : ' + JSON.stringify(shared));
  ok(page.url().startsWith(url), 'on reste dans l\'application');
  await ctx.close();

  // Chrome Android : partage de .xlsx refusé → consigne visible avant d'appuyer, puis ouverture directe de WhatsApp
  const ctx2 = await browser.newContext({ ...devices['Pixel 5'], acceptDownloads: true });
  const page2 = await ctx2.newPage();
  await page2.addInitScript(`navigator.canShare = () => false;`);
  await toDownload(page2, url);
  ok(await page2.isVisible('#waHint'), 'Chrome Android : consigne « 📎 ← مستند ← التنزيلات » affichée');
  const popups = [];
  ctx2.on('page', (p) => popups.push(p));
  const navs = [];
  page2.on('request', (r) => navs.push(r.url()));
  page2.on('framenavigated', (f) => navs.push(f.url()));
  await page2.click('[data-act="whatsapp"]');
  await page2.waitForTimeout(800);
  ok(popups.length === 0, 'aucune fenêtre pop-up');
  ok(navs.some((u) => u.startsWith('whatsapp://send')), 'l\'application WhatsApp s\'ouvre directement (whatsapp://send)');
  await ctx2.close();

  await browser.close();
  server.close();
  console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests passent');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
