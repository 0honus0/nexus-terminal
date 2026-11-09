import { test as baseTest, expect } from 'vitest';
import { request as http } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openManagement } from './management-fixture.mjs';
import { openWorkspaceSession, openAuthenticatedWebSocket, closeWebSocket } from '../protocols/workspace-client.ts';

export { expect };

export const HTTP_TEST_ORIGIN = 'http://127.0.0.1:0';

export const HTTP_TEST_ADMIN = { username: 'admin', password: 'isolated-management-b10-password-123' };

export async function useHttpProtocol(use, transport = undefined) {
	const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'http-protocol-'));
	const started = performance.now();
	// APIRequestContext owns authentication in these tests. Logging in the
	// management client's unused cookie jar creates an unrelated session and
	// repeats password verification before the scenario's actual login.
	const application = await openManagement(directory, {}, transport, { authenticated: false });
	const timing = { setupMs: null, executeMs: null, drainMs: null };
	const contexts = new Set();
	const sockets = new Set();
	let executing;

	async function createContext() {
		const context = await http.newContext({
			baseURL: 'http://' + application.address,
			extraHTTPHeaders: { Host: new URL(application.origin).host, Origin: application.origin },
		});
		contexts.add(context);
		return context;
	}

	try {
		const primary = await createContext();
		timing.setupMs = performance.now() - started;
		executing = performance.now();
		await use({
			primary,
			dataDirectory: directory,
			createContext,

			url: (path) => new URL(path, 'http://' + application.address),

			headers: { Host: new URL(application.origin).host, Origin: application.origin },

			openWorkspace: async (connectionId, workspaceId) => {
				const workspace = await openWorkspaceSession(primary, connectionId, workspaceId, {
					url: 'ws://' + application.address + '/ws/workspace',
					origin: application.origin,
				});
				sockets.add(workspace.socket);
				return workspace;
			},

			openSocket: async (path = '/ws/workspace') => {
				const socket = await openAuthenticatedWebSocket(
					primary,
					'ws://' + application.address + path,
					application.origin,
				);
				sockets.add(socket);
				return socket;
			},
		});
	} finally {
		if (executing !== undefined) timing.executeMs = performance.now() - executing;
		else timing.setupMs = performance.now() - started;
		const draining = performance.now();
		const socketResults = await Promise.allSettled([...sockets].map((socket) => closeWebSocket(socket)));
		const results = [
			...socketResults,
			...(await Promise.allSettled([...contexts].map((context) => context.dispose()))),
		];
		const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
		try {
			await application.close();
		} catch (error) {
			failures.push(error);
		}
		timing.drainMs = performance.now() - draining;
		try {
			await writeFile(join(directory, 'timings.json'), JSON.stringify(timing, null, 2));
		} catch (error) {
			failures.push(error);
		}
		if (failures.length) throw new AggregateError(failures, 'HTTP protocol fixture close failed');
	}
}

export const test = baseTest.extend({
	httpClients: async ({}, use) => {
		await useHttpProtocol(use);
	},

	request: async ({ httpClients }, use) => {
		await use(httpClients.primary);
	},
});

export async function loginAsAdmin(request) {
	const response = await request.post('/api/v1/auth/login', {
		data: { username: HTTP_TEST_ADMIN.username, password: HTTP_TEST_ADMIN.password, rememberMe: false },
	});
	expect(response.status()).toBe(200);
}
