import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { SqliteRuntime } from '../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteMachineMutationStorage } from '../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-mutation-recovery-'));
const dbPath = join(directory, 'app.db');
const encryptionKey = randomBytes(32);
const checks = [];
let app;
let db;
let vite;
let browser;
try {
	// Seed real durable claims through the production Adapter, then restart the real owner.
	// This is a persistence/HTTP/browser fixture, not evidence of any real remote process stopping.
	app = await createApp(dbPath, { encryptionKey });
	await app.close();
	app = null;
	db = SqliteRuntime.open(dbPath);
	const storage = new SqliteMachineMutationStorage(db);
	for (let index = 1; index <= 22; index++) {
		const id = 'fixture-' + String(index).padStart(2, '0');
		const key = createHash('sha256').update(id).digest('hex');
		assert.equal(
			await storage.acquire(
				{
					id,
					keys: [key],
					ownerId: randomUUID(),
					origin: index % 2 ? 'agent' : 'files',
					targets: [{ targetId: index, fingerprint: key }],
					now: Date.now() - 10000,
				},
				64,
				100,
			),
			'acquired',
		);
		await storage.settle(id, [key], true, Date.now() - 5000);
	}
	await db.close();
	db = null;
	app = await createApp(dbPath, { encryptionKey });
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve) => net.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	const address = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});

	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: { '/api': { target: 'http://' + address, changeOrigin: false } },
		},
	});
	await vite.listen();
	const anonymous = await fetch(origin + '/api/v1/remote/mutations');
	assert.equal(anonymous.status, 401, await anonymous.text());
	checks.push('real unauthenticated HTTP access is refused');
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	page.setDefaultTimeout(15000);
	await page.goto(origin + '/login');
	await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const api = createAccessApi();
		await api.setup({
			username: 'admin',
			password: 'Mutation-fixture-2026!',
			confirmPassword: 'Mutation-fixture-2026!',
		});
		await api.login({ username: 'admin', password: 'Mutation-fixture-2026!', rememberMe: false });
	});
	await page.reload();
	await page.locator('.app-header a.nav-link[href="/"]').waitFor();
	checks.push(
		...(await page.evaluate(async () => {
			const { mutationApi } = await import('/src/features/mutation-recovery/api/mutation-api.ts');
			const { useMutationRecoveryStore } =
				await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
			const { MutationRequestFailure } = await import('/src/features/mutation-recovery/model/mutation-types.ts');
			const store = useMutationRecoveryStore();
			const permission = new AbortController().signal;
			const checks = [];

			function ensure(value, message) {
				if (!value) {
					throw Error(message);
				}
			}

			async function refuses(work, code, outcome) {
				try {
					await work();
				} catch (cause) {
					ensure(
						cause instanceof MutationRequestFailure && cause.code === code && cause.outcome === outcome,
						'Unexpected failure ' + cause.code + '/' + cause.outcome,
					);
					return;
				}
				throw Error('Expected ' + code);
			}

			await store.load(permission);
			ensure(store.items.length === 20 && store.nextCursor === 'fixture-20', 'First real page/cursor');
			await store.load(permission, false, true);
			ensure(store.items.length === 22 && store.nextCursor === null, 'Second real page');
			checks.push('real two-page list uses server cursor, independently mapped claims and unique IDs');
			await store.select('fixture-01', permission);
			const original = store.selected;
			ensure(original.recoveryAllowed && original.revision === 2, 'Restart permits human recovery');
			const input = {
				expectedRevision: original.revision,
				outcome: 'partially_applied',
				producerStopped: true,
				resourcesStopped: true,
				observedAt: Date.now(),
				note: 'Fixture evidence: no remote operation was executed.',
			};
			await refuses(
				() => mutationApi.evidence(original, { ...input, producerStopped: false }),
				'invalid_input',
				'not_dispatched',
			);
			const aborted = new AbortController();
			aborted.abort();
			await refuses(() => store.evidence(original, input, aborted.signal), 'cancelled', 'not_dispatched');
			await store.evidence(original, input, permission);
			ensure(
				store.selected.revision === 3 &&
					store.selected.evidence.length === 1 &&
					store.selected.state === 'blocked',
				'Evidence does not release',
			);
			await store.release(store.selected, store.selected.evidence[0].id, permission);
			ensure(
				store.selected.revision === 4 && store.selected.state === 'released' && !store.selected.recoveryAllowed,
				'Independent release',
			);
			checks.push(
				'real evidence and separate release persist original revision/CAS; incomplete confirmation and revoked intent never dispatch',
			);
			await store.select('fixture-02', permission);
			const stale = store.selected;
			const nextInput = { ...input, expectedRevision: stale.revision, observedAt: Date.now() };
			await mutationApi.evidence(stale, nextInput, permission);
			await refuses(() => store.evidence(stale, nextInput, permission), 'version_conflict', 'confirmed');
			ensure(
				store.blocked && store.selected.revision === stale.revision,
				'Conflict retains original application snapshot',
			);
			await refuses(() => store.evidence(stale, nextInput, permission), 'refresh_required', 'not_dispatched');
			await store.load(permission, true);
			ensure(!store.blocked && store.selected.revision === 3, 'Explicit recovery reads detail');
			checks.push(
				'concurrent real CAS conflict blocks further writes until explicit list/detail read recovery, without version substitution',
			);
			return checks;
		})),
	);

	// A real commit followed by response loss must not be reissued on view re-entry.
	let posts = 0;

	const lost = async (route) => {
		if (route.request().method() !== 'POST') {
			return route.continue();
		}
		posts++;
		const response = await route.fetch();
		assert.equal(response.status(), 200);
		await route.abort('failed');
	};

	await page.route('**/api/v1/remote/mutations/fixture-03/evidence', lost);
	try {
		const result = await page.evaluate(async () => {
			const { useMutationRecoveryStore } =
				await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
			const store = useMutationRecoveryStore();
			const signal = new AbortController().signal;
			await store.select('fixture-03', signal);
			const original = store.selected;
			const input = {
				expectedRevision: original.revision,
				outcome: 'not_applied',
				producerStopped: true,
				resourcesStopped: true,
				observedAt: Date.now(),
				note: 'Actual response-loss fixture, independently recorded.',
			};
			let unknown;
			try {
				await store.evidence(original, input, signal);
			} catch (cause) {
				unknown = cause.outcome;
			}
			let retry;
			try {
				await store.evidence(original, input, signal);
			} catch (cause) {
				retry = cause.code;
			}
			return { unknown, retry, blocked: store.blocked, revision: store.selected.revision };
		});
		assert.deepEqual(result, { unknown: 'unknown', retry: 'refresh_required', blocked: true, revision: 2 });
		assert.equal(posts, 1);
	} finally {
		await page.unroute('**/api/v1/remote/mutations/fixture-03/evidence', lost);
	}
	await page.evaluate(async () => {
		const { useMutationRecoveryStore } =
			await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
		const store = useMutationRecoveryStore();
		await store.load(new AbortController().signal, true);
		if (store.selected.revision !== 3 || store.selected.evidence.length !== 1 || store.blocked) {
			throw Error('Read-only recovery must reveal the single real commit');
		}
	});
	checks.push(
		'real committed evidence with a lost response stays unknown, blocks a second POST and recovers only by reading the single durable result',
	);

	await page.evaluate(async () => {
		const { setLocale } = await import('/src/app/i18n/index.ts');
		setLocale('en-US');
	});
	await page.goto(origin + '/settings');
	await page.getByRole('tab', { name: /Data/i }).click();
	await page.getByText('Diagnostics and recovery (advanced)', { exact: true }).click();
	const panel = page.locator('[data-mutation-recovery]');
	await panel.getByRole('button', { name: /^fixture-04/ }).click();
	await panel.locator('[data-mutation-detail]').waitFor();
	assert.equal(await panel.getByRole('checkbox', { checked: true }).count(), 0);
	const outcomeSelect = panel.locator('#mutation-outcome');
	assert.equal(await outcomeSelect.getAttribute('data-value'), '');
	await panel.getByRole('button', { name: 'Record evidence', exact: true }).click();
	await panel.getByRole('alert').filter({ hasText: 'Confirm both resources' }).waitFor();
	await panel.getByRole('checkbox', { name: 'I have independently verified the producer has stopped' }).check();
	await panel
		.getByRole('checkbox', { name: 'I have independently verified the related resources have stopped' })
		.check();
	await outcomeSelect.click();
	await page.getByRole('option', { name: 'Partially applied', exact: true }).click();
	const observed = new Date(Date.now() - 2000);
	const local = new Date(observed.getTime() - observed.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
	await panel.getByLabel('Observation time', { exact: true }).fill(local);
	await panel
		.getByLabel('Evidence note', { exact: true })
		.fill('Formal panel: fixture resources are stopped; no remote effect was executed.');
	await panel.getByRole('button', { name: 'Record evidence', exact: true }).click();
	await page.waitForFunction(
		async () => (await (await fetch('/api/v1/remote/mutations/fixture-04')).json()).revision === 3,
	);
	const evidenceSelect = panel.locator('#mutation-evidence');
	await evidenceSelect.click();
	const evidenceOption = page.getByRole('option').first();
	await evidenceOption.waitFor();
	assert.equal(await evidenceSelect.getAttribute('data-value'), '');
	await evidenceOption.click();
	await panel.getByRole('button', { name: 'Release execution fence', exact: true }).click();
	const dialog = page.getByRole('dialog').filter({ hasText: 'Release this execution fence' });
	await dialog.waitFor();
	await dialog.getByRole('button', { name: /Confirm/i }).click();
	await page.waitForFunction(
		async () => (await (await fetch('/api/v1/remote/mutations/fixture-04')).json()).state === 'released',
	);
	checks.push(
		'formal Settings panel requires two manual confirmations, explicit outcome/time/note, fresh evidence selection and independent release confirmation',
	);

	for (const [locale, heading] of [
		['zh-CN', '机器突变恢复'],
		['ja-JP', 'マシン変更の復旧'],
		['en-US', 'Machine mutation recovery'],
	]) {
		await page.evaluate(async (locale) => {
			const { setLocale } = await import('/src/app/i18n/index.ts');
			setLocale(locale);
		}, locale);
		await panel.getByRole('heading', { name: heading, exact: true }).waitFor();
		assert.equal((await panel.innerText()).includes('mutationRecovery.'), false);
	}
	checks.push(
		'formal three-language panel renders resolved headings and protocol states without missing translation keys',
	);

	const malformed = async (route) => {
		const response = await route.fetch();
		const value = await response.json();
		value.items[0].privateSecret = 'DO_NOT_RENDER';
		await route.fulfill({ response, json: value });
	};

	await page.route('**/api/v1/remote/mutations?*', malformed);
	try {
		const result = await page.evaluate(async () => {
			const { useMutationRecoveryStore } =
				await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
			const store = useMutationRecoveryStore();
			const count = store.items.length;
			let code;
			try {
				await store.load(new AbortController().signal, true);
			} catch (cause) {
				code = cause.code;
			}
			return { code, blocked: store.blocked, unchanged: store.items.length === count };
		});
		assert.deepEqual(result, { code: 'protocol_failure', blocked: true, unchanged: true });
		assert.equal((await panel.innerText()).includes('DO_NOT_RENDER'), false);
	} finally {
		await page.unroute('**/api/v1/remote/mutations?*', malformed);
	}
	checks.push(
		'malformed success containing private extra fields is rejected before application publication and does not clear the write fence',
	);

	// An unrelated detail is never accepted solely because its fields decode.
	const unrelated = async (route) => {
		const response = await route.fetch();
		const value = await response.json();
		value.id = 'fixture-06';
		await route.fulfill({ response, json: value });
	};

	await page.route('**/api/v1/remote/mutations/fixture-05', unrelated);
	try {
		assert.equal(
			await page.evaluate(async () => {
				const { mutationApi } = await import('/src/features/mutation-recovery/api/mutation-api.ts');
				try {
					await mutationApi.get('fixture-05');
				} catch (cause) {
					return cause.code;
				}
			}),
			'protocol_failure',
		);
	} finally {
		await page.unroute('**/api/v1/remote/mutations/fixture-05', unrelated);
	}
	checks.push('well-shaped detail for a different claim is rejected by request correlation');

	let beganWrite;
	const writing = new Promise((resolve) => {
		beganWrite = resolve;
	});
	let finishWrite;
	const writeGate = new Promise((resolve) => {
		finishWrite = resolve;
	});

	const delayedLoss = async (route) => {
		const response = await route.fetch();
		assert.equal(response.status(), 200);
		beganWrite();
		await writeGate;
		await route.abort('failed');
	};

	await page.route('**/api/v1/remote/mutations/fixture-05/evidence', delayedLoss);
	try {
		await page.evaluate(async () => {
			const { useMutationRecoveryStore } =
				await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
			const store = useMutationRecoveryStore();
			const signal = new AbortController().signal;
			await store.load(signal, true);
			await store.select('fixture-05', signal);
			window.fixtureMutation = store
				.evidence(
					store.selected,
					{
						expectedRevision: store.selected.revision,
						outcome: 'not_applied',
						producerStopped: true,
						resourcesStopped: true,
						observedAt: Date.now(),
						note: 'Early refresh fixture.',
					},
					signal,
				)
				.then(
					() => 'ok',
					(cause) => cause.outcome,
				);
		});
		await writing;
		await page.evaluate(async () => {
			const { useMutationRecoveryStore } =
				await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
			window.fixtureRecovery = useMutationRecoveryStore()
				.load(new AbortController().signal, true)
				.then(
					() => 'ok',
					(cause) => cause.code,
				);
		});
		finishWrite();
		assert.deepEqual(
			await page.evaluate(async () => {
				const { useMutationRecoveryStore } =
					await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
				return {
					mutation: await window.fixtureMutation,
					recovery: await window.fixtureRecovery,
					blocked: useMutationRecoveryStore().blocked,
				};
			}),
			{ mutation: 'unknown', recovery: 'refresh_required', blocked: true },
		);
	} finally {
		finishWrite();
		await page.unroute('**/api/v1/remote/mutations/fixture-05/evidence', delayedLoss);
	}
	checks.push('read recovery requested before a later unknown cannot clear that newer failure revision');

	let beganRead;
	const reading = new Promise((resolve) => {
		beganRead = resolve;
	});
	let finishRead;
	const readGate = new Promise((resolve) => {
		finishRead = resolve;
	});

	const lateRead = async (route) => {
		const response = await route.fetch();
		beganRead();
		await readGate;
		try {
			await route.fulfill({ response });
		} catch {
			/* Client reset deliberately cancels delivery. */
		}
	};

	await page.route('**/api/v1/remote/mutations/fixture-06', lateRead);
	try {
		await page.evaluate(async () => {
			const { useMutationRecoveryStore } =
				await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
			window.fixtureSelection = useMutationRecoveryStore()
				.select('fixture-06', new AbortController().signal)
				.then(
					() => 'ok',
					(cause) => cause.code,
				);
		});
		await reading;
		await page.evaluate(async () => {
			const { useMutationRecoveryStore } =
				await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
			useMutationRecoveryStore().reset();
		});
		finishRead();
		assert.equal(await page.evaluate(() => window.fixtureSelection), 'cancelled');
		assert.deepEqual(
			await page.evaluate(async () => {
				const { useMutationRecoveryStore } =
					await import('/src/features/mutation-recovery/store/mutation-recovery.store.ts');
				const store = useMutationRecoveryStore();
				return { selected: store.selected, count: store.items.length, busy: store.busy };
			}),
			{ selected: null, count: 0, busy: false },
		);
	} finally {
		finishRead();
		await page.unroute('**/api/v1/remote/mutations/fixture-06', lateRead);
	}
	checks.push(
		'authenticated owner reset cancels the original detail read and late delivery cannot repopulate new-session state',
	);

	// Verify durable outcomes after all real owners have stopped.
	await browser.close();
	browser = null;
	await vite.close();
	vite = null;
	await app.close();
	app = null;
	db = SqliteRuntime.open(dbPath);
	const reader = new SqliteMachineMutationStorage(db);
	reader.installTransactionIdentityReader(async () => 1);
	const released = await reader.get('fixture-read', 'fixture-04', () => {});
	assert.equal(released.state, 'released');
	assert.equal(released.evidence.length, 1);
	assert.equal((await reader.get('fixture-read', 'fixture-03', () => {})).evidence.length, 1);
	checks.push(
		'independent post-shutdown Adapter read verifies actual persisted evidence and releases, including exactly one response-loss commit',
	);
	console.log('Mutation recovery: ' + checks.length + ' checks PASS\n' + checks.join('\n'));
} catch (cause) {
	console.error(inspect(cause, { depth: 12 }));
	throw cause;
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() => db?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
			console.error(inspect(cause, { depth: 12 }));
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Mutation recovery fixture cleanup failed');
	}
}
