import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, resetTestSshFilesystem } from '../../support/ssh';

test('backend can authenticate to the real SSH test server', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();

  const response = await request.post('/api/v1/connections/test-unsaved', {
    data: {
      name: E2E_SSH.name,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      auth_method: 'password',
      password: E2E_SSH.password,
    },
  });

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ success: true });
});
