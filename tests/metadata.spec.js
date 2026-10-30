// @ts-check
// Tekst en draaien opslaan in de JPG-foto zelf (EXIF), via het hulpprogramma.
// Hier tegen een nagebootst hulpprogramma; het echte (PowerShell) zit in windows.spec.js.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const base = require('@playwright/test');
const { readMeta, imageData } = require('./jpeg-tools');
const { startMockHulp } = require('./mock-hulp');

const { expect } = base;
const MEDIA = () => process.env.DIASHOW_MEDIA || '';
const TOKEN = 'geheim-test-token';

const test = base.test.extend({
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err && err.stack || err)));
    await use(errors);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }, { auto: true }],
});

/** Fotomap + app-map zoals Diavoorstelling.bat die klaarzet, met (nagebootst) hulpprogramma. */
async function setup({ failWrites = false, helper = true } = {}) {
  const photos = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-fotos-'));
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-app-'));
  for (const f of ['canon.jpg', 'nikon.jpg', 'zonder-exif.jpg', 'foto1.png']) fs.copyFileSync(path.join(MEDIA(), f), path.join(photos, f));
  fs.copyFileSync(path.resolve(__dirname, '..', 'index.html'), path.join(app, 'index.html'));
  const hulp = helper ? await startMockHulp(photos, TOKEN, { failWrites }) : null;
  const files = ['canon.jpg', 'foto1.png', 'nikon.jpg', 'zonder-exif.jpg'];
  fs.writeFileSync(path.join(app, 'diashow-lijst.js'),
    `window.DIASHOW_BASE = ${JSON.stringify(pathToFileURL(photos).href + '/')};\n` +
    `window.DIASHOW_FILES = ${JSON.stringify(files)};\n` +
    (hulp ? `window.DIASHOW_SERVER = ${JSON.stringify(hulp.url)};\nwindow.DIASHOW_TOKEN = ${JSON.stringify(TOKEN)};\n` : ''));
  return {
    photos, hulp,
    url: pathToFileURL(path.join(app, 'index.html')).href,
    file: (f) => fs.readFileSync(path.join(photos, f)),
    cleanup: async () => {
      if (hulp) await hulp.close();
      fs.rmSync(photos, { recursive: true, force: true });
      fs.rmSync(app, { recursive: true, force: true });
    },
  };
}

async function openShow(page, env, name) {
  await page.goto(env.url);
  await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
  await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); });
  // Pauze, zodat de dia niet doorschuift tijdens de test
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).diashow.state.count)).toBe(4);
  await page.keyboard.press('Space');
  // Stap voor stap naar de foto, telkens wachten tot de volgende dia er is
  const order = ['canon.jpg', 'foto1.png', 'nikon.jpg', 'zonder-exif.jpg'];
  await page.keyboard.press('Home');
  await expect(page.locator('#name')).toHaveText(order[0]);
  for (const n of order.slice(1, order.indexOf(name) + 1)) {
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#name')).toHaveText(n);
  }
}

test.describe('tekst en draaien in de JPG-foto', () => {
  test('a caption is written into the photo; camera data and image data stay intact; a backup is made', async ({ page }) => {
    const env = await setup();
    try {
      const original = env.file('canon.jpg');
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('t');
      await expect(page.locator('#captionInput')).toBeFocused();
      await page.keyboard.type('Zo nog even de tuin grasmaaien – één keer');
      await page.keyboard.press('Enter');
      await expect(page.locator('#toast')).toHaveText('Tekst opgeslagen in de foto');
      await expect(page.locator('#caption')).toHaveText('Zo nog even de tuin grasmaaien – één keer');

      const meta = readMeta(env.file('canon.jpg'));
      expect(meta.xptitle).toBe('Zo nog even de tuin grasmaaien – één keer'); // Windows: Titel
      expect(meta.description).toBe('Zo nog even de tuin grasmaaien - een keer'); // klassiek veld, zonder accenten
      expect(meta.make).toBe('Canon');
      expect(meta.orientation).toBe(1);
      expect(meta.dateOriginal).toBe('2024:07:01 11:59:58');
      expect(meta.gpsRef).toBe('N');
      expect(imageData(env.file('canon.jpg')).equals(imageData(original))).toBe(true);
      // Reservekopie van het origineel
      const backup = fs.readFileSync(path.join(env.photos, 'Diavoorstelling-originelen', 'canon.jpg'));
      expect(backup.equals(original)).toBe(true);

      // Na opnieuw openen wordt de tekst uit de foto zelf gelezen
      await page.reload();
      await openShow(page, env, 'canon.jpg');
      await expect(page.locator('#caption')).toHaveText('Zo nog even de tuin grasmaaien – één keer');

      // Leegmaken haalt de tekst uit de foto
      await page.keyboard.press('t');
      await expect(page.locator('#captionInput')).toHaveValue('Zo nog even de tuin grasmaaien – één keer');
      await page.fill('#captionInput', '');
      await page.keyboard.press('Enter');
      await expect(page.locator('#toast')).toHaveText('Tekst weggehaald');
      await expect.poll(() => readMeta(env.file('canon.jpg')).xptitle).toBe(null);
      expect(readMeta(env.file('canon.jpg')).description).toBe(null);
      expect(readMeta(env.file('canon.jpg')).make).toBe('Canon');
      // Reservekopie blijft het echte origineel
      expect(fs.readFileSync(path.join(env.photos, 'Diavoorstelling-originelen', 'canon.jpg')).equals(original)).toBe(true);
    } finally { await env.cleanup(); }
  });

  test('R rotates the photo via EXIF; big-endian file with thumbnail and no orientation tag', async ({ page }) => {
    const env = await setup();
    try {
      const original = env.file('nikon.jpg');
      expect(readMeta(original).orientation).toBe(null);
      await openShow(page, env, 'nikon.jpg');
      const size = () => page.evaluate(() => {
        const img = /** @type {HTMLImageElement} */ (document.querySelector('.slide.visible img'));
        return img ? `${img.naturalWidth}x${img.naturalHeight}` : '';
      });
      await expect.poll(size).toBe('640x480');

      await page.keyboard.press('r');
      await expect(page.locator('#toast')).toHaveText('Foto gedraaid');
      await expect.poll(() => readMeta(env.file('nikon.jpg')).orientation).toBe(6);
      await expect.poll(size).toBe('480x640'); // de browser toont hem nu staand

      const meta = readMeta(env.file('nikon.jpg'));
      expect(meta.make).toBe('NIKON CORPORATION');
      expect(meta.thumbnail && meta.thumbnail.equals(readMeta(original).thumbnail || Buffer.alloc(0))).toBe(true);
      expect(imageData(env.file('nikon.jpg')).equals(imageData(original))).toBe(true);

      // Nog drie keer: weer rechtop (6 -> 3 -> 8 -> 1)
      for (const expected of [3, 8, 1]) {
        await page.keyboard.press('r');
        await expect.poll(() => readMeta(env.file('nikon.jpg')).orientation).toBe(expected);
      }
      await expect.poll(size).toBe('640x480');
    } finally { await env.cleanup(); }
  });

  test('a photo without EXIF gets a caption and rotation', async ({ page }) => {
    const env = await setup();
    try {
      const original = env.file('zonder-exif.jpg');
      await openShow(page, env, 'zonder-exif.jpg');
      await page.mouse.move(640, 300);
      await page.click('#captionBtn');
      await page.fill('#captionInput', 'Vakantie 2024');
      await page.click('#captionEdit button[type=submit]');
      await expect.poll(() => readMeta(env.file('zonder-exif.jpg')).xptitle).toBe('Vakantie 2024');
      await page.click('#rotateBtn');
      await expect.poll(() => readMeta(env.file('zonder-exif.jpg')).orientation).toBe(6);
      expect(readMeta(env.file('zonder-exif.jpg')).xptitle).toBe('Vakantie 2024');
      expect(imageData(env.file('zonder-exif.jpg')).equals(imageData(original))).toBe(true);
    } finally { await env.cleanup(); }
  });

  test('not a JPG: text and rotation explain that it only works for JPG photos', async ({ page }) => {
    const env = await setup();
    try {
      const png = env.file('foto1.png');
      await openShow(page, env, 'foto1.png');
      await page.keyboard.press('t');
      await expect(page.locator('#toast')).toContainText("alleen bij JPG-foto's");
      await expect(page.locator('#captionEdit')).toBeHidden();
      await page.keyboard.press('r');
      await expect(page.locator('#toast')).toContainText("alleen bij JPG-foto's");
      expect(env.file('foto1.png').equals(png)).toBe(true);
    } finally { await env.cleanup(); }
  });

  test('when saving fails, the photo is unchanged and a message is shown', async ({ page }) => {
    const env = await setup({ failWrites: true });
    try {
      const original = env.file('canon.jpg');
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('t');
      await page.keyboard.type('mislukt');
      await page.keyboard.press('Enter');
      await expect(page.locator('#toast')).toContainText('Kon de foto niet opslaan');
      await expect(page.locator('#toast')).toContainText('alleen-lezen');
      expect(env.file('canon.jpg').equals(original)).toBe(true);
    } finally { await env.cleanup(); }
  });

  test('without the helper (files picked by hand): captions in photos are shown, saving explains the .bat', async ({ page }) => {
    const env = await setup();
    try {
      // Eerst via het hulpprogramma een tekst in een kopie zetten
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('t');
      await page.keyboard.type('Met tekst');
      await page.keyboard.press('Enter');
      await expect.poll(() => readMeta(env.file('canon.jpg')).xptitle).toBe('Met tekst');

      // Daarna die foto los kiezen in de gewone app
      await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
      await page.setInputFiles('#fileInput', [path.join(env.photos, 'canon.jpg')]);
      await page.click('#startBtn');
      await expect(page.locator('#caption')).toHaveText('Met tekst');
      await page.keyboard.press('t');
      await expect(page.locator('#toast')).toContainText('Diavoorstelling.bat');
      await expect(page.locator('#captionEdit')).toBeHidden();
    } finally { await env.cleanup(); }
  });

  test('the helper is pinged and only JPGs inside the photo folder can be read', async ({ page }) => {
    const env = await setup();
    try {
      const h = env.hulp;
      const get = (q) => fetch(`${h.url}/bestand?${q}`).then((r) => r.status);
      expect(await get(`token=fout&pad=canon.jpg`)).toBe(403);
      expect(await get(`token=${TOKEN}&pad=${encodeURIComponent('../geheim.jpg')}`)).toBe(403);
      expect(await get(`token=${TOKEN}&pad=foto1.png`)).toBe(403);
      expect(await get(`token=${TOKEN}&pad=canon.jpg`)).toBe(200);
      await openShow(page, env, 'canon.jpg');
    } finally { await env.cleanup(); }
  });
});

test.describe('EXIF-onderdeel', () => {
  test('round-trips text with accents and emoji, rotation table, and rejects non-JPG data', async ({ page }) => {
    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
    const jpg = [...fs.readFileSync(path.join(MEDIA(), 'canon.jpg'))];
    const res = await page.evaluate((input) => {
      const E = /** @type {any} */ (window).diashow.exif;
      const b = new Uint8Array(input);
      const a = E.write(b, { caption: 'Oma 👵 – één' });
      const r1 = E.read(a);
      const c = E.write(a, { orientation: 6 });
      const r2 = E.read(c);
      let err = '';
      try { E.write(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { caption: 'x' }); } catch (e) { err = String(e.message); }
      const table = [1, 2, 3, 4, 5, 6, 7, 8].map((o) => E.rotateRight(o));
      return { r1, r2, err, table, sameLen: c.length === a.length };
    }, jpg);
    expect(res.r1.caption).toBe('Oma 👵 – één');
    expect(res.r2).toMatchObject({ caption: 'Oma 👵 – één', orientation: 6 });
    expect(res.sameLen).toBe(true); // bestaande Orientation: alleen 2 bytes aangepast
    expect(res.err).toContain('Geen JPG');
    expect(res.table).toEqual([6, 7, 8, 5, 2, 3, 4, 1]);
  });
});

test.describe('tekstvak (bediening)', () => {
  test('typing does not trigger shortcuts; the show pauses while typing and resumes after saving', async ({ page }) => {
    const env = await setup();
    try {
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('Space'); // weer afspelen
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).diashow.state.playing)).toBe(true);
      await page.keyboard.press('t');
      await expect(page.locator('#captionInput')).toBeFocused();
      expect(await page.evaluate(() => /** @type {any} */ (window).diashow.state.playing)).toBe(false);
      // g = overzicht, spatie = pauze, f = volledig scherm, r = draaien, a/v = effecten
      await page.keyboard.type('zo nog even de tuin grasmaaien, ga vrijdag fietsen');
      await expect(page.locator('#grid')).toBeHidden();
      await expect(page.locator('#name')).toHaveText('canon.jpg');
      expect(readMeta(env.file('canon.jpg')).orientation).toBe(1);
      await page.keyboard.press('Enter');
      await expect(page.locator('#caption')).toHaveText('zo nog even de tuin grasmaaien, ga vrijdag fietsen');
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).diashow.state.playing)).toBe(true);
    } finally { await env.cleanup(); }
  });

  test('Esc cancels without saving or stopping the show; the setting hides captions', async ({ page }) => {
    const env = await setup();
    try {
      const original = env.file('canon.jpg');
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('t');
      await page.keyboard.type('niet bewaren');
      await page.keyboard.press('Escape');
      await expect(page.locator('#captionEdit')).toBeHidden();
      await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
      expect(env.file('canon.jpg').equals(original)).toBe(true);

      await page.keyboard.press('t');
      await page.keyboard.type('wel bewaren');
      await page.keyboard.press('Enter');
      await expect(page.locator('#caption')).toHaveText('wel bewaren');
      await page.keyboard.press('Escape'); // naar instellingen
      await page.uncheck('#captions');
      await page.click('#startBtn');
      await page.keyboard.press('Home');
      await expect(page.locator('#name')).toHaveText('canon.jpg');
      await expect(page.locator('#caption')).toBeHidden();
    } finally { await env.cleanup(); }
  });

  test('caption stays above the control bar and within the screen at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const env = await setup();
    try {
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('t');
      await page.keyboard.type('Een hele lange tekst die op een smal scherm over meerdere regels moet lopen zonder eraf te vallen');
      await page.keyboard.press('Enter');
      await expect(page.locator('#caption')).not.toHaveText('');
      await page.mouse.move(200, 300);
      await expect(page.locator('#show')).toHaveClass(/\bui\b/);
      await expect.poll(async () => {
        const c = await page.locator('#caption').boundingBox();
        const b = await page.locator('#bar').boundingBox();
        const textBottom = await page.evaluate(() => {
          const r = document.createRange(); r.selectNodeContents(document.getElementById('caption'));
          return r.getBoundingClientRect().bottom;
        });
        return !!c && !!b && c.x >= 0 && c.x + c.width <= 390 && textBottom <= b.y;
      }).toBe(true);
    } finally { await env.cleanup(); }
  });
});
