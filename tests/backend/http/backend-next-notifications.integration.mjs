import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from './management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
import {
	readNotificationResponse,
	readNotificationDeliveries,
} from '../../../packages/shared/dist/operations/http-codec.js';

await test(
	'B10 actual notification HTTP, Telegram and SMTP delivery with durable outcomes',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-notification-'));
		const calls = [];
		const sockets = new Set();
		const mail = [];
		const smtpCommands = [];
		const server = createServer(async (req, response) => {
			const chunks = [];
			for await (const chunk of req) {
				chunks.push(chunk);
			}
			calls.push({
				path: req.url,
				method: req.method,
				headers: req.headers,
				body: Buffer.concat(chunks).toString('utf8'),
				response,
			});
			if (req.url === '/drop') {
				response.destroy();
				return;
			}
			if (req.url === '/hold') {
				return;
			}
			response.writeHead(req.url === '/reject' ? 500 : req.url === '/redirect' ? 302 : 200, {
				'Content-Type': 'application/json',
				Location: '/must-not-follow',
			});
			response.end('{"ok":true}');
		});
		const smtp = createTcpServer((socket) => {
			sockets.add(socket);
			socket.on('close', () => sockets.delete(socket));
			socket.on('error', () => {});
			let pending = '',
				content = null;
			socket.write('220 isolated ESMTP\r\n');
			socket.on('data', (bytes) => {
				pending += bytes.toString('utf8');
				while (pending.includes('\r\n')) {
					const end = pending.indexOf('\r\n');
					const line = pending.slice(0, end);
					pending = pending.slice(end + 2);
					if (content === null) {
						smtpCommands.push(line);
					}
					if (content !== null) {
						if (line === '.') {
							mail.push(content);
							content = null;
							socket.write('250 accepted\r\n');
						} else {
							content += line + '\r\n';
						}
					} else if (line.startsWith('EHLO')) {
						socket.write('250 isolated\r\n');
					} else if (/^RCPT TO:<deny@/iu.test(line)) {
						socket.write('550 recipient rejected\r\n');
					} else if (line === 'DATA') {
						content = '';
						socket.write('354 send message\r\n');
					} else if (line === 'QUIT') {
						socket.end('221 goodbye\r\n');
					} else if (/^(MAIL FROM:|RCPT TO:|RSET$|NOOP$)/iu.test(line)) {
						socket.write('250 ok\r\n');
					} else {
						socket.write('500 unexpected command\r\n');
					}
				}
			});
		});
		let f;
		let saved;
		let held;
		const base = '/api/v1/settings/notifications';
		const deliveries = '/api/v1/settings/notification-deliveries';
		let url;

		const webhook = (path = '/ok', headers = []) => ({
			kind: 'webhook',
			url: url + path,
			method: 'POST',
			headers,
			bodyTemplate: null,
		});

		const config = (value) => ({
			name: 'isolated notification',
			enabled: false,
			events: ['LOGIN_SUCCESS'],
			config: value,
		});

		const input = () =>
			config(
				webhook('/ok', [
					{ name: 'X-Isolated-Secret', value: { action: 'replace', value: 'notification-private-secret' } },
				]),
			);

		const list = async () =>
			readNotificationDeliveries(expectStatus(await f.api('GET', deliveries + '?limit=200'), 200)).items;

		const outcome = (id, status) =>
			until(
				async () => (await list()).find((row) => row.id === id),
				(row) => row?.status === status,
				'notification ' + status,
			);

		const submit = async (value) =>
			expectStatus(await f.api('POST', base + '/test-unsaved', { config: value }), 200).delivery;

		try {
			server.listen(0, '127.0.0.1');
			smtp.listen(0, '127.0.0.1');
			await Promise.all([once(server, 'listening'), once(smtp, 'listening')]);
			url = 'http://127.0.0.1:' + server.address().port;
			f = await openManagement(directory);
			await t.test('anonymous configuration and test admission are denied without dispatch', async () => {
				expectStatus(await f.anonymous('GET', base), 401);
				expectStatus(await f.anonymous('POST', base + '/test-unsaved', { config: webhook() }), 401);
				assert.equal(calls.length, 0);
			});
			await t.test('create stores secrets but only existence flags cross the response', async () => {
				saved = readNotificationResponse(expectStatus(await f.api('POST', base, input()), 200)).setting;
				assert.equal(saved.version, 1);
				assert.deepEqual(saved.config.headers, [{ name: 'X-Isolated-Secret', hasValue: true }]);
				assert.equal(JSON.stringify(saved).includes('notification-private-secret'), false);
			});
			await t.test(
				'saved test has a durable sent outcome and actually uses decrypted secret and JSON template',
				async () => {
					const delivery = expectStatus(
						await f.api('POST', base + '/' + saved.id + '/test', {}),
						200,
					).delivery;
					await outcome(delivery.id, 'sent');
					assert.equal(calls.length, 1);
					assert.equal(calls[0].headers['x-isolated-secret'], 'notification-private-secret');
					assert.equal(JSON.parse(calls[0].body).event, 'SETTINGS_UPDATED');
					assert.ok(Number.isFinite(Date.parse(JSON.parse(calls[0].body).time)));
				},
			);
			await t.test('stale update and stale delete preserve saved configuration', async () => {
				expectStatus(await f.api('PUT', base + '/' + saved.id, { ...input(), expectedVersion: 999 }), 409);
				expectStatus(await f.api('DELETE', base + '/' + saved.id, { expectedVersion: 999 }), 409);
				assert.deepEqual(expectStatus(await f.api('GET', base), 200).items, [saved]);
			});
			await t.test('keep resolves original header case insensitively and survives real restart', async () => {
				saved = expectStatus(
					await f.api('PUT', base + '/' + saved.id, {
						...config(webhook('/ok', [{ name: 'x-isolated-secret', value: { action: 'keep' } }])),
						expectedVersion: saved.version,
					}),
					200,
				).setting;
				await f.restart();
				const delivery = expectStatus(await f.api('POST', base + '/' + saved.id + '/test', {}), 200).delivery;
				await outcome(delivery.id, 'sent');
				assert.equal(calls.length, 2);
				assert.equal(calls[1].headers['x-isolated-secret'], 'notification-private-secret');
			});
			await t.test('clear removes the real outgoing header', async () => {
				saved = expectStatus(
					await f.api('PUT', base + '/' + saved.id, {
						...config(webhook('/ok', [{ name: 'x-isolated-secret', value: { action: 'clear' } }])),
						expectedVersion: saved.version,
					}),
					200,
				).setting;
				assert.equal(saved.config.headers[0].hasValue, false);
				const delivery = expectStatus(await f.api('POST', base + '/' + saved.id + '/test', {}), 200).delivery;
				await outcome(delivery.id, 'sent');
				assert.equal(calls.at(-1).headers['x-isolated-secret'], undefined);
			});
			await t.test('unsaved templated PUT delivers without adding a setting', async () => {
				const delivery = await submit({
					...webhook(),
					method: 'PUT',
					bodyTemplate: 'event={event}|subject={subjectId}|time={time}',
				});
				await outcome(delivery.id, 'sent');
				assert.equal(delivery.settingId, null);
				assert.equal(calls.at(-1).method, 'PUT');
				assert.match(calls.at(-1).body, /^event=SETTINGS_UPDATED\|subject=\|time=\d{4}-/u);
				assert.equal(expectStatus(await f.api('GET', base), 200).items.length, 1);
			});
			await t.test('GET webhook omits a request body even with template text', async () => {
				await outcome(
					(await submit({ ...webhook(), method: 'GET', bodyTemplate: 'not a GET body' })).id,
					'sent',
				);
				assert.equal(calls.at(-1).method, 'GET');
				assert.equal(calls.at(-1).body, '');
			});
			await t.test('non-success response is failed and redirection is never followed', async () => {
				await outcome((await submit(webhook('/reject'))).id, 'failed');
				await outcome((await submit(webhook('/redirect'))).id, 'unknown');
				assert.equal(
					calls.some((call) => call.path === '/must-not-follow'),
					false,
				);
			});
			await t.test('socket loss after dispatch is unknown, no automatic replay', async () => {
				const before = calls.filter((call) => call.path === '/drop').length;
				await outcome((await submit(webhook('/drop'))).id, 'unknown');
				assert.equal(calls.filter((call) => call.path === '/drop').length, before + 1);
			});
			await t.test('Telegram sends actual encoded token URL and chat JSON', async () => {
				const delivery = await submit({
					kind: 'telegram',
					origin: url,
					chatId: 'isolated-chat',
					botToken: { action: 'replace', value: '123:isolated_token' },
					bodyTemplate: 'telegram {event}',
				});
				await outcome(delivery.id, 'sent');
				assert.equal(calls.at(-1).path, '/bot123%3Aisolated_token/sendMessage');
				assert.deepEqual(JSON.parse(calls.at(-1).body), {
					chat_id: 'isolated-chat',
					text: 'telegram SETTINGS_UPDATED',
				});
			});
			await t.test('missing Telegram token fails before HTTP dispatch', async () => {
				const before = calls.length;
				await outcome(
					(
						await submit({
							kind: 'telegram',
							origin: url,
							chatId: 'isolated-chat',
							botToken: { action: 'clear' },
							bodyTemplate: null,
						})
					).id,
					'failed',
				);
				assert.equal(calls.length, before);
			});
			await t.test('SMTP performs real envelope and DATA delivery with pure-text MIME', async () => {
				await outcome(
					(
						await submit({
							kind: 'email',
							to: 'to@example.invalid',
							from: 'from@example.invalid',
							host: '127.0.0.1',
							port: smtp.address().port,
							secure: false,
							username: '',
							password: { action: 'clear' },
							bodyTemplate: 'SMTP {event}',
						})
					).id,
					'sent',
				);
				assert.equal(mail.length, 1);
				assert.ok(smtpCommands.includes('MAIL FROM:<from@example.invalid>'));
				assert.ok(smtpCommands.includes('RCPT TO:<to@example.invalid>'));
				assert.match(mail[0], /Content-Type: text\/plain/u);
				assert.match(mail[0], /Subject: SETTINGS_UPDATED/u);
				assert.match(mail[0], /SMTP SETTINGS_UPDATED/u);
			});
			await t.test('SMTP all recipients rejected is a definite failure without DATA delivery', async () => {
				await outcome(
					(
						await submit({
							kind: 'email',
							to: 'deny@example.invalid',
							from: 'from@example.invalid',
							host: '127.0.0.1',
							port: smtp.address().port,
							secure: false,
							username: '',
							password: { action: 'clear' },
							bodyTemplate: 'must not deliver',
						})
					).id,
					'failed',
				);
				assert.equal(mail.length, 1);
			});
			await t.test(
				'SMTP partial recipient rejection keeps unknown and never retries accepted recipients',
				async () => {
					await outcome(
						(
							await submit({
								kind: 'email',
								to: 'to@example.invalid, deny@example.invalid',
								from: 'from@example.invalid',
								host: '127.0.0.1',
								port: smtp.address().port,
								secure: false,
								username: '',
								password: { action: 'clear' },
								bodyTemplate: 'partial recipient delivery',
							})
						).id,
						'unknown',
					);
					assert.equal(mail.length, 2);
					assert.match(mail[1], /partial recipient delivery/u);
				},
			);
			await t.test('strict malformed config and extra query reject without enqueueing', async () => {
				const before = (await list()).length;
				for (const value of [
					{ ...webhook(), url: 'file:///tmp/a' },
					{ ...webhook(), url: url + '#fragment' },
					{
						...webhook(),
						headers: [{ name: 'X-Test', value: { action: 'replace', value: 'bad\r\nheader' } }],
					},
				]) {
					expectStatus(await f.api('POST', base + '/test-unsaved', { config: value }), 400);
				}
				expectStatus(await f.api('GET', base + '?unexpected=1'), 400);
				expectStatus(await f.api('GET', deliveries + '?event=LOGIN_SUCCESS'), 400);
				assert.equal((await list()).length, before);
			});
			await t.test('real Access login audit fans out once to an enabled matching subscriber', async () => {
				saved = expectStatus(
					await f.api('PUT', base + '/' + saved.id, {
						...config(webhook('/audit')),
						enabled: true,
						expectedVersion: saved.version,
					}),
					200,
				).setting;
				expectStatus(
					await f.anonymous('POST', '/api/v1/auth/login', {
						username: 'admin',
						password: f.password,
						rememberMe: false,
					}),
					200,
				);
				await until(
					async () =>
						(await list()).filter((row) => row.settingId === saved.id && row.event === 'LOGIN_SUCCESS'),
					(rows) => rows.length === 1 && rows[0].status === 'sent',
					'login event fanout',
				);
				assert.equal(calls.filter((call) => call.path === '/audit').length, 1);
			});
			await t.test('disabled subscription prevents subsequent login fanout', async () => {
				saved = expectStatus(
					await f.api('PUT', base + '/' + saved.id, {
						...config(webhook('/audit')),
						expectedVersion: saved.version,
					}),
					200,
				).setting;
				expectStatus(
					await f.anonymous('POST', '/api/v1/auth/login', {
						username: 'admin',
						password: f.password,
						rememberMe: false,
					}),
					200,
				);
				// Draining shutdown and reinitialization close the actual event-owner boundary.
				await f.restart();
				assert.equal(calls.filter((call) => call.path === '/audit').length, 1);
				assert.equal((await list()).filter((row) => row.event === 'LOGIN_SUCCESS').length, 1);
			});
			await t.test('pagination preserves separate durable outcomes', async () => {
				const full = await list();
				const first = readNotificationDeliveries(
					expectStatus(await f.api('GET', deliveries + '?limit=2'), 200),
				);
				assert.equal(first.nextOffset, 2);
				const rest = readNotificationDeliveries(
					expectStatus(await f.api('GET', deliveries + '?offset=2&limit=200'), 200),
				);
				assert.deepEqual([...first.items, ...rest.items], full);
				assert.equal(new Set(full.map((row) => row.id)).size, full.length);
			});
			await t.test('delete removes setting; missing saved test is not found', async () => {
				expectStatus(await f.api('DELETE', base + '/' + saved.id, { expectedVersion: saved.version }), 200);
				expectStatus(await f.api('POST', base + '/' + saved.id + '/test', {}), 404);
				assert.deepEqual(expectStatus(await f.api('GET', base), 200).items, []);
			});
			await t.test(
				'shutdown aborts an already dispatched HTTP task; restart keeps unknown without replay',
				async () => {
					held = await submit(webhook('/hold'));
					await until(
						async () => calls.filter((call) => call.path === '/hold').length,
						(count) => count === 1,
						'held delivery actually dispatched',
					);
					await f.restart();
					await outcome(held.id, 'unknown');
					assert.equal(calls.filter((call) => call.path === '/hold').length, 1);
				},
			);
		} finally {
			try {
				await f?.close();
			} finally {
				server.closeAllConnections();
				for (const socket of sockets) {
					socket.destroy();
				}
				await Promise.all([
					new Promise((resolve) => server.close(resolve)),
					new Promise((resolve) => smtp.close(resolve)),
				]);
			}
			await rm(directory, { recursive: true, force: true });
		}
	},
);
