import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  webServer: [
    {
      command: 'python -m backend.tools.run_e2e_backend',
      cwd: '..',
      env: {
        ...process.env,
        CONTENT_ROOT: 'runtime/sandbox_workspace',
        APP_DB_PATH: 'runtime/e2e_runtime/e2e_app.db',
        RUNTIME_ROOT: 'runtime/e2e_runtime',
        ENABLE_TEST_SUPPORT: 'true',
      },
      url: 'http://127.0.0.1:18080/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --port 15173',
      cwd: '.',
      env: {
        ...process.env,
        VITE_API_BASE_URL: 'http://127.0.0.1:18080',
      },
      url: 'http://127.0.0.1:15173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:15173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
