import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { E2E_URLS } from './test-env';

export async function requestAgentJson<T>(
	request: APIRequestContext,
	command: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; data?: unknown; status?: number },
	decode: (value: unknown) => T,
): Promise<T> {
	const response = await request.fetch('/api/v1/agent' + command.path, {
		method: command.method,
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: command.data,
	});
	expect(response.status(), command.method + ' ' + command.path).toBe(command.status ?? 200);
	return decode(await response.json());
}
