// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, test, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { auditApi } from '../../../../packages/frontend/src/features/audit/public.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('audit refuses the former free-details page instead of accepting it as an empty result', async () => {
	server.use(
		http.get('http://localhost/api/v1/settings/audit-logs', () =>
			HttpResponse.json({ logs: [], total: 0, offset: 0, limit: 5 }),
		),
	);
	await expect(auditApi.list({ limit: 5 })).rejects.toMatchObject({ code: 'protocol_failure' });
});
