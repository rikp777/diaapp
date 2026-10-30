// Nagebootst hulpprogramma (zelfde protocol als het PowerShell-deel van
// Diavoorstelling.bat), zodat de diavoorstelling op Linux getest kan worden.
// Het echte PowerShell-hulpprogramma wordt getest in tests/windows.spec.js.
const http = require('http');
const fs = require('fs');
const path = require('path');

function startMockHulp(map, token, { failWrites = false } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ method: req.method, path: url.pathname });
    const send = (code, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (req.method === 'OPTIONS') return send(204, '');
    if (url.searchParams.get('token') !== token) return send(403, 'Geen toegang');
    if (url.pathname === '/ping') return send(200, 'ok');
    if (url.pathname !== '/bestand') return send(404, 'Onbekend');
    const rel = url.searchParams.get('pad') || '';
    const full = path.resolve(map, rel);
    if (!full.startsWith(path.resolve(map) + path.sep) || !/\.(jpe?g|jfif)$/i.test(full)) return send(403, "Alleen JPG-foto's in de fotomap");
    if (!fs.existsSync(full)) return send(404, 'Foto niet gevonden');
    if (req.method === 'GET') {
      const data = fs.readFileSync(full);
      return send(200, url.searchParams.has('kop') ? data.subarray(0, 262144) : data, 'image/jpeg');
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (failWrites) return send(500, 'Schijf is alleen-lezen');
        const body = Buffer.concat(chunks);
        if (body[0] !== 0xff || body[1] !== 0xd8) return send(400, 'Geen JPG');
        const backup = path.join(map, 'Diavoorstelling-originelen', rel);
        if (!fs.existsSync(backup)) { fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(full, backup); }
        fs.writeFileSync(full, body);
        send(200, 'ok');
      });
      return;
    }
    send(400, 'Onbekend verzoek');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startMockHulp };
