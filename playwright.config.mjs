import { defineConfig } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E always uses isolated state; never read or mutate the developer's .emsystems-data.
const e2eRoot = mkdtempSync(join(tmpdir(), 'emsystems-browser-e2e-'));
process.on('exit', () => rmSync(e2eRoot, { recursive: true, force: true }));
const appOrigin = 'http://127.0.0.1:5193';
const paymentToken = 'e2e-only-payment-service-secret-64-characters-long';
const adminPassword = 'EMAdmin@2026!Retail';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/browser-e2e',
  use: {
    baseURL: appOrigin,
    browserName: 'chromium',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 1365, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: [
    {
      command: 'node server/app-api-server.mjs',
      url: 'http://127.0.0.1:5196/api/app/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        APP_API_PORT: '5196',
        EMSYSTEMS_DB_PATH: join(e2eRoot, 'business.sqlite'),
        PUBLIC_APP_ORIGIN: appOrigin,
        APP_ALLOWED_ORIGINS: appOrigin,
        PAYMENT_SERVICE_TOKEN: paymentToken,
        EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
        NODE_ENV: 'test',
      },
    },
    {
      command: 'node payment-sandbox-server.mjs',
      url: 'http://127.0.0.1:5197/api/payments/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PAYMENT_PORT: '5197',
        PAYMENT_STATE_DIR: join(e2eRoot, 'payments'),
        PAYMENT_FRONTEND_URL: appOrigin,
        PAYMENT_PUBLIC_BASE_URL: 'https://callback.invalid',
        APP_API_INTERNAL_URL: 'http://127.0.0.1:5196',
        PAYMENT_SERVICE_TOKEN: paymentToken,
        MOMO_PARTNER_CODE: '',
        MOMO_ACCESS_KEY: '',
        MOMO_SECRET_KEY: '',
        VNPAY_TMN_CODE: '',
        VNPAY_HASH_SECRET: '',
        VNPAY_IPN_CONFIGURED: 'false',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'npm run dev:web -- --port 5193 --strictPort',
      url: appOrigin,
      reuseExistingServer: false,
      timeout: 45_000,
      env: {
        EMSYSTEMS_API_PROXY_TARGET: 'http://127.0.0.1:5196',
        EMSYSTEMS_PAYMENT_PROXY_TARGET: 'http://127.0.0.1:5197',
      },
    },
  ],
});
