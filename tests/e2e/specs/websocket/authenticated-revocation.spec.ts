import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { closeWebSocket, openAuthenticatedWebSocket, openWorkspaceSession, requestWorkspace } from '../../support/ws';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';

const headers = { Origin: E2E_URLS.frontendOrigin };

test('password rotation revokes established WebSocket capability and requires new-password authentication', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const { socket } = await openWorkspaceSession(request, connectionId);
	const oldCookie = (await request.storageState()).cookies
		.map((cookie) => `${cookie.name}=${cookie.value}`)
		.join('; ');
	const password = 'E2e-Rotated-WebSocket-2026!';
	let rotated = false;
	try {
		await requestWorkspace(socket, 'workspace.ping');
		const closed = new Promise<number>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Password rotation did not revoke the socket')), 10_000);
			socket.once('close', (code: number) => {
				clearTimeout(timeout);
				resolve(code);
			});
		});
		const changed = await request.put('/api/v1/auth/password', {
			headers,
			data: { currentPassword: E2E_ADMIN.password, newPassword: password },
		});
		expect(changed.ok()).toBeTruthy();
		rotated = true;
		await closed;
		expect(socket.readyState).toBe(3);
		expect((await request.get('/api/v1/auth/status')).status()).toBe(401);
		expect((await request.get('/api/v1/auth/status', { headers: { Cookie: oldCookie } })).status()).toBe(401);
		const login = await request.post('/api/v1/auth/login', {
			headers,
			data: { username: E2E_ADMIN.username, password, rememberMe: false },
		});
		expect(login.ok()).toBeTruthy();
		const { socket: fresh } = await openWorkspaceSession(request, connectionId);
		try {
			await requestWorkspace(fresh, 'workspace.ping');
		} finally {
			await closeWebSocket(fresh);
		}
	} finally {
		await closeWebSocket(socket);
		if (rotated) {
			expect(
				(
					await request.post('/api/v1/auth/login', {
						headers,
						data: { username: E2E_ADMIN.username, password, rememberMe: false },
					})
				).ok(),
			).toBeTruthy();
			expect(
				(
					await request.put('/api/v1/auth/password', {
						headers,
						data: { currentPassword: password, newPassword: E2E_ADMIN.password },
					})
				).ok(),
			).toBeTruthy();
		}
	}
});

test('logout revokes an established Workspace WebSocket and the previous HTTP session', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const { socket } = await openWorkspaceSession(request, connectionId);
	const oldCookie = (await request.storageState()).cookies
		.map((cookie) => `${cookie.name}=${cookie.value}`)
		.join('; ');
	try {
		await requestWorkspace(socket, 'workspace.ping');
		const closed = new Promise<{ code: number }>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Logout did not revoke the established socket')), 10_000);
			socket.once('close', (code: number) => {
				clearTimeout(timeout);
				resolve({ code });
			});
		});
		expect((await request.post('/api/v1/auth/logout', { headers })).ok()).toBeTruthy();
		await closed;
		expect(socket.readyState).toBe(3);
		expect((await request.get('/api/v1/auth/status')).status()).toBe(401);
		expect((await request.get('/api/v1/auth/status', { headers: { Cookie: oldCookie } })).status()).toBe(401);
		await expect(openAuthenticatedWebSocket(request)).rejects.toThrow();
	} finally {
		await closeWebSocket(socket);
	}
});
