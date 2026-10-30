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
  // OpenStreetMap nabootsen: geen echte verzoeken naar internet vanuit de tests
  osm: [async ({ page }, use) => {
    const calls = [];
    await page.route('https://nominatim.openstreetmap.org/**', (route) => {
      const u = new URL(route.request().url());
      calls.push({ lat: Number(u.searchParams.get('lat')), lon: Number(u.searchParams.get('lon')) });
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ name: 'Utrecht', address: { city: 'Utrecht', country: 'Nederland', country_code: 'nl' } }) });
    });
    await use(calls);
  }, { auto: true }],
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err && err.stack || err)));
    await use(errors);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }, { auto: true }],
});

/** Fotomap + app-map zoals Diavoorstelling.bat die klaarzet, met (nagebootst) hulpprogramma. */
async function setup({ failWrites = false, helper = true, writeDelay = 0 } = {}) {
  const photos = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-fotos-'));
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-app-'));
  for (const f of ['canon.jpg', 'nikon.jpg', 'zonder-exif.jpg', 'foto1.png']) fs.copyFileSync(path.join(MEDIA(), f), path.join(photos, f));
  fs.copyFileSync(path.resolve(__dirname, '..', 'index.html'), path.join(app, 'index.html'));
  const hulp = helper ? await startMockHulp(photos, TOKEN, { failWrites, writeDelay }) : null;
  const files = ['canon.jpg', 'foto1.png', 'nikon.jpg', 'zonder-exif.jpg'];
  fs.writeFileSync(path.join(app, 'diashow-lijst.js'),
    `window.DIASHOW_BASE = ${JSON.stringify(pathToFileURL(photos).href + '/')};\n` +
    `window.DIASHOW_FILES = ${JSON.stringify(files)};\n` +
    // Bestandsdatums zoals Diavoorstelling.bat ze doorgeeft (1 mei 2020)
    `window.DIASHOW_TIMES = ${JSON.stringify(files.map(() => Date.UTC(2020, 4, 1, 12)))};\n` +
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


test.describe('plek en bestandsnaam', () => {
  test('the place is looked up from GPS once, shown with the caption, and can be edited (stored in the photo)', async ({ page, osm }) => {
    const env = await setup();
    try {
      await openShow(page, env, 'canon.jpg');
      await expect(page.locator('#place')).toHaveText('Utrecht');
      expect(osm.length).toBe(1);
      expect(osm[0].lat).toBeCloseTo(52.0908, 3);
      expect(osm[0].lon).toBeCloseTo(5.1217, 3);

      // Terug naar dezelfde foto: geen nieuw verzoek (onthouden)
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#name')).toHaveText('foto1.png');
      await expect(page.locator('#place')).toHaveText('');
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('#place')).toHaveText('Utrecht');
      expect(osm.length).toBe(1);

      // Zelf aanpassen met P: begint met de opgezochte naam
      await page.keyboard.press('p');
      await expect(page.locator('#editTitle')).toHaveText('Plek waar deze foto gemaakt is');
      await expect(page.locator('#captionInput')).toHaveValue('Utrecht');
      await page.fill('#captionInput', 'Camping De Berk, Ommen');
      await page.keyboard.press('Enter');
      await expect(page.locator('#toast')).toHaveText('Plek opgeslagen in de foto');
      await expect(page.locator('#place')).toHaveText('Camping De Berk, Ommen');
      const meta = readMeta(env.file('canon.jpg'));
      expect(meta.xpsubject).toBe('Camping De Berk, Ommen'); // Windows: Onderwerp
      expect(meta.gpsRef).toBe('N'); // GPS blijft staan

      // Bijschrift erbij: beide te zien
      await page.keyboard.press('t');
      await page.keyboard.type('zo nog even de tuin grasmaaien');
      await page.keyboard.press('Enter');
      await expect(page.locator('#caption')).toHaveText('zo nog even de tuin grasmaaien');
      await expect(page.locator('#place')).toHaveText('Camping De Berk, Ommen');
      expect(readMeta(env.file('canon.jpg')).xpsubject).toBe('Camping De Berk, Ommen');

      // Plek leegmaken: terug naar de plaatsnaam uit de GPS-gegevens
      await page.keyboard.press('p');
      await page.fill('#captionInput', '');
      await page.keyboard.press('Enter');
      await expect(page.locator('#toast')).toHaveText('Plek weggehaald');
      await expect(page.locator('#place')).toHaveText('Utrecht');
      expect(readMeta(env.file('canon.jpg')).xpsubject).toBe(null);
    } finally { await env.cleanup(); }
  });

  test('separate switches: place off means no lookups; file name and caption can be toggled independently', async ({ page, osm }) => {
    const env = await setup();
    try {
      // Bijschrift in de foto zetten, met alles aan
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('t');
      await page.keyboard.type('Met bijschrift');
      await page.keyboard.press('Enter');
      await expect(page.locator('#caption')).toHaveText('Met bijschrift');
      await expect(page.locator('#place')).toHaveText('Utrecht');
      const nameOpacity = () => page.evaluate(() => getComputedStyle(document.getElementById('info')).opacity);
      expect(await nameOpacity()).toBe('0'); // bestandsnaam staat standaard uit

      // Instellingen: plek uit, bestandsnaam aan, bijschrift aan
      await page.keyboard.press('Escape');
      await page.uncheck('#showPlace');
      await page.check('#showName');
      await page.evaluate(() => localStorage.removeItem('diashow-plaatsnamen'));
      const before = osm.length;
      await page.reload();
      await openShow(page, env, 'canon.jpg');
      await expect(page.locator('#caption')).toHaveText('Met bijschrift');
      await expect(page.locator('#place')).toBeHidden();
      expect(osm.length).toBe(before); // niets opgezocht
      await expect.poll(nameOpacity).toBe('1');
      await expect(page.locator('#name')).toHaveText('canon.jpg');

      // Bijschrift uit, plek weer aan
      await page.keyboard.press('Escape');
      await page.uncheck('#captions');
      await page.check('#showPlace');
      await page.click('#startBtn');
      await page.keyboard.press('Space');
      await page.keyboard.press('Home');
      await expect(page.locator('#name')).toHaveText('canon.jpg');
      await expect(page.locator('#place')).toHaveText('Utrecht');
      await expect(page.locator('#caption')).toBeHidden();
    } finally { await env.cleanup(); }
  });

  test('EXIF: GPS position is read from the GPS list', async ({ page }) => {
    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
    const jpg = [...fs.readFileSync(path.join(MEDIA(), 'canon.jpg'))];
    const gps = await page.evaluate((input) => /** @type {any} */ (window).diashow.exif.read(new Uint8Array(input)).gps, jpg);
    expect(gps.lat).toBeCloseTo(52 + 5 / 60 + 27 / 3600, 6);
    expect(gps.lon).toBeCloseTo(5 + 7 / 60 + 18 / 3600, 6);
    const none = await page.evaluate((input) => /** @type {any} */ (window).diashow.exif.read(new Uint8Array(input)).gps,
      [...fs.readFileSync(path.join(MEDIA(), 'nikon.jpg'))]);
    expect(none).toBe(null);
  });
});


test.describe('na code review', () => {
  test('the caption goes to the photo the editor was opened for, even if the show moved on', async ({ page }) => {
    const env = await setup();
    try {
      await page.addInitScript(() => localStorage.setItem('diashow-settings', JSON.stringify({ seconds: 1 })));
      await openShow(page, env, 'nikon.jpg');
      await page.keyboard.press('t');
      await expect(page.locator('#captionInput')).toBeFocused();
      // Afspelen via de balk terwijl het tekstvak open is: de voorstelling schuift door
      await page.mouse.move(640, 300);
      await page.click('#playBtn');
      await expect(page.locator('#name')).toHaveText('zonder-exif.jpg', { timeout: 5000 });
      await page.fill('#captionInput', 'Hoort bij Nikon');
      await page.click('#captionEdit button[type=submit]');
      await expect.poll(() => readMeta(env.file('nikon.jpg')).xptitle).toBe('Hoort bij Nikon');
      expect(readMeta(env.file('zonder-exif.jpg')).xptitle).toBe(null);
      expect(fs.existsSync(path.join(env.photos, 'Diavoorstelling-originelen', 'zonder-exif.jpg'))).toBe(false);
    } finally { await env.cleanup(); }
  });

  test('a slow place lookup does not overwrite what you already typed', async ({ page }) => {
    const env = await setup();
    try {
      await page.route('https://nominatim.openstreetmap.org/**', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ address: { city: 'Utrecht', country_code: 'nl' } }) });
      });
      await page.addInitScript(() => localStorage.setItem('diashow-settings', JSON.stringify({ showPlace: false })));
      await openShow(page, env, 'canon.jpg'); // plek uit: nog niets opgezocht
      await page.evaluate(() => {}); // (niets)
      await page.keyboard.press('Escape');
      await page.check('#showPlace');
      await page.click('#startBtn');
      await page.keyboard.press('Space');
      await page.keyboard.press('Home');
      await expect(page.locator('#name')).toHaveText('canon.jpg');
      await page.keyboard.press('p');
      await page.keyboard.type('Mijn eigen plek');
      await page.waitForTimeout(2500); // opzoeken is intussen klaar
      await expect(page.locator('#captionInput')).toHaveValue('Mijn eigen plek');
      // P daarna Esc en T: een late plaatsnaam komt niet in het bijschrift
      await page.keyboard.press('Escape');
      await page.keyboard.press('t');
      await expect(page.locator('#editTitle')).toHaveText('Bijschrift bij deze foto');
      await page.waitForTimeout(300);
      await expect(page.locator('#captionInput')).toHaveValue('');
    } finally { await env.cleanup(); }
  });

  test('stopping while a rotation is being saved does not restart the show behind the settings screen', async ({ page }) => {
    const env = await setup({ writeDelay: 1500 });
    try {
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('Space'); // weer afspelen
      await page.keyboard.press('r');
      await page.keyboard.press('Escape');
      await expect(page.locator('#start')).toBeVisible();
      await expect.poll(() => readMeta(env.file('canon.jpg')).orientation, { timeout: 5000 }).toBe(6);
      await page.waitForTimeout(1500);
      await expect(page.locator('#show')).not.toHaveClass(/\bactive\b/);
      expect(await page.evaluate(() => document.querySelectorAll('.slide img, .slide video').length)).toBe(0);
    } finally { await env.cleanup(); }
  });

  test('a different file with the same name shows its own metadata (no stale cache)', async ({ page }) => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-b-'));
    try {
      await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
      const withCaption = await page.evaluate((input) => [.../** @type {any} */ (window).diashow.exif.write(new Uint8Array(input), { caption: 'Camera A' })],
        [...fs.readFileSync(path.join(MEDIA(), 'zonder-exif.jpg'))]);
      fs.writeFileSync(path.join(a, 'IMG_0001.JPG'), Buffer.from(withCaption));
      fs.copyFileSync(path.join(MEDIA(), 'canon.jpg'), path.join(b, 'IMG_0001.JPG'));
      await page.setInputFiles('#fileInput', [path.join(a, 'IMG_0001.JPG')]);
      await page.click('#startBtn');
      await expect(page.locator('#caption')).toHaveText('Camera A');
      await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); });
      await page.keyboard.press('Escape');
      await expect(page.locator('#start')).toBeVisible();
      await page.setInputFiles('#fileInput', [path.join(b, 'IMG_0001.JPG')]);
      await page.click('#startBtn');
      await expect(page.locator('#place')).toHaveText('Utrecht'); // metadata van het tweede bestand
      await expect(page.locator('#caption')).toHaveText('');
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test('repeated edits do not make the metadata grow; camera data stays intact', async ({ page }) => {
    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
    const start = fs.readFileSync(path.join(MEDIA(), 'canon.jpg'));
    const sizes = await page.evaluate((input) => {
      const E = /** @type {any} */ (window).diashow.exif;
      let b = new Uint8Array(input);
      const sizes = [];
      for (let i = 0; i < 60; i++) {
        b = i % 3 === 0 ? E.write(b, { caption: `Bijschrift nummer ${i}` })
          : i % 3 === 1 ? E.write(b, { place: `Plek ${i}` })
          : E.write(b, { orientation: [1, 6, 3, 8][i % 4] });
        sizes.push(b.length);
      }
      window.__laatste = [...b];
      return sizes;
    }, [...start]);
    // Na de eerste paar wijzigingen blijft de grootte vrijwel gelijk
    expect(Math.max(...sizes.slice(10)) - Math.min(...sizes.slice(10))).toBeLessThan(64);
    const last = Buffer.from(await page.evaluate(() => /** @type {any} */ (window).__laatste));
    const meta = readMeta(last);
    expect(meta.xptitle).toBe('Bijschrift nummer 57');
    expect(meta.xpsubject).toBe('Plek 58');
    expect(meta.make).toBe('Canon');
    expect(meta.dateOriginal).toBe('2024:07:01 11:59:58');
    expect(meta.gpsRef).toBe('N');
    expect(imageData(last).equals(imageData(start))).toBe(true);
  });

  test('saving the same text again does not touch the file', async ({ page }) => {
    const env = await setup();
    try {
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('t');
      await page.keyboard.type('Eén keer');
      await page.keyboard.press('Enter');
      await expect.poll(() => readMeta(env.file('canon.jpg')).xptitle).toBe('Eén keer');
      const posts = () => env.hulp.requests.filter((r) => r.method === 'POST').length;
      await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/); // eerste melding is weg
      const before = posts();
      await page.keyboard.press('t');
      await expect(page.locator('#captionInput')).toHaveValue('Eén keer');
      await page.keyboard.press('Enter');
      // De melding verschijnt pas als het opslaan klaar is
      await expect(page.locator('#toast')).toHaveClass(/\bshow\b/);
      await expect(page.locator('#toast')).toHaveText('Tekst opgeslagen in de foto');
      expect(posts()).toBe(before);
    } finally { await env.cleanup(); }
  });
});

test.describe('foto zoeken en bewerken', () => {
  async function setupFolders() {
    const env = await setup();
    fs.mkdirSync(path.join(env.photos, 'Vakantie 2024'));
    fs.copyFileSync(path.join(MEDIA(), 'zonder-exif.jpg'), path.join(env.photos, 'Vakantie 2024', 'strand.jpg'));
    const lijstPad = path.join(path.dirname(new URL(env.url).pathname), 'diashow-lijst.js');
    const lijst = fs.readFileSync(lijstPad, 'utf8').replace(/DIASHOW_FILES = .*;/,
      `DIASHOW_FILES = ${JSON.stringify(['canon.jpg', 'foto1.png', 'nikon.jpg', 'Vakantie 2024/strand.jpg', 'zonder-exif.jpg'])};`);
    fs.writeFileSync(lijstPad, lijst);
    return env;
  }

  test('overview groups by folder, search filters by name or folder, and a click opens the photo paused', async ({ page }) => {
    const env = await setupFolders();
    try {
      await page.goto(env.url);
      await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).diashow.state.count)).toBe(5);
      await page.keyboard.press('g');
      await expect(page.locator('#grid')).toBeVisible();
      // Eén kop per map
      await expect(page.locator('.grid-folder')).toHaveText(['📁 Deze map', '📁 Vakantie 2024']);
      await expect(page.locator('.thumb')).toHaveCount(5);

      // Zoeken op mapnaam en op bestandsnaam; typen sluit het overzicht niet (g/G)
      await page.click('#gridSearch');
      await page.keyboard.type('vakantie');
      await expect(page.locator('.thumb:visible')).toHaveCount(1);
      await expect(page.locator('.grid-folder:visible')).toHaveText(['📁 Vakantie 2024']);
      await page.fill('#gridSearch', 'nikon');
      await expect(page.locator('.thumb:visible')).toHaveCount(1);
      await page.fill('#gridSearch', 'bestaat niet');
      await expect(page.locator('#gridEmpty')).toBeVisible();
      await page.fill('#gridSearch', 'STRAND');
      await expect(page.locator('.thumb:visible')).toHaveCount(1);
      await expect(page.locator('#grid')).toBeVisible();

      // Enter opent de eerste treffer, in pauze
      await page.keyboard.press('Enter');
      await expect(page.locator('#grid')).toBeHidden();
      await expect(page.locator('#name')).toHaveText('Vakantie 2024/strand.jpg');
      expect(await page.evaluate(() => /** @type {any} */ (window).diashow.state.playing)).toBe(false);
      await page.waitForTimeout(1500);
      await expect(page.locator('#name')).toHaveText('Vakantie 2024/strand.jpg'); // schuift niet door

      // Meteen bewerken
      await page.keyboard.press('t');
      await page.keyboard.type('Strand in Zeeland');
      await page.keyboard.press('Enter');
      await expect.poll(() => readMeta(env.file(path.join('Vakantie 2024', 'strand.jpg'))).xptitle).toBe('Strand in Zeeland');
    } finally { await env.cleanup(); }
  });

  test('Esc in the search box first clears it, then closes the overview', async ({ page }) => {
    const env = await setupFolders();
    try {
      await page.goto(env.url);
      await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
      await page.keyboard.press('g');
      await page.click('#gridSearch');
      await page.keyboard.type('canon');
      await page.keyboard.press('Escape');
      await expect(page.locator('#gridSearch')).toHaveValue('');
      await expect(page.locator('#grid')).toBeVisible();
      await expect(page.locator('.thumb:visible')).toHaveCount(5);
      await page.keyboard.press('Escape');
      await expect(page.locator('#grid')).toBeHidden();
      await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
    } finally { await env.cleanup(); }
  });

  test('"Foto zoeken en bewerken" on the settings screen opens the overview, paused', async ({ page }) => {
    const env = await setupFolders();
    try {
      await page.goto(env.url);
      await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
      await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); });
      await page.keyboard.press('Escape');
      await expect(page.locator('#start')).toBeVisible();
      await expect(page.locator('#browseBtn')).toBeEnabled();
      await page.click('#browseBtn');
      await expect(page.locator('#grid')).toBeVisible();
      expect(await page.evaluate(() => /** @type {any} */ (window).diashow.state.playing)).toBe(false);
      await page.locator('.thumb[data-pos="2"]').click();
      await expect(page.locator('#name')).toHaveText('nikon.jpg');
      expect(await page.evaluate(() => /** @type {any} */ (window).diashow.state.playing)).toBe(false);
    } finally { await env.cleanup(); }
  });
});


test.describe('datum', () => {
  test('shows the date the photo was taken (EXIF), else the file date; can be switched off', async ({ page }) => {
    const env = await setup();
    try {
      await openShow(page, env, 'canon.jpg');
      await expect(page.locator('#date')).toHaveText('1 juli 2024'); // DateTimeOriginal uit de foto
      await expect(page.locator('#place')).toHaveText('Utrecht');
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#name')).toHaveText('foto1.png');
      await expect(page.locator('#date')).toHaveText('1 mei 2020'); // PNG: datum van het bestand
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#name')).toHaveText('nikon.jpg');
      await expect(page.locator('#date')).toHaveText('1 mei 2020'); // JPG zonder datum in EXIF

      // Uitzetten op het instellingenscherm
      await page.keyboard.press('Escape');
      await expect(page.locator('#showDate')).toBeChecked();
      await page.uncheck('#showDate');
      await page.click('#startBtn');
      await page.keyboard.press('Space');
      await page.keyboard.press('Home');
      await expect(page.locator('#name')).toHaveText('canon.jpg');
      await expect(page.locator('#place')).toHaveText('Utrecht');
      await expect(page.locator('#date')).toBeHidden();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('diashow-settings') || '{}').showDate)).toBe(false);
    } finally { await env.cleanup(); }
  });

  test('files picked by hand: EXIF date, otherwise the file\'s modification date', async ({ page }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-datum-'));
    try {
      fs.copyFileSync(path.join(MEDIA(), 'canon.jpg'), path.join(dir, 'a.jpg'));
      fs.copyFileSync(path.join(MEDIA(), 'foto1.png'), path.join(dir, 'b.png'));
      const d = new Date(2019, 11, 24, 12); // 24 december 2019
      fs.utimesSync(path.join(dir, 'b.png'), d, d);
      await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
      await page.setInputFiles('#fileInput', [path.join(dir, 'a.jpg'), path.join(dir, 'b.png')]);
      await page.click('#startBtn');
      await expect(page.locator('#name')).toHaveText('a.jpg');
      await expect(page.locator('#date')).toHaveText('1 juli 2024');
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#name')).toHaveText('b.png');
      await expect(page.locator('#date')).toHaveText('24 december 2019');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('EXIF date reading: DateTimeOriginal wins, invalid dates are ignored', async ({ page }) => {
    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
    const r = await page.evaluate((input) => /** @type {any} */ (window).diashow.exif.read(new Uint8Array(input)).date,
      [...fs.readFileSync(path.join(MEDIA(), 'canon.jpg'))]);
    expect(r).toBe('2024-07-01'); // DateTimeOriginal (11:59:58), niet DateTime
    const none = await page.evaluate((input) => /** @type {any} */ (window).diashow.exif.read(new Uint8Array(input)).date,
      [...fs.readFileSync(path.join(MEDIA(), 'nikon.jpg'))]);
    expect(none).toBe('');
  });
});

test.describe('dubbele foto\'s en Live Photos', () => {
  test('files picked by hand: an exact copy is shown once, a Live Photo video is skipped (switchable)', async ({ page }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-dubbel-'));
    try {
      fs.copyFileSync(path.join(MEDIA(), 'canon.jpg'), path.join(dir, 'tuin.jpg'));
      fs.copyFileSync(path.join(MEDIA(), 'canon.jpg'), path.join(dir, 'tuin (1).jpg')); // kopie
      fs.copyFileSync(path.join(MEDIA(), 'nikon.jpg'), path.join(dir, 'IMG_1234.jpg'));
      fs.copyFileSync(path.join(MEDIA(), 'video.webm'), path.join(dir, 'IMG_1234.webm')); // Live Photo-filmpje
      fs.copyFileSync(path.join(MEDIA(), 'staand.webm'), path.join(dir, 'clip.webm')); // gewoon filmpje
      fs.copyFileSync(path.join(MEDIA(), 'zonder-exif.jpg'), path.join(dir, 'ander.jpg')); // andere foto
      await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
      await page.setInputFiles('#fileInput', fs.readdirSync(dir).map((f) => path.join(dir, f)));
      await expect(page.locator('#count')).toContainText("3 foto's en 1 filmpje geselecteerd");
      await expect(page.locator('#count')).toContainText('1 dubbele overgeslagen');
      await expect(page.locator('#count')).toContainText('1 Live Photo-filmpje overgeslagen');
      await page.click('#startBtn');
      const names = async () => page.evaluate(() => {
        const s = /** @type {any} */ (window).diashow.state;
        return s.order.length;
      });
      expect(await names()).toBe(4); // ander.jpg, clip.webm, IMG_1234.jpg, tuin.jpg
      await page.keyboard.press('g');
      await expect(page.locator('.thumb')).toHaveCount(4);
      await expect(page.locator('.thumb[aria-label*="tuin (1)"]')).toHaveCount(0);
      await expect(page.locator('.thumb[aria-label*="IMG_1234.webm"]')).toHaveCount(0);
      await page.keyboard.press('Escape');

      // Live Photo-filmpjes toch tonen
      await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); });
      await page.keyboard.press('Escape');
      await expect(page.locator('#start')).toBeVisible();
      await page.uncheck('#skipLive');
      await expect(page.locator('#count')).toContainText("3 foto's en 2 filmpjes geselecteerd");
      await expect(page.locator('#count')).not.toContainText('Live Photo');
      await page.click('#startBtn');
      expect(await names()).toBe(5);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('list from the Windows launcher: reports the duplicates it left out and skips Live Photo videos', async ({ page }) => {
    const env = await setup();
    try {
      fs.copyFileSync(path.join(MEDIA(), 'video.webm'), path.join(env.photos, 'nikon.webm'));
      const lijstPad = path.join(path.dirname(new URL(env.url).pathname), 'diashow-lijst.js');
      const files = ['canon.jpg', 'foto1.png', 'nikon.jpg', 'nikon.webm', 'zonder-exif.jpg'];
      const lijst = fs.readFileSync(lijstPad, 'utf8')
        .replace(/DIASHOW_FILES = .*;/, `DIASHOW_FILES = ${JSON.stringify(files)};`)
        .replace(/DIASHOW_TIMES = .*;/, `DIASHOW_TIMES = ${JSON.stringify(files.map(() => 0))};`) + 'window.DIASHOW_DUBBEL = 2;\n';
      fs.writeFileSync(lijstPad, lijst);
      await page.goto(env.url);
      await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).diashow.state.order.length)).toBe(4);
      await expect(page.locator('#count')).toContainText('2 dubbele overgeslagen');
      await expect(page.locator('#count')).toContainText('1 Live Photo-filmpje overgeslagen');
    } finally { await env.cleanup(); }
  });
});

test.describe('datum aanpassen', () => {
  test('D changes the date taken in the photo (time kept); works without an Exif list; PNG explains', async ({ page }) => {
    const env = await setup();
    try {
      const canon = env.file('canon.jpg');
      await openShow(page, env, 'canon.jpg');
      await page.keyboard.press('d');
      await expect(page.locator('#editTitle')).toHaveText('Datum waarop deze foto gemaakt is');
      await expect(page.locator('#dateInput')).toBeVisible();
      await expect(page.locator('#captionInput')).toBeHidden();
      await expect(page.locator('#dateInput')).toHaveValue('2024-07-01');
      await page.fill('#dateInput', '1998-12-24');
      await page.locator('#dateInput').press('Enter');
      await expect(page.locator('#toast')).toHaveText('Datum opgeslagen in de foto');
      await expect(page.locator('#date')).toHaveText('24 december 1998');
      const meta = readMeta(env.file('canon.jpg'));
      expect(meta.dateOriginal).toBe('1998:12:24 11:59:58'); // tijd van de opname blijft
      expect(meta.make).toBe('Canon');
      expect(meta.gpsRef).toBe('N');
      expect(imageData(env.file('canon.jpg')).equals(imageData(canon))).toBe(true);
      expect(fs.readFileSync(path.join(env.photos, 'Diavoorstelling-originelen', 'canon.jpg')).equals(canon)).toBe(true);

      // PNG: kan niet
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#name')).toHaveText('foto1.png');
      await page.keyboard.press('d');
      await expect(page.locator('#toast')).toContainText("alleen bij JPG-foto's");
      await expect(page.locator('#captionEdit')).toBeHidden();

      // Nikon: geen Exif-lijst, Motorola-volgorde, met voorbeeldafbeelding; begint met de bestandsdatum
      const nikon = env.file('nikon.jpg');
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#name')).toHaveText('nikon.jpg');
      await page.mouse.move(640, 300);
      await page.click('#dateBtn');
      await expect(page.locator('#dateInput')).toHaveValue('2020-05-01');
      await page.fill('#dateInput', '2001-02-03');
      await page.click('#captionEdit button[type=submit]');
      await expect(page.locator('#date')).toHaveText('3 februari 2001');
      const m2 = readMeta(env.file('nikon.jpg'));
      expect(m2.dateOriginal).toBe('2001:02:03 12:00:00');
      expect(m2.make).toBe('NIKON CORPORATION');
      expect(m2.thumbnail && m2.thumbnail.equals(readMeta(nikon).thumbnail)).toBe(true);
      expect(imageData(env.file('nikon.jpg')).equals(imageData(nikon))).toBe(true);

      // Esc annuleert zonder iets te veranderen
      const before = env.file('nikon.jpg');
      await page.keyboard.press('d');
      await page.fill('#dateInput', '1970-01-01');
      await page.keyboard.press('Escape');
      await expect(page.locator('#captionEdit')).toBeHidden();
      await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
      expect(env.file('nikon.jpg').equals(before)).toBe(true);

      // Na opnieuw openen komt de datum uit de foto
      await page.reload();
      await openShow(page, env, 'nikon.jpg');
      await expect(page.locator('#date')).toHaveText('3 februari 2001');
    } finally { await env.cleanup(); }
  });

  test('EXIF: date edits are in place after the first; combined with caption and place; no growth', async ({ page }) => {
    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
    for (const f of ['canon.jpg', 'nikon.jpg', 'zonder-exif.jpg']) {
      const start = fs.readFileSync(path.join(MEDIA(), f));
      const r = await page.evaluate((input) => {
        const E = /** @type {any} */ (window).diashow.exif;
        let b = E.write(new Uint8Array(input), { date: '2010-05-06' });
        const afterFirst = b.length;
        const sizes = [];
        for (let i = 0; i < 20; i++) {
          b = E.write(b, i % 2 ? { date: `20${10 + i}-01-0${1 + (i % 9)}` } : { caption: `Tekst ${i}`, date: '2011-11-11' });
          sizes.push(b.length);
        }
        b = E.write(b, { date: '2022-02-22', place: 'Ommen' });
        return { out: [...b], afterFirst, sizes, read: E.read(b) };
      }, [...start]);
      const last = Buffer.from(r.out);
      expect(r.read).toMatchObject({ date: '2022-02-22', place: 'Ommen', caption: 'Tekst 18' });
      expect(Math.max(...r.sizes.slice(4)) - Math.min(...r.sizes.slice(4))).toBeLessThan(64);
      expect(imageData(last).equals(imageData(start))).toBe(true);
      expect(readMeta(last).dateOriginal.startsWith('2022:02:22 ')).toBe(true);
      expect(readMeta(last).make).toBe(readMeta(start).make);
    }
  });
});
