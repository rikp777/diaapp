// Maakt dist/Diavoorstelling.bat: het startbestand met de hele app (index.html) erin,
// zodat gebruikers maar één bestand hoeven te downloaden.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const starter = fs.readFileSync(path.join(root, 'Diavoorstelling.bat'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

if (/[^\x00-\x7f]/.test(starter)) throw new Error('Diavoorstelling.bat moet ASCII zijn (cmd leest het niet als UTF-8)');
if (html.includes('#DIAHTML#') || html.includes('#POWERSHELL#')) throw new Error('index.html bevat een scheidingsteken');

const out = crlf(starter).replace(/(\r\n)*$/, '\r\n') + '#DIAHTML#\r\n' + crlf(html);
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'Diavoorstelling.bat'), out);
console.log(`dist/Diavoorstelling.bat (${Math.round(out.length / 1024)} kB)`);
