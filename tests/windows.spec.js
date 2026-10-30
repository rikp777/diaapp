// @ts-check
// Echte test op Windows: het gebouwde Diavoorstelling.bat wordt uitgevoerd (cmd ->
// PowerShell-hulpprogramma), en Edge slaat een tekst en een draaiing op in een JPG.
// Draait alleen op Windows (zie playwright.config.js en .github/workflows/test.yml).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');
const { readMeta, imageData, withCameraExif } = require('./jpeg-tools');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(process.env.LOCALAPPDATA || '', 'Diavoorstelling');
const OUDE_DATUM = new Date('2020-05-01T10:00:00Z');

let photos, child, lijst;

/** JPG maken met de browser zelf (op de Windows-runner is geen ffmpeg nodig). */
async function makeJpeg(page, w, h, color) {
  const b64 = await page.evaluate(([w, h, color]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w / 4, h / 4); // hoek, om draaien te zien
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, [w, h, color]);
  return Buffer.from(b64, 'base64');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  // Fotomap met lastige naam (spatie, apostrof, #), JPG's met en zonder EXIF, en een PNG
  photos = fs.mkdtempSync(path.join(os.tmpdir(), "Foto's van mam #1 "));
  const page = await browser.newPage();
  const plain = await makeJpeg(page, 640, 480, '#2a7');
  await page.close();
  fs.writeFileSync(path.join(photos, 'tuin.jpg'), withCameraExif(plain, { le: true }));
  fs.mkdirSync(path.join(photos, 'sub map'));
  fs.writeFileSync(path.join(photos, 'sub map', 'strand.jpg'), plain);
  for (const f of ['tuin.jpg', path.join('sub map', 'strand.jpg')]) fs.utimesSync(path.join(photos, f), OUDE_DATUM, OUDE_DATUM);

  // Het echte downloadbestand bouwen en in de fotomap zetten
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'maak-download.js')]);
  fs.copyFileSync(path.join(ROOT, 'dist', 'Diavoorstelling.bat'), path.join(photos, 'Diavoorstelling.bat'));

  const lijstPad = path.join(APP_DIR, 'diashow-lijst.js');
  if (fs.existsSync(lijstPad)) fs.rmSync(lijstPad);
  // Dubbelklikken nabootsen: cmd voert het .bat-bestand uit; de test opent zelf Edge
  child = spawn('cmd.exe', ['/c', 'Diavoorstelling.bat'], {
    cwd: photos, env: { ...process.env, DIA_GEEN_BROWSER: '1' }, stdio: 'ignore', windowsHide: true,
  });
  await expect.poll(() => (fs.existsSync(lijstPad) ? fs.readFileSync(lijstPad, 'utf8') : ''), { timeout: 60_000 })
    .toContain('DIASHOW_SERVER');
  lijst = fs.readFileSync(lijstPad, 'utf8');
});

test.afterAll(() => {
  if (child && child.pid) { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  if (photos) fs.rmSync(photos, { recursive: true, force: true });
});

const server = () => /DIASHOW_SERVER = '([^']+)'/.exec(lijst)[1];
const token = () => /DIASHOW_TOKEN = '([^']+)'/.exec(lijst)[1];
const file = (f) => fs.readFileSync(path.join(photos, f));

async function openAt(page, name) {
  await page.goto(pathToFileURL(path.join(APP_DIR, 'index.html')).href);
  await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
  await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); });
  await page.keyboard.press('Space'); // pauze
  // Stap voor stap naar de foto, telkens wachten tot de volgende dia er is
  const order = ['sub map/strand.jpg', 'tuin.jpg'];
  await page.keyboard.press('Home');
  await expect(page.locator('#name')).toHaveText(order[0]);
  for (const n of order.slice(1, order.indexOf(name) + 1)) {
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#name')).toHaveText(n);
  }
}

test('the launcher scans the folder and writes the list with the helper', async () => {
  expect(lijst).toContain('"sub map/strand.jpg"');
  expect(lijst).toContain('"tuin.jpg"');
  expect(lijst).not.toContain('Diavoorstelling.bat');
  expect(server()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(token().length).toBeGreaterThanOrEqual(32);
});

test('the helper refuses wrong tokens, paths outside the folder and non-JPG files', async () => {
  const status = (q) => fetch(`${server()}/bestand?${q}`).then((r) => r.status);
  expect(await status(`token=fout&pad=tuin.jpg`)).toBe(403);
  expect(await status(`token=${token()}&pad=${encodeURIComponent('..\\buiten.jpg')}`)).toBe(403);
  expect(await status(`token=${token()}&pad=${encodeURIComponent('../../Windows/win.ini')}`)).toBe(403);
  expect(await status(`token=${token()}&pad=Diavoorstelling.bat`)).toBe(403);
  expect(await status(`token=${token()}&pad=tuin.jpg`)).toBe(200);
  expect(await status(`token=${token()}&pad=bestaat-niet.jpg`)).toBe(404);
});

test('Edge saves a caption into the photo via the real helper; backup and date are kept', async ({ page }) => {
  const original = file('tuin.jpg');
  await openAt(page, 'tuin.jpg');
  await page.keyboard.press('t');
  await page.keyboard.type('Zo nog even de tuin grasmaaien – één keer');
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toHaveText('Tekst opgeslagen in de foto', { timeout: 15_000 });

  const meta = readMeta(file('tuin.jpg'));
  expect(meta.xptitle).toBe('Zo nog even de tuin grasmaaien – één keer');
  expect(meta.make).toBe('Canon');
  expect(meta.dateOriginal).toBe('2024:07:01 11:59:58');
  expect(imageData(file('tuin.jpg')).equals(imageData(original))).toBe(true);
  // Reservekopie in de verborgen map, en de bestandsdatum is niet veranderd
  expect(fs.readFileSync(path.join(photos, 'Diavoorstelling-originelen', 'tuin.jpg')).equals(original)).toBe(true);
  expect(Math.abs(fs.statSync(path.join(photos, 'tuin.jpg')).mtimeMs - OUDE_DATUM.getTime())).toBeLessThan(2000);
  const attrib = execFileSync('cmd.exe', ['/c', 'attrib', path.join(photos, 'Diavoorstelling-originelen')]).toString();
  expect(attrib).toMatch(/\bH\b/);

  // Opnieuw openen: de tekst komt uit de foto zelf
  await openAt(page, 'tuin.jpg');
  await expect(page.locator('#caption')).toHaveText('Zo nog even de tuin grasmaaien – één keer');
});

test('Edge rotates a photo in a subfolder via the real helper', async ({ page }) => {
  const original = file(path.join('sub map', 'strand.jpg'));
  await openAt(page, 'sub map/strand.jpg');
  await page.keyboard.press('r');
  await expect(page.locator('#toast')).toHaveText('Foto gedraaid', { timeout: 15_000 });
  expect(readMeta(file(path.join('sub map', 'strand.jpg'))).orientation).toBe(6);
  expect(imageData(file(path.join('sub map', 'strand.jpg'))).equals(imageData(original))).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const img = /** @type {HTMLImageElement} */ (document.querySelector('.slide.visible img'));
    return img ? `${img.naturalWidth}x${img.naturalHeight}` : '';
  })).toBe('480x640');
  expect(fs.existsSync(path.join(photos, 'Diavoorstelling-originelen', 'sub map', 'strand.jpg'))).toBe(true);
});
