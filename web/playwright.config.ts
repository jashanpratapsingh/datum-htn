import { defineConfig, devices } from '@playwright/test';

// Other local servers often hold :3000; E2E_PORT moves the whole run.
const PORT = process.env.E2E_PORT ?? '3000';

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
    command: `PATH="${process.env.HOME}/.nvm/versions/node/v22.23.2/bin:$PATH" PORT=${PORT} npm run start`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
