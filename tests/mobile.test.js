// node tests/mobile.test.js — affichage sur téléphone (petit et moyen écran)
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

let fail = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) fail++; };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await browser0();
  for (const name of ['iPhone SE', 'Pixel 5']) {
    const ctx = await browser.newContext({ ...devices[name], acceptDownloads: true });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(`http://localhost:${server.address().port}/`);
    const width = page.viewportSize().width;
    const fits = async (screen) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, `${name} · ${screen} : pas de défilement horizontal`);

    await fits('accueil');
    await page.setInputFiles('#fileInput', path.join(__dirname, 'fixture-massar.xlsx'));
    await page.click('[data-col="I"]');
    await page.click('[data-mode="ordered"]');
    await fits('préparation');
    ok(await page.isVisible('.top-info span'), `${name} · infos du groupe visibles dans l'en-tête`);
    await page.click('.stepbar [data-act="start"]');
    await page.waitForSelector('.current');
    for (const g of ['12', '13', '14']) { await page.fill('#typeIn', g); await page.press('#typeIn', 'Enter'); }
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.evaluate(() => window.scrollTo(0, 0));
    await fits('dictée');
    const mic = await page.$eval('#mic', (e) => e.getBoundingClientRect().bottom);
    ok(mic < page.viewportSize().height, `${name} · micro visible sans défiler`);
    const scrolled = await page.evaluate(() => window.scrollY);
    ok(scrolled === 0, `${name} · la page ne saute pas vers la liste après une note`);
    await page.click('.stepbar [data-act="toReview"]');
    await page.waitForSelector('h1');
    await fits('vérification');
    const input = await page.$eval('input[data-row="18"]', (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    ok(input, `${name} · cases de note entièrement visibles`);
    ok(await page.isVisible('#credit'), `${name} · pied de page visible`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests passent');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function browser0() { return chromium.launch(); }
