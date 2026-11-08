import { HTTP_TEST_ADMIN } from '../../../../support/http/protocol-fixture.mjs';
import { expect, test, HTTP_TEST_ORIGIN } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { closeWebSocket, requestWorkspace } from '../../../../support/protocols/workspace-client';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';

const headers = { Origin: HTTP_TEST_ORIGIN };

test('password rotation revokes established WebSocket capability and requires new-password authentication', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const { socket } = await httpClients.openWorkspace(connectionId);
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
			data: { currentPassword: HTTP_TEST_ADMIN.password, newPassword: password },
		});
		expect(changed.ok()).toBeTruthy();
		rotated = true;
		await closed;
		expect(socket.readyState).toBe(3);
		expect((await request.get('/api/v1/auth/status')).status()).toBe(401);
		expect((await request.get('/api/v1/auth/status', { headers: { Cookie: oldCookie } })).status()).toBe(401);
		const login = await request.post('/api/v1/auth/login', {
			headers,
			data: { username: HTTP_TEST_ADMIN.username, password, rememberMe: false },
		});
		expect(login.ok()).toBeTruthy();
		const { socket: fresh } = await httpClients.openWorkspace(connectionId);
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
						data: { username: HTTP_TEST_ADMIN.username, password, rememberMe: false },
					})
				).ok(),
			).toBeTruthy();
			expect(
				(
					await request.put('/api/v1/auth/password', {
						headers,
						data: { currentPassword: password, newPassword: HTTP_TEST_ADMIN.password },
					})
				).ok(),
			).toBeTruthy();
		}
	}
});

test('logout revokes an established Workspace WebSocket and the previous HTTP session', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const { socket } = await httpClients.openWorkspace(connectionId);
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
		await expect(httpClients.openSocket()).rejects.toThrow();
	} finally {
		await closeWebSocket(socket);
	}
});
