import { readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { advanceTestBackendClock } from '../../support/settings';
import { E2E_URLS, E2E_PORTS } from '../../support/test-env';
const {
	openRemoteDesktopWebSocket,
	waitForRemoteDesktopTicketRejection,
	waitForRemoteDesktopUpgradeRejection,
} = require('../../support/remote-desktop-websocket.cjs');

import {
	readConnectionView,
	readConnectionImportResponse,
} from '../../../../packages/shared/src/targets/connections/http-codec';
import { readRemoteDesktopSessionResponse } from '../../../../packages/shared/src/remote/desktop/http-codec';

const headers = { Origin: E2E_URLS.frontendOrigin };
const backendBaseUrl = E2E_URLS.frontendOrigin;

const sessionCookie = async (request: APIRequestContext): Promise<string> => {
	const storage = await request.storageState();
	return storage.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
};

const createRdpConnection = async (request: APIRequestContext, name: string): Promise<number> => {
	const created = await request.post('/api/v1/targets/connections/import', {
		headers,
		data: {
			items: [
				{
					connection: {
						type: 'RDP',
						name,
						host: '127.0.0.1',
						port: E2E_PORTS.rdp,
						username: 'rdp-http-user',
						route: 'direct',
						proxyId: null,
						notes: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: 'b10-pass' },
				},
			],
		},
	});
	expect(created.status()).toBe(200);
	const imported = readConnectionImportResponse(await created.json());
	expect(imported.items).toHaveLength(1);
	const result = imported.items[0];
	if (result.status !== 'ok') throw new Error('RDP fixture import rejected: ' + result.code);
	return result.id;
};

const createSessionTicket = async (request: APIRequestContext, connectionId: number): Promise<string> => {
	const session = await request.post(
		`/api/v1/connections/${connectionId}/rdp-session?width=1600&height=1000&dpi=144`,
		{ headers },
	);
	expect(session.status(), await session.text()).toBe(200);
	const payload = readRemoteDesktopSessionResponse(await session.json());
	expect(payload).toMatchObject({ ticket: expect.any(String) });
	expect(Object.keys(payload)).toEqual(['ticket', 'protocol', 'host', 'port', 'username', 'password']);
	expect(session.headers()['cache-control']).toBe('no-store');
	expect(payload).toMatchObject({ protocol: 'RDP', host: '127.0.0.1', port: E2E_PORTS.rdp, password: 'b10-pass' });
	expect(payload.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
	return payload.ticket;
};

const insertUserWithAdminPassword = (username: string): void => {
	const dataRoot = path.resolve(__dirname, '../../.tmp/backend-data');
	const directories = readdirSync(dataRoot, { withFileTypes: true }).filter(
		(item) => item.isDirectory() && item.name.startsWith('backend-'),
	);
	expect(directories).toHaveLength(1);
	const databasePath = path.join(dataRoot, directories[0].name, 'nexus-terminal.db');
	const script = String.raw`
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    try {
      const source = db.prepare('SELECT password_hash FROM access_accounts WHERE username = ?').get(process.argv[2]);
      if (!source?.password_hash) throw new Error('Seed admin password hash is missing.');
      const now = Math.floor(Date.now() / 1000);
      db.prepare('INSERT INTO access_accounts(username,password_hash,created_at,updated_at) VALUES (?,?,?,?)').run(process.argv[3], source.password_hash, now, now);
    } finally {
      db.close();
    }
  `;
	execFileSync(process.execPath, ['-e', script, databasePath, E2E_ADMIN.username, username], { stdio: 'pipe' });
};

test('RDP sessions use the binary bridge and reject removed RemoteApp fields', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const connectionId = await createRdpConnection(request, 'E2E HTTP RDP');

	const persisted = await request.get(`/api/v1/targets/connections/${connectionId}`);
	expect(persisted.ok()).toBeTruthy();
	expect(readConnectionView(await persisted.json())).toMatchObject({
		id: connectionId,
		type: 'RDP',
	});

	for (const field of ['rdpRemoteApp', 'rdpRemoteAppDirectory', 'rdpRemoteAppArguments']) {
		const latest = readConnectionView(
			await (await request.get('/api/v1/targets/connections/' + connectionId)).json(),
		);
		const rejected = await request.put('/api/v1/targets/connections/' + connectionId, {
			headers,
			data: { version: latest.version, changes: { [field]: 'removed' } },
		});
		expect(rejected.status()).toBe(400);
	}

	const ticket = await createSessionTicket(request, connectionId);
	const cookie = await sessionCookie(request);
	expect(cookie).toBeTruthy();

	const tunnel = (await openRemoteDesktopWebSocket(ticket, cookie)) as {
		firstMessage: string;
		close(): void;
	};
	expect(tunnel.firstMessage).toMatch(/^30/);
	tunnel.close();

	const reused = (await waitForRemoteDesktopTicketRejection(ticket, cookie)) as { code: number; reason: string };
	expect(reused.code).toBe(1008);
	expect(reused.reason).toBe('invalid_input');
});

test('remote desktop ticket is bound to its authenticated user without consuming the owner ticket', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await createRdpConnection(request, 'E2E RDP ticket user binding');
	const ticket = await createSessionTicket(request, connectionId);
	const ownerCookie = await sessionCookie(request);

	const otherUsername = 'e2e-ticket-other-user';
	insertUserWithAdminPassword(otherUsername);
	const otherRequest = await playwrightRequest.newContext({ baseURL: backendBaseUrl });
	try {
		const login = await otherRequest.post('/api/v1/auth/login', {
			headers,
			data: { username: otherUsername, password: E2E_ADMIN.password, rememberMe: false },
		});
		expect(login.ok(), await login.text()).toBeTruthy();
		const otherCookie = await sessionCookie(otherRequest);
		expect(otherCookie).toBeTruthy();

		const rejected = (await waitForRemoteDesktopUpgradeRejection(ticket, otherCookie)) as { statusCode: number };
		expect(rejected.statusCode).toBe(401);

		await loginAsInitialAdmin(otherRequest);
		const anotherAdminSession = await sessionCookie(otherRequest);
		const wrongSession = await waitForRemoteDesktopTicketRejection(ticket, anotherAdminSession);
		expect(wrongSession).toEqual({ code: 1008, reason: 'invalid_input' });

		const ownerTunnel = (await openRemoteDesktopWebSocket(ticket, ownerCookie)) as {
			firstMessage: string;
			close(): void;
		};
		expect(ownerTunnel.firstMessage).toMatch(/^30/);
		ownerTunnel.close();
	} finally {
		await otherRequest.dispose();
	}
});

test('expired, unknown, and oversized remote desktop tickets are rejected', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const cookie = await sessionCookie(request);

	const unknown = (await waitForRemoteDesktopTicketRejection(randomBytes(32).toString('base64url'), cookie)) as {
		code: number;
		reason: string;
	};
	expect(unknown.code).toBe(1008);
	expect(unknown.reason).toBe('invalid_input');

	const oversized = (await waitForRemoteDesktopUpgradeRejection('x'.repeat(257), cookie)) as { statusCode: number };
	expect(oversized.statusCode).toBe(401);

	const connectionId = await createRdpConnection(request, 'E2E RDP expired ticket');
	const expiringTicket = await createSessionTicket(request, connectionId);
	await advanceTestBackendClock(31_000);
	const expired = (await waitForRemoteDesktopTicketRejection(expiringTicket, cookie)) as {
		code: number;
		reason: string;
	};
	expect(expired.code).toBe(1008);
	expect(expired.reason).toBe('invalid_input');
});
