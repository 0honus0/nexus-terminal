import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

test('quick command CRUD and audit logs remain functional', async ({ request }) => {
  await loginAsInitialAdmin(request);

  let commandId: number;
  await step('create a quick command with variables', async () => {
    const response = await request.post('/api/v1/quick-commands', {
      data: {
        name: 'E2E Quick Command',
        command: 'echo ${TARGET}',
        tagIds: [],
        variables: { TARGET: { default: 'nexus-e2e' } },
      },
    });
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { command: { id: number; name: string; command: string } };
    commandId = body.command.id;
    expect(body.command).toMatchObject({ name: 'E2E Quick Command', command: 'echo ${TARGET}' });
  });

  await step('update and increment quick command usage', async () => {
    const update = await request.put(`/api/v1/quick-commands/${commandId!}`, {
      data: {
        name: 'E2E Quick Command Updated',
        command: 'printf "%s\\n" "${TARGET}"',
        tagIds: [],
        variables: { TARGET: { default: 'updated' } },
      },
    });
    expect(update.ok()).toBeTruthy();

    const usage = await request.post(`/api/v1/quick-commands/${commandId!}/increment-usage`);
    expect(usage.ok()).toBeTruthy();

    const list = await request.get('/api/v1/quick-commands?sortBy=usageCount');
    expect(list.ok()).toBeTruthy();
    const saved = ((await list.json()) as Array<{ id: number; name: string; usageCount?: number }>).find(
      (item) => item.id === commandId,
    );
    expect(saved).toMatchObject({ name: 'E2E Quick Command Updated' });
    expect(Number(saved?.usageCount)).toBeGreaterThanOrEqual(1);
  });

  await step('delete the quick command', async () => {
    const response = await request.delete(`/api/v1/quick-commands/${commandId!}`);
    expect(response.ok()).toBeTruthy();
    const list = await request.get('/api/v1/quick-commands');
    expect(((await list.json()) as Array<{ id: number }>).some((item) => item.id === commandId)).toBeFalsy();
  });

  await step('audit log records security and connection activity', async () => {
    const response = await request.get('/api/v1/audit-logs?limit=100&offset=0');
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      logs: Array<{ actionType?: string; details?: Record<string, unknown> }>;
      total: number;
    };
    expect(body.total).toBeGreaterThan(0);
    const login = body.logs.find((log) => log.actionType === 'LOGIN_SUCCESS');
    expect(login).toBeTruthy();
    expect(login?.details).toMatchObject({ username: 'e2e-admin' });
  });
});
