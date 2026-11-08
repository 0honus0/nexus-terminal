// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test('system overview retains last samples, correlates hosts, and fences cancelled or superseded reads', async () => {
	const { createSystemOverview } =
		await import('../../../../packages/frontend/src/features/system-overview/composables/useSystemOverview.ts');
	const { systemOverviewApi } =
		await import('../../../../packages/frontend/src/features/system-overview/api/system-overview-api.ts');
	const { ResourceFailure } =
		await import('../../../../packages/frontend/src/features/system-overview/model/system-overview-types.ts');
	const { authenticatedSessionLifecycle } =
		await import('../../../../packages/frontend/src/shared/session/public.ts');
	const nativeFetch = window.fetch;
	const controllers = [];
	const results = [];

	const check = (value, name) => {
		if (!value) {
			throw Error(name);
		}
		results.push(name);
	};

	const deferred = () => {
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		return { promise, resolve };
	};

	const until = async (test) => {
		const deadline = performance.now() + 3000;
		while (!test()) {
			if (performance.now() > deadline) {
				throw Error('fixture condition timeout');
			}
			await new Promise((done) => setTimeout(done, 5));
		}
	};

	const json = (value, status = 200) =>
		new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

	const local = (cpu = 0) => json({ cpuPercent: cpu, memPercent: 0, memUsed: 0, memTotal: 100, uptimeSeconds: 1 });

	const target = (id) => ({ id, name: 'Host ' + id, host: 'host' + id, port: 22, username: 'fixture' });

	const resource = (id) => ({
		key: 'host' + id + ':22',
		connectionId: id,
		name: 'Host ' + id,
		host: 'host' + id,
		port: 22,
		username: 'fixture',
		checkedAt: 123,
		status: { timestamp: 120, cpuPercent: 0 },
	});

	const create = () => {
		const controller = createSystemOverview();
		controllers.push(controller);
		return controller;
	};

	let handler = () => local();

	vi.stubGlobal('fetch', (url, input) => Promise.resolve().then(() => handler(String(url), input)));
	try {
		const controller = create();
		await controller.loadLocal();
		const firstLocalCheckedAt = controller.local.value.checkedAt;
		check(
			controller.local.value.cpuPercent === 0 &&
				controller.local.value.diskUsed === undefined &&
				Number.isFinite(firstLocalCheckedAt),
			'zero preserved and missing disk absent',
		);
		handler = () => json({ code: 'forbidden' }, 503);
		await controller.loadLocal();
		check(
			controller.localError.value === 'protocol_failure' &&
				controller.local.value.cpuPercent === 0 &&
				controller.local.value.checkedAt === firstLocalCheckedAt,
			'HTTP failure status mismatch retains last sample',
		);
		handler = () => json({ code: 'remote_unavailable', stderr: 'secret' }, 503);
		await controller.loadLocal();
		check(controller.localError.value === 'protocol_failure', 'private error fields rejected');
		handler = () => json({ code: 'forbidden' }, 403);
		await controller.loadLocal();
		check(controller.localError.value === 'forbidden', 'finite authorized failure');
		const anonymous = deferred();
		handler = () => anonymous.promise;
		const anonymousRead = controller.loadLocal();
		authenticatedSessionLifecycle.attach(1);
		anonymous.resolve(local(77));
		await anonymousRead;
		check(
			controller.local.value === null && !controller.localLoading.value,
			'initial login invalidates anonymous read',
		);
		authenticatedSessionLifecycle.logout();
		let calls = 0;
		const old = deferred();
		let oldSignal;
		handler = (_url, input) => {
			calls++;
			oldSignal = input.signal;
			return old.promise;
		};
		const first = controller.loadLocal();
		await until(() => calls === 1);
		await controller.loadLocal();
		check(calls === 1, 'local read single flight');
		controller.stopLocal();
		check(oldSignal.aborted && !controller.localLoading.value, 'local cancellation reaches transport');
		const newer = deferred();
		handler = () => newer.promise;
		const second = controller.loadLocal();
		old.resolve(local(88));
		await first;
		check(
			controller.localLoading.value && controller.local.value === null,
			'old success and finally cannot cover new request',
		);
		newer.resolve(local(9));
		await second;
		check(controller.local.value.cpuPercent === 9, 'new instance publishes');
		handler = () => {
			throw Error('private network body');
		};
		await controller.loadRemote(async () => [target(1)]);
		check(
			controller.remote.value[0].error === 'request_failed' && controller.remote.value[0].checkedAt === null,
			'network failure has no fabricated checkedAt',
		);
		handler = () => json({ ...resource(1), connectionId: 99, username: 'fallback' });
		await controller.loadRemote(async () => [target(1)]);
		check(
			controller.remote.value[0].state === 'ready' && controller.remote.value[0].connectionId === 99,
			'same-host fallback connection accepted',
		);
		handler = () => {
			throw Error('private network body');
		};
		await controller.loadRemote(async () => [target(1)]);
		check(
			controller.remote.value[0].state === 'ready' &&
				controller.remote.value[0].status.cpuPercent === 0 &&
				controller.remote.value[0].checkedAt === 123 &&
				controller.remote.value[0].refreshError === 'request_failed',
			'refresh failure retains last successful host sample',
		);
		handler = () => json(resource(2));
		await controller.loadRemote(async () => [target(1)]);
		check(
			controller.remote.value[0].state === 'ready' &&
				controller.remote.value[0].refreshError === 'protocol_failure',
			'foreign host association rejected without dropping last sample',
		);
		handler = () => json({ ...resource(1), status: { timestamp: 120 } });
		await controller.loadRemote(async () => [target(1)]);
		check(controller.remote.value[0].status.cpuPercent === undefined, 'remote missing metric not zero');
		handler = () => {
			const value = resource(1);
			delete value.status;
			return json({ ...value, error: 'host_key_untrusted' });
		};
		await controller.loadRemote(async () => [target(1)]);
		check(
			controller.remote.value[0].state === 'ready' &&
				controller.remote.value[0].refreshError === 'host_key_untrusted' &&
				controller.remote.value[0].checkedAt === 123,
			'producer failure retains last successful sample and server check time',
		);
		let active = 0,
			peak = 0,
			remoteCalls = 0;
		const slow = deferred();
		handler = async (url) => {
			const id = Number(url.split('/').at(-1));
			remoteCalls++;
			active++;
			peak = Math.max(peak, active);
			try {
				if (id === 1) {
					await slow.promise;
				}
				return json(resource(id));
			} finally {
				active--;
			}
		};
		controller.stopRemote();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const aggregate = controller.loadRemote(async () => [
			target(1),
			target(2),
			target(3),
			target(4),
			target(5),
			{ ...target(1), id: 6, host: ' HOST1 ' },
		]);
		await vi.advanceTimersByTimeAsync(0);
		check(
			controller.remote.value.some((item) => item.connectionId === 5 && item.state === 'ready'),
			'available host worker starts the next queued sample without an artificial delay',
		);
		vi.useRealTimers();
		check(
			controller.remote.value[0].state === 'waiting' &&
				controller.remote.value.filter((item) => item.state === 'ready').length === 4,
			'independent host publication',
		);
		slow.resolve();
		await aggregate;
		check(remoteCalls === 5 && peak <= 4, 'host deduplication and four-worker bound');
		const targets = deferred();
		const lateTargets = controller.loadRemote(() => targets.promise);
		controller.deactivate();
		targets.resolve([target(1)]);
		await lateTargets;
		check(
			controller.remote.value.length === 5 &&
				controller.remote.value.every((item) => item.state === 'ready') &&
				controller.local.value.cpuPercent === 9 &&
				remoteCalls === 5,
			'deactivation preserves samples and blocks late dispatch',
		);
		controller.activate();
		const late = deferred();
		handler = () => late.promise;
		const lateRequest = controller.loadRemote(async () => [target(1)]);
		await until(() => controller.remote.value.length === 1);
		check(controller.remote.value[0].state === 'ready', 'refresh retains last host snapshot');
		authenticatedSessionLifecycle.attach(1);
		authenticatedSessionLifecycle.logout();
		late.resolve(json(resource(1)));
		await lateRequest;
		check(
			controller.remote.value.length === 0 && !controller.remoteLoading.value && controller.local.value === null,
			'session reset rejects late response',
		);
		const signal = new AbortController();
		signal.abort();
		try {
			await systemOverviewApi.local(signal.signal);
			throw Error('abort accepted');
		} catch (cause) {
			check(cause instanceof ResourceFailure && cause.code === 'cancelled', 'pre-dispatch cancellation');
		}
		controller.dispose();
		handler = () => {
			throw Error('disposed dispatch');
		};
		await controller.loadLocal();
		await controller.loadRemote(async () => [target(1)]);
		check(!controller.loading.value, 'disposed controller rejects new reads');
		const { default: i18n, setLocale } = await import('../../../../packages/frontend/src/app/i18n/index.ts');
		for (const locale of ['zh-CN', 'en-US', 'ja-JP']) {
			await setLocale(locale);
			for (const code of [
				'invalid_input',
				'unauthenticated',
				'forbidden',
				'not_found',
				'limit_exceeded',
				'conflict',
				'remote_unavailable',
				'command_failed',
				'operation_unknown',
				'host_key_untrusted',
				'request_failed',
				'protocol_failure',
				'cancelled',
			]) {
				check(i18n.global.te('systemOverview.errors.' + code, locale), locale + ' finite error ' + code);
			}
		}
		assert.ok(results.length >= 60);
	} finally {
		window.fetch = nativeFetch;
		for (const controller of controllers) {
			controller.dispose();
		}
		authenticatedSessionLifecycle.dispose();
	}
});
