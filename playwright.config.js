// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Only needed when no Playwright-managed browser can be found (e.g. a sandbox
// with a custom browser location). In CI, `npx playwright install --with-deps
// chromium` provides the browser and this stays unset.
const executablePath = process.env.DIASHOW_CHROMIUM_PATH || undefined;

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./tests/global-setup.js'),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Timing tests are sensitive to CPU starvation; keep parallelism modest.
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
      ...(executablePath ? { executablePath } : {}),
    },
  },
  projects: [
    { name: 'chromium', testIgnore: /windows\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    // Echte Diavoorstelling.bat (PowerShell-hulpprogramma) met Edge; alleen op Windows
    ...(process.platform === 'win32'
      ? [{ name: 'windows', testMatch: /windows\.spec\.js/, timeout: 120_000, use: { ...devices['Desktop Edge'], channel: 'msedge' } }]
      : []),
  ],
});
