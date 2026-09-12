import { expect as baseExpect, test as base } from '@playwright/test';
import { resetTestSshFilesystem } from './ssh';

export type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';

export type E2EDatabaseMode = 'seed' | 'empty';

type E2EFixtures = {
  e2eDatabaseMode: E2EDatabaseMode;
  _e2eTestReset: void;
};

const resetE2EBaseline = async (request: import('@playwright/test').APIRequestContext, mode: E2EDatabaseMode) => {
  let lastFailure = 'E2E reset did not run.';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await request.post('/api/v1/__e2e/reset', { data: { mode } });
    const body = await response.text();
    if (response.ok()) return;

    lastFailure = `E2E reset attempt ${attempt}/3 returned HTTP ${response.status()}: ${body || '<empty body>'}`;
    if (response.status() < 500 || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
  }
  baseExpect(false, lastFailure).toBeTruthy();
};

export const test = base.extend<E2EFixtures>({
  e2eDatabaseMode: ['seed', { option: true }],
  _e2eTestReset: [
    async ({ request, e2eDatabaseMode }, use) => {
      await resetE2EBaseline(request, e2eDatabaseMode);
      await resetTestSshFilesystem();

      await use();
    },
    { auto: true },
  ],
});

export const expect = baseExpect;
