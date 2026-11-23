// Copie l'application web (racine du dépôt) dans www/ pour l'application Android.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const www = path.join(__dirname, '..', 'www');
const files = ['index.html', 'styles.css', 'app.js', 'parser.js', 'massar.js', 'i18n.js', 'native.js', 'assets', 'vendor'];
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
for (const f of files) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.error('manquant :', f); process.exit(1); }
  fs.cpSync(src, path.join(www, f), { recursive: true });
}
console.log('www prêt :', files.join(', '));
