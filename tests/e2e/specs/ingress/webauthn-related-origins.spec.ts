import { expect, test } from '@playwright/test';

test.describe('production WebAuthn Related Origins ingress', () => {
  test('serves related origins JSON instead of the SPA fallback', async ({ request }) => {
    const response = await request.get('/.well-known/webauthn', {
      headers: {
        Host: 'ssh.honus.top',
      },
    });

    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');

    const bodyText = await response.text();
    expect(bodyText.toLowerCase()).not.toContain('<!doctype html');
    expect(bodyText.toLowerCase()).not.toContain('<html');

    const payload = JSON.parse(bodyText) as { origins?: string[] };
    expect(payload.origins).toContain('https://ssh.trui.de');
  });
});
