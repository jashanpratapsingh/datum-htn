import { defineConfig, devices } from '@playwright/test';

// Another dev server often sits on :3000 on this laptop (and reuseExistingServer
// would happily test IT instead of this checkout). PORT moves the whole run.
const PORT = process.env.PORT ?? '3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // A fixed SESSION_SECRET keeps login cookies valid across the webServer's
    // lifetime; without one the server mints a per-process secret (fine too,
    // but noisy). Never a production value.
    command: `PATH="${process.env.HOME}/.nvm/versions/node/v22.23.2/bin:$PATH" SESSION_SECRET="${
      process.env.SESSION_SECRET ?? 'playwright-only-secret-not-for-production-0000'
    }" PORT=${PORT} npm run start`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
