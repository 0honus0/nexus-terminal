// @vitest-environment jsdom
import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { notificationsApi } from '../../../../packages/frontend/src/features/notifications/api/notifications-api.ts';
import { OperationsRequestFailure } from '../../../../packages/frontend/src/client/operations/operations-request.ts';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('bare notification arrays are protocol errors without a legacy compatibility path', async () => {
	server.use(http.get('http://localhost/api/v1/settings/notifications', () => HttpResponse.json([])));
	await expect(notificationsApi.list()).rejects.toBeInstanceOf(OperationsRequestFailure);
	await expect(notificationsApi.list()).rejects.toMatchObject({ code: 'protocol_failure' });
});
