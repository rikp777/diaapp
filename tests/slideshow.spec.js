// @ts-check
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const base = require('@playwright/test');

const { expect } = base;
const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const SETTINGS_KEY = 'diashow-settings';

const media = (...names) => names.map((n) => path.join(process.env.DIASHOW_MEDIA || '', n));
const BASIC = ['foto1.png', 'foto2.png', 'foto10.png', 'video.webm'];
const BASIC_SORTED = ['foto1.png', 'foto2.png', 'foto10.png', 'video.webm'];
const MANY = Array.from({ length: 60 }, (_, i) => `many/p${i + 1}.png`);
const MANY_SORTED = Array.from({ length: 60 }, (_, i) => `p${i + 1}.png`);

// Every test fails if the page throws an uncaught error.
const test = base.test.extend({
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err && err.stack || err)));
    await use(errors);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }, { auto: true }],
});

// ---------- helpers ----------

async function openApp(page) {
  await page.goto(APP_URL);
  await expect(page.locator('#start')).toBeVisible();
}

async function setStartSeconds(page, seconds) {
  const input = page.locator('#seconds');
  await input.fill(String(seconds));
  await input.dispatchEvent('change');
  await expect(input).toHaveValue(String(seconds));
}

/** Records every change of #name with a timestamp (performance.now()). */
async function trackNames(page) {
  await page.evaluate(() => {
    const el = document.getElementById('name');
    const log = [];
    let last = el.textContent;
    // @ts-ignore
    window.__names = log;
    new MutationObserver(() => {
      if (el.textContent !== last) { last = el.textContent; log.push({ t: performance.now(), name: last }); }
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}
const nameLog = (page) => page.evaluate(() => /** @type {any} */ (window).__names);

// The app requests fullscreen on start; that request may still be pending
// (and succeed later) in headless Chromium. Exit until it stays out of fullscreen.
async function ensureNotFullscreen(page) {
  const exitAndCheck = () => page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    return !!document.fullscreenElement;
  });
  await expect.poll(exitAndCheck).toBe(false);
  await expect.poll(exitAndCheck).toBe(false); // still out after the pending request settled
}

/**
 * Opens the app, applies settings via the start screen, loads files and starts.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} files
 * @param {{ seconds?: number, videoMode?: 'full'|'interval', track?: boolean, muted?: boolean }} [opts]
 */
async function startShow(page, files, opts = {}) {
  await openApp(page);
  await setStartSeconds(page, opts.seconds ?? 30);
  if (opts.videoMode) await page.selectOption('#videoMode', opts.videoMode);
  if (opts.muted) await page.check('#muted');
  await page.setInputFiles('#fileInput', media(...files));
  await expect(page.locator('#startBtn')).toBeEnabled();
  if (opts.track) await trackNames(page);
  await page.click('#startBtn');
  await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#name')).not.toHaveText('');
  await ensureNotFullscreen(page);
}

const state = (page) => page.evaluate(() => {
  const s = /** @type {any} */ (window).diashow?.state;
  return s ? JSON.parse(JSON.stringify(s)) : null;
});
const storedSettings = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), SETTINGS_KEY);

async function next(page, expected) {
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#name')).toHaveText(expected);
}

// ---------- tests ----------

test.describe('volgorde en selectie', () => {
  test('natural sort order, position and count text', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('#fileInput', media(...BASIC));
    await expect(page.locator('#count')).toHaveText(/3 foto's en 1 filmpje geselecteerd/);
    await expect(page.locator('#count')).not.toContainText('overgeslagen');

    await setStartSeconds(page, 30);
    await page.click('#startBtn');
    await ensureNotFullscreen(page);
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await expect(page.locator('#pos')).toHaveText('1 / 4');
    await next(page, 'foto2.png');
    await expect(page.locator('#pos')).toHaveText('2 / 4');
    await next(page, 'foto10.png');
    await next(page, 'video.webm');
    await expect(page.locator('#pos')).toHaveText('4 / 4');
    // loop is on by default
    await next(page, 'foto1.png');
    await expect(page.locator('#pos')).toHaveText('1 / 4');
  });
});

test.describe('timing', () => {
  test('a photo advances on its own after ~1 s', async ({ page }) => {
    // Timestamps come from the page (MutationObserver on #name), so test-runner
    // overhead between showing foto1 and the assertions does not matter.
    await startShow(page, ['foto1.png', 'foto2.png', 'foto10.png'], { seconds: 1, track: true });
    await expect(page.locator('#name')).toHaveText('foto2.png', { timeout: 3000 });
    const log = await nameLog(page);
    expect(log.map((e) => e.name).slice(0, 2)).toEqual(['foto1.png', 'foto2.png']);
    const shown = log[1].t - log[0].t;
    expect(shown, `foto1 was shown ${Math.round(shown)} ms (must not advance before ~1 s)`).toBeGreaterThanOrEqual(900);
    expect(shown, `foto1 was shown ${Math.round(shown)} ms`).toBeLessThan(2500);
  });

  test("video in 'full' mode plays to the end even with 1 s photo time", async ({ page }) => {
    await startShow(page, ['foto1.png', 'video.webm'], { seconds: 1, videoMode: 'full', muted: true, track: true });
    await expect(page.locator('#name')).toHaveText('video.webm', { timeout: 5000 });
    await expect(page.locator('#name')).toHaveText('foto1.png', { timeout: 8000 });
    const log = await nameLog(page);
    const vi = log.findIndex((e) => e.name === 'video.webm');
    const shown = log[vi + 1].t - log[vi].t;
    expect(shown, `video was shown ${Math.round(shown)} ms`).toBeGreaterThanOrEqual(1500);
  });

  test("video in 'interval' mode advances after the photo time", async ({ page }) => {
    await startShow(page, ['foto1.png', 'video.webm'], { seconds: 1, videoMode: 'interval', muted: true, track: true });
    await expect(page.locator('#name')).toHaveText('video.webm', { timeout: 5000 });
    await expect(page.locator('#name')).toHaveText('foto1.png', { timeout: 5000 });
    const log = await nameLog(page);
    const vi = log.findIndex((e) => e.name === 'video.webm');
    const shown = log[vi + 1].t - log[vi].t;
    // The video is 2 s long; it must be cut off at ~1 s.
    expect(shown, `video was shown ${Math.round(shown)} ms`).toBeGreaterThanOrEqual(800);
    expect(shown, `video was shown ${Math.round(shown)} ms`).toBeLessThan(1800);
  });
});

test.describe('pauze', () => {
  test('Space pauses and resumes', async ({ page }) => {
    await startShow(page, ['foto1.png', 'foto2.png', 'foto10.png'], { seconds: 1 });
    await page.keyboard.press('Space');
    await expect(page.locator('#toast')).toHaveText('Pauze');
    await page.waitForTimeout(300); // let an in-flight slide change (if any) settle
    const paused = await page.locator('#name').textContent();
    await page.waitForTimeout(2500);
    await expect(page.locator('#name')).toHaveText(/** @type {string} */ (paused));

    await page.keyboard.press('Space');
    await expect(page.locator('#toast')).toHaveText('Afspelen');
    await expect(page.locator('#name')).not.toHaveText(/** @type {string} */ (paused), { timeout: 3000 });
  });

  test('window.diashow.state.playing follows pause', async ({ page }) => {
    await startShow(page, ['foto1.png', 'foto2.png'], { seconds: 30 });
    await expect.poll(async () => (await state(page))?.playing).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page))?.playing).toBe(false);
    const s = await state(page);
    expect(s).toMatchObject({ pos: expect.any(Number), count: 2 });
    expect(Array.isArray(s.order)).toBe(true);
    expect(s).toHaveProperty('liveUrls');
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page))?.playing).toBe(true);
  });
});

test.describe('toetsen', () => {
  test('arrows, Home/End', async ({ page }) => {
    await startShow(page, BASIC);
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await next(page, 'foto2.png');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await page.keyboard.press('ArrowLeft'); // wraps with loop on
    await expect(page.locator('#name')).toHaveText('video.webm');
    await page.keyboard.press('Home');
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await expect(page.locator('#pos')).toHaveText('1 / 4');
    await page.keyboard.press('End');
    await expect(page.locator('#name')).toHaveText('video.webm');
    await expect(page.locator('#pos')).toHaveText('4 / 4');
  });

  test('+ and - change seconds', async ({ page }) => {
    await startShow(page, ['foto1.png', 'foto2.png'], { seconds: 5 });
    await expect(page.locator('#barSeconds')).toHaveValue('5');
    await page.keyboard.type('+');
    await expect(page.locator('#barSeconds')).toHaveValue('6');
    await page.keyboard.type('-');
    await page.keyboard.type('-');
    await expect(page.locator('#barSeconds')).toHaveValue('4');
    expect((await storedSettings(page)).seconds).toBe(4);
  });

  test('- does not go below 1 second', async ({ page }) => {
    await startShow(page, ['foto1.png', 'foto2.png'], { seconds: 1 });
    await page.keyboard.press('Space'); // pause so nothing moves
    await page.keyboard.type('-');
    await expect(page.locator('#barSeconds')).toHaveValue('1');
  });

  test('M toggles mute, S toggles shuffle', async ({ page }) => {
    await startShow(page, BASIC);
    expect((await storedSettings(page)).muted ?? false).toBe(false);
    await page.keyboard.press('m');
    await expect.poll(async () => (await storedSettings(page)).muted).toBe(true);
    await expect(page.locator('#toast')).toHaveText('Geluid uit');
    await page.keyboard.press('m');
    await expect.poll(async () => (await storedSettings(page)).muted).toBe(false);

    const before = await page.locator('#name').textContent();
    await page.keyboard.press('s');
    await expect.poll(async () => (await storedSettings(page)).shuffle).toBe(true);
    await expect(page.locator('#shuffleBtn')).toHaveClass(/\bon\b/);
    // Shuffling keeps the current slide on screen.
    await expect(page.locator('#name')).toHaveText(/** @type {string} */ (before));
    await page.keyboard.press('s');
    await expect.poll(async () => (await storedSettings(page)).shuffle).toBe(false);
    await expect(page.locator('#shuffleBtn')).not.toHaveClass(/\bon\b/);

    // Back on the start screen the checkboxes reflect the toggles.
    await page.keyboard.press('m');
    await ensureNotFullscreen(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#start')).toBeVisible();
    await expect(page.locator('#muted')).toBeChecked();
    await expect(page.locator('#shuffle')).not.toBeChecked();
  });

  test('F (fullscreen) does not throw', async ({ page }) => {
    await startShow(page, ['foto1.png', 'foto2.png']);
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
  });
});

test.describe('Esc', () => {
  test('Esc (not fullscreen) returns to the start screen', async ({ page }) => {
    await startShow(page, BASIC);
    await page.keyboard.press('Escape');
    await expect(page.locator('#start')).toBeVisible();
    await expect(page.locator('#show')).not.toHaveClass(/\bactive\b/);
    // and the show can be started again
    await page.click('#startBtn');
    await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#name')).toHaveText('foto1.png');
  });

  test('with the grid open, the first Esc only closes the grid', async ({ page }) => {
    await startShow(page, BASIC);
    await page.keyboard.press('g');
    await expect(page.locator('#grid')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#grid')).toBeHidden();
    await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
    await ensureNotFullscreen(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#start')).toBeVisible();
  });
});

test.describe('overzicht (grid)', () => {
  test('G opens the grid; clicking a thumb jumps there and closes it', async ({ page }) => {
    await startShow(page, BASIC);
    await next(page, 'foto2.png');
    await page.keyboard.press('g');
    const grid = page.locator('#grid');
    await expect(grid).toBeVisible();
    const thumbs = grid.locator('.thumb');
    await expect(thumbs).toHaveCount(4);
    await expect(grid.locator('.thumb.current')).toHaveCount(1);
    await expect(thumbs.nth(1)).toHaveClass(/\bcurrent\b/);
    for (let i = 0; i < 4; i++) await expect(thumbs.nth(i)).toHaveAttribute('data-pos', /\d+/);

    await thumbs.nth(2).click();
    await expect(grid).toBeHidden();
    await expect(page.locator('#name')).toHaveText('foto10.png');
    await expect(page.locator('#pos')).toHaveText('3 / 4');
  });

  test('#gridBtn opens the grid', async ({ page }) => {
    await startShow(page, BASIC);
    await page.mouse.move(600, 400);
    await page.click('#gridBtn');
    await expect(page.locator('#grid')).toBeVisible();
    await expect(page.locator('#grid .thumb')).toHaveCount(4);
  });

  test('thumbnails load lazily with many items', async ({ page }) => {
    // On a desktop viewport all 60 thumbs fit on screen; a phone-sized
    // viewport (3 columns, ~20 rows) makes most of them start off-screen.
    await page.setViewportSize({ width: 390, height: 600 });
    await startShow(page, MANY);
    await page.keyboard.press('g');
    const grid = page.locator('#grid');
    await expect(grid).toBeVisible();
    await expect(grid.locator('.thumb')).toHaveCount(60);
    // Give eager loading a chance to show itself.
    await page.waitForTimeout(500);
    const loaded = await grid.locator('.thumb img[src]').count();
    expect(loaded, 'thumbs with img[src] before scrolling').toBeLessThan(60);

    // Scrolling to the end loads the last thumb, and clicking it jumps there.
    const last = grid.locator('.thumb').nth(59);
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator('img[src]')).toHaveCount(1);
    await last.click();
    await expect(grid).toBeHidden();
    await expect(page.locator('#name')).toHaveText(MANY_SORTED[59]);
    await expect(page.locator('#pos')).toHaveText('60 / 60');
  });
});

test.describe('overzicht layout', () => {
  test('thumbs do not overlap each other', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await startShow(page, MANY);
    await page.keyboard.press('g');
    await expect(page.locator('#grid')).toBeVisible();
    const overlaps = await page.evaluate(() => {
      const r = [...document.querySelectorAll('#grid .thumb')].map((b) => b.getBoundingClientRect());
      const bad = [];
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
        const a = r[i], b = r[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) bad.push(`${i}/${j}`);
      }
      return bad.slice(0, 5);
    });
    expect(overlaps, 'overlapping thumb pairs').toEqual([]);
  });
});

test.describe('geheugen', () => {
  test('only a small window of object URLs is kept alive', async ({ page }) => {
    await startShow(page, MANY);
    await expect(page.locator('#name')).toHaveText('p1.png');
    for (let i = 2; i <= 15; i++) await next(page, `p${i}.png`);
    const s = await state(page);
    expect(s, 'window.diashow.state').not.toBeNull();
    const live = Array.isArray(s.liveUrls) ? s.liveUrls.length : s.liveUrls;
    expect(typeof live).toBe('number');
    expect(live).toBeLessThanOrEqual(8);
    expect(s.count).toBe(60);
    expect(s.pos).toBe(14);
  });
});

test.describe('instellingen', () => {
  test('settings persist across reload', async ({ page }) => {
    await openApp(page);
    await setStartSeconds(page, 7);
    await page.selectOption('#videoMode', 'interval');
    await page.check('#shuffle');
    await page.check('#muted');
    await page.uncheck('#loop');
    await page.check('#fill');
    await page.reload();
    await expect(page.locator('#seconds')).toHaveValue('7');
    await expect(page.locator('#videoMode')).toHaveValue('interval');
    await expect(page.locator('#shuffle')).toBeChecked();
    await expect(page.locator('#muted')).toBeChecked();
    await expect(page.locator('#loop')).not.toBeChecked();
    await expect(page.locator('#fill')).toBeChecked();
  });

  test('kenburns defaults to off and persists', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#kenburns')).not.toBeChecked();
    await page.check('#kenburns');
    await page.reload();
    await expect(page.locator('#kenburns')).toBeChecked();
  });

  test('seconds input is clamped to 1..3600', async ({ page }) => {
    await openApp(page);
    await setStartSeconds(page, 1);
    const input = page.locator('#seconds');
    await input.fill('99999');
    await input.dispatchEvent('change');
    await expect(input).toHaveValue('3600');
  });

  test('corrupt localStorage does not break the page', async ({ page }) => {
    await page.goto(APP_URL);
    await page.evaluate((k) => localStorage.setItem(k, '{bad json'), SETTINGS_KEY);
    await page.reload();
    await expect(page.locator('#start')).toBeVisible();
    await expect(page.locator('#seconds')).toHaveValue('5');
    await page.setInputFiles('#fileInput', media('foto1.png', 'foto2.png'));
    await expect(page.locator('#startBtn')).toBeEnabled();
    await page.click('#startBtn');
    await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#name')).toHaveText('foto1.png');
  });

  test('wrongly typed stored settings fall back to sane values', async ({ page }) => {
    await page.goto(APP_URL);
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ seconds: 'abc', videoMode: 'nope' })), SETTINGS_KEY);
    await page.reload();
    await page.setInputFiles('#fileInput', media('foto1.png', 'foto2.png'));
    await page.click('#startBtn');
    await ensureNotFullscreen(page);
    await expect(page.locator('#name')).toHaveText('foto1.png');
    const v = Number(await page.locator('#barSeconds').inputValue());
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(3600);
  });
});

test.describe('niet-ondersteunde bestanden', () => {
  test('fake HEIC and txt are skipped and reported', async ({ page }) => {
    await openApp(page);
    await setStartSeconds(page, 30);
    await page.setInputFiles('#fileInput', media('kapot.heic', 'notitie.txt', ...BASIC));
    await expect(page.locator('#count')).toContainText('overgeslagen');
    await page.click('#startBtn');
    await ensureNotFullscreen(page);
    await expect(page.locator('#pos')).toHaveText(/ \/ 4$/);
    const seen = [];
    for (let i = 0; i < 5; i++) {
      seen.push(await page.locator('#name').textContent());
      const before = await page.locator('#pos').textContent();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#pos')).not.toHaveText(/** @type {string} */ (before));
    }
    expect(seen).not.toContain('kapot.heic');
    expect(seen).not.toContain('notitie.txt');
  });

  test('only unsupported files: start stays disabled', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('#fileInput', media('notitie.txt'));
    await expect(page.locator('#count')).not.toHaveText('');
    await expect(page.locator('#startBtn')).toBeDisabled();
  });
});

test.describe('mobiel (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: false });

  /** Asserts that the element's box (and its visible children) lies within 0..390. */
  async function expectWithinViewport(page, selector) {
    await expect.poll(() => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return `${sel} missing`;
      const bad = [];
      for (const e of [el, ...el.querySelectorAll('*')]) {
        const r = e.getBoundingClientRect();
        if (!r.width || getComputedStyle(e).visibility === 'hidden') continue;
        if (r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`${e.id || e.className || e.tagName}: ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      return bad.length ? bad.join(', ') : 'ok';
    }, selector)).toBe('ok');
  }

  test('start screen has no horizontal scroll', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('#fileInput', media('kapot.heic', ...BASIC));
    const m = await page.evaluate(() => {
      const s = document.getElementById('start');
      return { doc: document.documentElement.scrollWidth, start: s.scrollWidth, startClient: s.clientWidth };
    });
    expect(m.doc).toBeLessThanOrEqual(390);
    expect(m.start).toBeLessThanOrEqual(m.startClient);
  });

  test('bar fits during the show', async ({ page }) => {
    await startShow(page, BASIC);
    await page.mouse.move(100, 300);
    await page.mouse.move(200, 400);
    await expect(page.locator('#show')).toHaveClass(/\bui\b/);
    await expectWithinViewport(page, '#bar');
  });

  test('grid fits', async ({ page }) => {
    await startShow(page, MANY);
    await page.keyboard.press('g');
    await expect(page.locator('#grid')).toBeVisible();
    await expectWithinViewport(page, '#grid');
    const m = await page.evaluate(() => {
      const g = document.getElementById('grid');
      return { doc: document.documentElement.scrollWidth, grid: g.scrollWidth, gridClient: g.clientWidth };
    });
    expect(m.doc).toBeLessThanOrEqual(390);
    expect(m.grid).toBeLessThanOrEqual(m.gridClient);
  });
});

test.describe('klikzones', () => {
  test('right third = next, left third = previous, middle = pause', async ({ page }) => {
    await startShow(page, BASIC);
    const { width, height } = /** @type {{width:number,height:number}} */ (page.viewportSize());
    const y = Math.round(height * 0.4);
    await expect(page.locator('#name')).toHaveText('foto1.png');

    await page.mouse.click(Math.round(width * 0.85), y);
    await expect(page.locator('#name')).toHaveText('foto2.png');
    await page.mouse.click(Math.round(width * 0.85), y);
    await expect(page.locator('#name')).toHaveText('foto10.png');
    await page.mouse.click(Math.round(width * 0.15), y);
    await expect(page.locator('#name')).toHaveText('foto2.png');

    await page.mouse.click(Math.round(width * 0.5), y);
    await expect(page.locator('#toast')).toHaveText('Pauze');
    await expect(page.locator('#name')).toHaveText('foto2.png');
    await page.waitForTimeout(600); // the toast hides after ~0.9 s; let a new one replace it
    await page.mouse.click(Math.round(width * 0.5), y);
    await expect(page.locator('#toast')).toHaveText('Afspelen');
  });

  test('clicks on the bar do not navigate', async ({ page }) => {
    await startShow(page, BASIC);
    await page.mouse.move(300, 300);
    await page.click('#nextBtn');
    await expect(page.locator('#name')).toHaveText('foto2.png');
    await page.click('#pos');
    await page.waitForTimeout(400);
    await expect(page.locator('#name')).toHaveText('foto2.png');
  });

  test('double-click only toggles fullscreen, it does not navigate', async ({ page }) => {
    await startShow(page, BASIC);
    const { width, height } = /** @type {{width:number,height:number}} */ (page.viewportSize());
    await page.mouse.dblclick(Math.round(width * 0.85), Math.round(height * 0.4));
    await page.waitForTimeout(600); // longer than the single-click delay
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await expect(page.locator('#pos')).toHaveText('1 / 4');
  });
});

test.describe('volume', () => {
  test('#volume range is in the bar', async ({ page }) => {
    await startShow(page, BASIC);
    await page.mouse.move(300, 300);
    const vol = page.locator('#bar #volume');
    await expect(vol).toBeVisible();
    await expect(vol).toHaveAttribute('type', 'range');
  });
});

test.describe('lijst-modus (diashow-lijst.js)', () => {
  let dir;
  test.beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-lijst-'));
    const src = process.env.DIASHOW_MEDIA || '';
    fs.copyFileSync(path.resolve(__dirname, '..', 'index.html'), path.join(dir, 'index.html'));
    fs.copyFileSync(path.join(src, 'foto1.png'), path.join(dir, 'foto1.png'));
    fs.copyFileSync(path.join(src, 'foto2.png'), path.join(dir, 'foto2.png'));
    fs.copyFileSync(path.join(src, 'video.webm'), path.join(dir, 'clip.webm'));
    fs.mkdirSync(path.join(dir, 'sub map'));
    fs.copyFileSync(path.join(src, 'foto10.png'), path.join(dir, 'sub map', 'foto10.png'));
    fs.writeFileSync(path.join(dir, 'diashow-lijst.js'),
      'window.DIASHOW_FILES = ["foto1.png","sub map/foto10.png","foto2.png","clip.webm"];\n');
  });
  test.afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  test('starts automatically, natural path order, source lijst, Esc shows count', async ({ page }) => {
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
    await expect.poll(async () => (await state(page))?.source).toBe('lijst');
    await ensureNotFullscreen(page);
    await page.keyboard.press('Home');
    const expected = ['clip.webm', 'foto1.png', 'foto2.png', 'sub map/foto10.png'];
    await expect(page.locator('#name')).toHaveText(expected[0]);
    await expect(page.locator('#pos')).toHaveText('1 / 4');
    for (const n of expected.slice(1)) await next(page, n);
    expect((await state(page)).count).toBe(4);

    await ensureNotFullscreen(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#start')).toBeVisible();
    await expect(page.locator('#show')).not.toHaveClass(/\bactive\b/);
    await expect(page.locator('#count')).toContainText('uit deze map');
  });
});

test.describe('na review', () => {
  test('previous on the first slide with loop off does not reload it', async ({ page }) => {
    await openApp(page);
    await page.uncheck('#loop');
    await page.setInputFiles('#fileInput', media(...BASIC));
    await page.click('#startBtn');
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await ensureNotFullscreen(page);
    await page.waitForTimeout(500);
    // Mark the shown element; a reload would replace it with a new one
    await page.evaluate(() => { /** @type {any} */ (document.querySelector('.slide.visible img')).__mark = 1; });
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(1200);
    await expect(page.locator('#name')).toHaveText('foto1.png');
    expect(await page.evaluate(() => /** @type {any} */ (document.querySelector('.slide.visible img'))?.__mark)).toBe(1);
  });

  test('Enter in the seconds field starts with the typed value', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('#fileInput', media(...BASIC));
    await page.fill('#seconds', '7');
    await page.press('#seconds', 'Enter');
    await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#barSeconds')).toHaveValue('7');
  });

  test('Tab into the hidden bar shows it; stopping focuses the start button', async ({ page }) => {
    await startShow(page, BASIC);
    await page.evaluate(() => document.getElementById('show').classList.remove('ui'));
    await page.keyboard.press('Tab');
    await expect(page.locator('#show')).toHaveClass(/\bui\b/);
    expect(await page.evaluate(() => !!document.activeElement.closest('#bar'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#start')).toBeVisible();
    await expect(page.locator('#startBtn')).toBeFocused();
  });

  test('double-click on a thumbnail jumps without toggling fullscreen', async ({ page }) => {
    await startShow(page, BASIC);
    await page.evaluate(() => {
      // @ts-ignore
      window.__fs = 0;
      const orig = document.documentElement.requestFullscreen.bind(document.documentElement);
      // @ts-ignore
      document.documentElement.requestFullscreen = (...a) => { window.__fs++; return orig(...a); };
    });
    await page.keyboard.press('g');
    await expect(page.locator('#grid')).toBeVisible();
    await page.locator('.thumb[data-pos="2"]').dblclick();
    await expect(page.locator('#grid')).toBeHidden();
    await expect(page.locator('#name')).toHaveText('foto10.png');
    await page.waitForTimeout(400);
    // @ts-ignore
    expect(await page.evaluate(() => window.__fs)).toBe(0);
  });
});

test.describe('Windows-download (één bestand)', () => {
  let app, photos;
  test.beforeAll(() => {
    // Zoals de starter het doet: app in de ene map, foto's (met spatie en # in de naam) in een andere
    app = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-app-'));
    photos = fs.mkdtempSync(path.join(os.tmpdir(), 'Foto\'s van mam #1 '));
    const src = process.env.DIASHOW_MEDIA || '';
    fs.copyFileSync(path.resolve(__dirname, '..', 'index.html'), path.join(app, 'index.html'));
    fs.copyFileSync(path.join(src, 'foto1.png'), path.join(photos, 'foto1.png'));
    fs.mkdirSync(path.join(photos, 'Vakantie 2024'));
    fs.copyFileSync(path.join(src, 'foto2.png'), path.join(photos, 'Vakantie 2024', 'strand.png'));
    const base = pathToFileURL(photos).href + '/';
    fs.writeFileSync(path.join(app, 'diashow-lijst.js'),
      `window.DIASHOW_BASE = ${JSON.stringify(base)};\nwindow.DIASHOW_FILES = ["foto1.png","Vakantie 2024/strand.png"];\n`);
  });
  test.afterAll(() => {
    for (const d of [app, photos]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  test('photos from another folder (DIASHOW_BASE) are shown', async ({ page }) => {
    await page.goto(pathToFileURL(path.join(app, 'index.html')).href);
    await expect(page.locator('#show')).toHaveClass(/\bactive\b/);
    await ensureNotFullscreen(page);
    await page.keyboard.press('Home');
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await expect.poll(() => page.evaluate(() => {
      const img = /** @type {HTMLImageElement|null} */ (document.querySelector('.slide.visible img'));
      return img ? img.naturalWidth : 0;
    })).toBeGreaterThan(0);
    await next(page, 'Vakantie 2024/strand.png');
    expect((await state(page)).count).toBe(2);
  });

  test('build script puts the whole app into one .bat', async () => {
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [path.resolve(__dirname, '..', 'scripts', 'maak-download.js')]);
    const bat = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'Diavoorstelling.bat'), 'utf8');
    expect(bat.startsWith('@echo off\r\n')).toBe(true);
    expect(bat.replace(/\r\n/g, '')).not.toContain('\n'); // overal CRLF
    // Zelfde splitsing als het PowerShell-deel: script tussen de scheidingstekens, daarna de app
    const [, rest] = bat.split('#POWERSHELL#');
    const [script, html] = rest.split('#DIAHTML#');
    expect(script).toContain('$global:DiaHtml');
    expect(script).not.toContain('<html');
    const app = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
    expect(html.replace(/\r\n/g, '\n').trimStart()).toBe(app.replace(/\r\n/g, '\n'));
    expect(/[^\x00-\x7f]/.test(bat.slice(0, bat.indexOf('#DIAHTML#')))).toBe(false);
  });
});

test.describe("bewegende foto's (animatie)", () => {
  const currentImgHasKb = (page) => page.evaluate(() =>
    !!document.querySelector('.slide.visible img')?.classList.contains('kb'));

  test('A and the bar button turn it on/off for the current photo, and it is remembered', async ({ page }) => {
    await startShow(page, BASIC);
    await expect(page.locator('#name')).toHaveText('foto1.png');
    expect(await currentImgHasKb(page)).toBe(false);
    await page.keyboard.press('a');
    await expect.poll(() => currentImgHasKb(page)).toBe(true);
    await expect(page.locator('#kbBtn')).toHaveAttribute('aria-pressed', 'true');
    expect((await storedSettings(page)).kenburns).toBe(true);

    await page.mouse.move(640, 300);
    await page.click('#kbBtn');
    await expect.poll(() => currentImgHasKb(page)).toBe(false);
    await expect(page.locator('#kbBtn')).toHaveAttribute('aria-pressed', 'false');
    expect((await storedSettings(page)).kenburns).toBe(false);
  });

  test('the settings button in the bar opens the settings screen with the option', async ({ page }) => {
    await startShow(page, BASIC);
    await page.keyboard.press('a');
    await page.mouse.move(640, 300);
    await page.click('#exitBtn');
    await expect(page.locator('#start')).toBeVisible();
    await expect(page.locator('#kenburns')).toBeChecked();
    await expect(page.locator('label[for="kenburns"]')).toContainText("Bewegende foto's");
  });

  test('works when the computer asks for reduced motion, if the user turned it on', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await page.check('#kenburns');
    await page.setInputFiles('#fileInput', media(...BASIC));
    await page.click('#startBtn');
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await expect.poll(() => currentImgHasKb(page)).toBe(true);
    const animating = await page.evaluate(() =>
      document.querySelector('.slide.visible img').getAnimations().length > 0);
    expect(animating).toBe(true);
  });
});

test.describe('scherm vullen', () => {
  const fit = (page) => page.evaluate(() => {
    const img = document.querySelector('.slide.visible img');
    return img ? getComputedStyle(img).objectFit : null;
  });

  test('V and the bar button switch fill immediately, and it is remembered', async ({ page }) => {
    await startShow(page, BASIC);
    await expect(page.locator('#name')).toHaveText('foto1.png');
    expect(await fit(page)).toBe('contain');
    await page.keyboard.press('v');
    await expect.poll(() => fit(page)).toBe('cover');
    await expect(page.locator('#fillBtn')).toHaveAttribute('aria-pressed', 'true');
    expect((await storedSettings(page)).fill).toBe(true);

    await page.mouse.move(640, 300);
    await page.click('#fillBtn');
    await expect.poll(() => fit(page)).toBe('contain');
    expect((await storedSettings(page)).fill).toBe(false);

    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await expect(page.locator('#fill')).toBeChecked();
  });
});

test.describe('scherm vullen en staande beelden', () => {
  test('fill crops landscape photos on a landscape screen, but shows portrait photos and videos fully', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openApp(page);
    await page.check('#fill');
    await page.selectOption('#videoMode', 'interval');
    await setStartSeconds(page, 30);
    await page.setInputFiles('#fileInput', media('foto1.png', 'foto2.png', 'staand.webm'));
    await page.click('#startBtn');
    await ensureNotFullscreen(page);
    const fitOf = () => page.evaluate(() => {
      const el = document.querySelector('.slide.visible img, .slide.visible video');
      return el ? getComputedStyle(el).objectFit : null;
    });
    await page.keyboard.press('Home');
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await expect.poll(fitOf).toBe('cover'); // liggend op liggend scherm: vullen
    await next(page, 'foto2.png');
    await expect.poll(fitOf).toBe('contain'); // staande foto: helemaal tonen
    await next(page, 'staand.webm');
    await expect.poll(fitOf).toBe('contain'); // staand filmpje: helemaal tonen

    // Op een staand scherm (telefoon) wordt een staand filmpje wel gevuld
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(fitOf).toBe('cover');
  });
});

test.describe('beeld past altijd binnen het scherm', () => {
  for (const [w, h] of [[1280, 720], [390, 844]]) {
    test(`portrait/landscape photos and videos stay within ${w}x${h} (fill off)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openApp(page);
      await page.selectOption('#videoMode', 'interval');
      await setStartSeconds(page, 30);
      await page.setInputFiles('#fileInput', media('foto1.png', 'foto2.png', 'foto10.png', 'staand.webm', 'video.webm'));
      await page.click('#startBtn');
      await ensureNotFullscreen(page);
      await page.keyboard.press('Home');
      for (const name of ['foto1.png', 'foto2.png', 'foto10.png', 'staand.webm', 'video.webm']) {
        await expect(page.locator('#name')).toHaveText(name);
        const box = await page.evaluate(() => {
          const el = document.querySelector('.slide.visible img, .slide.visible video');
          const r = el.getBoundingClientRect();
          return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
        });
        expect(box.top, name).toBeGreaterThanOrEqual(-1);
        expect(box.left, name).toBeGreaterThanOrEqual(-1);
        expect(box.bottom, name).toBeLessThanOrEqual(h + 1);
        expect(box.right, name).toBeLessThanOrEqual(w + 1);
        await page.keyboard.press('ArrowRight');
      }
    });
  }
});


test.describe('scherm wakker houden', () => {
  // Nep-Wake Lock die bijhoudt wat de app aanvraagt en loslaat
  const fakeWakeLock = () => {
    const log = [];
    /** @type {any} */ (window).__wake = log;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: async (type) => {
        log.push(`aan:${type}`);
        const listeners = [];
        const lock = {
          released: false,
          addEventListener: (ev, fn) => { if (ev === 'release') listeners.push(fn); },
          release: async () => { if (!lock.released) { lock.released = true; log.push('uit'); listeners.forEach((f) => f()); } },
          // de browser laat los als het venster verborgen wordt
          __browserRelease: () => { lock.released = true; log.push('browser-los'); listeners.forEach((f) => f()); },
        };
        /** @type {any} */ (window).__lock = lock;
        return lock;
      },
    } });
  };
  const wakeLog = (page) => page.evaluate(() => /** @type {any} */ (window).__wake);

  test('the screen is kept awake during the show, released on the settings screen, and re-requested after hiding', async ({ page }) => {
    await page.addInitScript(fakeWakeLock);
    await startShow(page, BASIC);
    await expect.poll(() => wakeLog(page)).toEqual(['aan:screen']);
    await page.keyboard.press('Space'); // pauze: blijft wakker
    expect(await wakeLog(page)).toEqual(['aan:screen']);

    // Browser laat los (venster verborgen) en het venster komt terug: opnieuw aanvragen
    await page.evaluate(() => {
      /** @type {any} */ (window).__lock.__browserRelease();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => wakeLog(page)).toEqual(['aan:screen', 'browser-los', 'aan:screen']);

    // Naar het instellingenscherm: loslaten
    await page.keyboard.press('Escape');
    await expect(page.locator('#start')).toBeVisible();
    await expect.poll(() => wakeLog(page)).toEqual(['aan:screen', 'browser-los', 'aan:screen', 'uit']);
  });

  test('with the setting off nothing is requested', async ({ page }) => {
    await page.addInitScript(fakeWakeLock);
    await openApp(page);
    await expect(page.locator('#keepAwake')).toBeChecked();
    await page.uncheck('#keepAwake');
    await page.setInputFiles('#fileInput', media(...BASIC));
    await page.click('#startBtn');
    await expect(page.locator('#name')).toHaveText('foto1.png');
    await page.waitForTimeout(300);
    expect(await wakeLog(page)).toEqual([]);
  });

  test('without Wake Lock support the show still works', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, 'wakeLock', { value: undefined }); });
    await startShow(page, BASIC, { seconds: 1 });
    await expect(page.locator('#name')).toHaveText('foto2.png', { timeout: 4000 });
  });
});

test.describe('scherm wakker houden (echte Wake Lock)', () => {
  test('with the real API: awake during the show, released on the settings screen', async ({ page, context }) => {
    // Een browser zonder scherm weigert standaard; een gewone Edge/Chrome staat het toe
    await context.grantPermissions(['screen-wake-lock']);
    await startShow(page, BASIC);
    await expect.poll(async () => (await state(page)).awake).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#start')).toBeVisible();
    await expect.poll(async () => (await state(page)).awake).toBe(false);
  });
});
