import { expect as baseExpect, test as base } from '@playwright/test';
import { resetTestSshFilesystem } from './ssh';

export type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';

export type E2EDatabaseMode = 'seed' | 'empty';

type E2EFixtures = {
  e2eDatabaseMode: E2EDatabaseMode;
  _e2eSpecReset: void;
};

let lastResetFile: string | undefined;

export const test = base.extend<E2EFixtures>({
  e2eDatabaseMode: ['seed', { option: true }],
  _e2eSpecReset: [
    async ({ request, e2eDatabaseMode }, use, testInfo) => {
      const resetKey = `${testInfo.project.name}:${testInfo.file}`;
      if (lastResetFile !== resetKey) {
        const response = await request.post('/api/v1/__e2e/reset', {
          data: { mode: e2eDatabaseMode },
        });
        baseExpect(response.ok(), await response.text()).toBeTruthy();
        await resetTestSshFilesystem();
        lastResetFile = resetKey;
      }

      await use();
    },
    { auto: true },
  ],
});

export const expect = baseExpect;
