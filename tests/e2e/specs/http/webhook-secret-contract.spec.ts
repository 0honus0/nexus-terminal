import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH } from '../../support/ssh';

const cases = [
  { name: 'automatic credential names redact case-insensitively', kind: 'redact' },
  { name: 'null preserves an existing secret using different header casing', kind: 'preserve' },
  { name: 'null cannot preserve a public header', kind: 'public-null' },
  { name: 'null cannot create an unknown secret header', kind: 'unknown-null' },
  { name: 'custom secret classification cannot be removed while retaining null', kind: 'unmark' },
  { name: 'invalid custom secret header name is rejected atomically', kind: 'invalid-name' },
  { name: 'non-string header values are rejected atomically', kind: 'invalid-value' },
] as const;

for (const scenario of cases) {
  test(scenario.name, async ({ request }) => {
    await loginAsInitialAdmin(request);
    const name = `E2E Secret Contract ${randomUUID()}`;
    const secret = 'Bearer e2e-original';
    const url = `${E2E_SSH.controlUrl}/e2e-notification-webhook-secrets?phase=original`;
    const created = await request.post('/api/v1/notifications', {
      data: {
        channelType: 'webhook',
        name,
        enabled: false,
        enabledEvents: [],
        config: {
          url,
          method: 'POST',
          headers: {
            Authorization: secret,
            'X-E2E-Private': 'private-original',
            'X-Public': 'visible',
            'X-Api-Key': 'key-original',
            Cookie: 'cookie-original',
          },
          secretHeaderNames: ['X-E2E-Private'],
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const initial = (await created.json()) as { id: number; config: { headers: Record<string, string | null> } };
    try {
      expect(JSON.stringify(initial)).not.toContain(secret);
      expect(initial.config.headers).toMatchObject({
        Authorization: null,
        'X-E2E-Private': null,
        'X-Api-Key': null,
        Cookie: null,
        'X-Public': 'visible',
      });
      if (scenario.kind !== 'redact') {
        const changes: Record<string, unknown> = {
          preserve: { headers: { authorization: null, 'x-e2e-private': null, 'X-Public': 'visible' } },
          'public-null': { headers: { 'X-Public': null } },
          'unknown-null': { headers: { 'X-New-Secret': null } },
          unmark: { headers: initial.config.headers, secretHeaderNames: [] },
          'invalid-name': { secretHeaderNames: ['invalid header'] },
          'invalid-value': { headers: { Authorization: 123 } },
        };
        const updated = await request.put(`/api/v1/notifications/${initial.id}`, {
          data: {
            name: `${name} edited`,
            config: { url, ...(changes[scenario.kind] as object) },
          },
        });
        expect(updated.status(), await updated.text()).toBe(scenario.kind === 'preserve' ? 200 : 400);
        if (scenario.kind === 'preserve') expect(JSON.stringify(await updated.json())).not.toContain(secret);
      }
      const listed = await request.get('/api/v1/notifications');
      expect(listed.ok()).toBeTruthy();
      const stored = (
        (await listed.json()) as Array<{ id: number; name: string; config: { headers: Record<string, string | null> } }>
      ).find((item) => item.id === initial.id)!;
      expect(stored.name).toBe(scenario.kind === 'preserve' ? `${name} edited` : name);
      expect(JSON.stringify(stored)).not.toContain(secret);
      if (scenario.kind !== 'preserve') expect(stored.config.headers).toEqual(initial.config.headers);
      const sent = await request.post(`/api/v1/notifications/${initial.id}/test`);
      expect(sent.ok(), await sent.text()).toBeTruthy();
    } finally {
      const deleted = await request.delete(`/api/v1/notifications/${initial.id}`);
      expect(deleted.ok()).toBeTruthy();
    }
  });
}
