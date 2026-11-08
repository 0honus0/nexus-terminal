import { test, vi, afterEach } from 'vitest';
afterEach(() => vi.unstubAllGlobals());

test('registry editor preserves projection, unknown refresh and revoked identity fences', async () => {
	const { getModelRegistryStatus, refreshModelRegistry, resolveModelRegistry } =
		await import('../../../../../packages/frontend/src/features/agent/api/registry-api.ts');
	const { AgentManagementFailure } =
		await import('../../../../../packages/frontend/src/features/agent/model/management-failure.ts');
	const { createApp, h, nextTick } = await import('vue');
	const { createPinia } = await import('pinia');
	const { default: RegistrySettings } =
		await import('../../../../../packages/frontend/src/features/agent/settings/ModelRegistrySettings.vue');
	const { default: i18n, setLocale } = await import('../../../../../packages/frontend/src/app/i18n/index.ts');
	const { authenticatedSessionLifecycle } =
		await import('../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts');
	const { useNotificationStore } =
		await import('../../../../../packages/frontend/src/shared/feedback/store/notification.store.ts');
	const pinia = createPinia();
	const notifications = useNotificationStore(pinia);

	const unknownNotice = () =>
		notifications.notifications.find(
			(item) =>
				item.kind === 'error' && item.message === i18n.global.t('agent.settings.providers.registryUnknown'),
		);

	const nativeFetch = async () =>
		new Response(JSON.stringify({ code: 'unauthenticated' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});

	vi.stubGlobal('fetch', nativeFetch);
	const checks = [];
	let mounted;
	let node;

	const check = (value, name) => {
		if (!value) throw Error(name);
		checks.push(name);
	};

	const json = (value, status = 200) =>
		new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

	async function failure(work, code, outcome) {
		try {
			await work();
		} catch (cause) {
			check(
				cause instanceof AgentManagementFailure && cause.code === code && cause.outcome === outcome,
				code + '/' + outcome,
			);
			return;
		}
		throw Error('Expected ' + code);
	}

	async function until(predicate) {
		for (let i = 0; i < 300; i++) {
			if (predicate()) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw Error('Registry UI did not converge');
	}

	try {
		await failure(() => getModelRegistryStatus(), 'unauthenticated', 'confirmed');
		let dispatched = 0;
		window.fetch = async (...args) => {
			dispatched += 1;
			return nativeFetch(...args);
		};
		await failure(() => resolveModelRegistry('界'.repeat(86)), 'invalid_input', 'not_dispatched');
		await failure(() => resolveModelRegistry('\ud800'), 'invalid_input', 'not_dispatched');
		check(dispatched === 0, 'invalid identifiers rejected before dispatch');
		const wire = {
			sourceUrl: 'https://models.dev/api.json',
			activeSource: 'remote',
			entryCount: 3,
			generatedAt: 1700000000,
			sourceRevision: 'fixture',
			lastAttemptAt: 1700000001,
			lastSuccessAt: 1700000002,
			lastErrorCode: null,
		};
		window.fetch = async () => json(wire);
		const projected = await getModelRegistryStatus();
		check(
			projected.generatedAt === 1700000000000 && projected.lastSuccessAt === 1700000002000,
			'registry seconds become application milliseconds once',
		);
		window.fetch = async () => json({ ...wire, secret: 'private' });
		await failure(() => getModelRegistryStatus(), 'protocol_failure', 'unknown');
		window.fetch = async () => json({ ...wire, lastErrorCode: 'upstream secret' });
		await failure(() => getModelRegistryStatus(), 'protocol_failure', 'unknown');
		window.fetch = async () => json({ ...wire, activeSource: 'unavailable' });
		await failure(() => getModelRegistryStatus(), 'protocol_failure', 'unknown');
		window.fetch = async () => json({ modelId: 'other', defaults: null });
		await failure(() => resolveModelRegistry('expected'), 'protocol_failure', 'unknown');
		window.fetch = async () =>
			json({
				modelId: 'expected',
				defaults: { contextWindow: 8000, maxOutputTokens: 1000, reasoningEfforts: ['high', 'high'] },
			});
		await failure(() => resolveModelRegistry('expected'), 'protocol_failure', 'unknown');
		window.fetch = async () =>
			json({ modelId: 'expected', defaults: { contextWindow: 8000, maxOutputTokens: 1000 } });
		const defaults = await resolveModelRegistry('expected');
		check(
			defaults?.contextWindow === 8000 && defaults.supportsTools === undefined,
			'missing vendor capability remains unknown',
		);
		window.fetch = async () => json({ code: 'forbidden' }, 500);
		await failure(() => refreshModelRegistry(), 'protocol_failure', 'unknown');
		window.fetch = async () => json({ code: 'operation_unknown' }, 503);
		await failure(() => refreshModelRegistry(), 'operation_unknown', 'unknown');
		window.fetch = async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('{'));
						controller.error(Error('fixture stream failure'));
					},
				}),
				{ headers: { 'Content-Type': 'application/json' } },
			);
		await failure(() => refreshModelRegistry(), 'request_failed', 'unknown');
		authenticatedSessionLifecycle.attach(1);
		await setLocale('en-US');
		let writes = 0;
		window.fetch = async (_url, init) => {
			if (init?.method === 'POST') {
				writes += 1;
				return json({ code: 'operation_unknown' }, 503);
			}
			return json(wire);
		};
		node = document.createElement('div');
		document.body.append(node);
		mounted = createApp({ render: () => h(RegistrySettings) })
			.use(pinia)
			.use(i18n);
		mounted.mount(node);
		await until(() => node.textContent.includes('3 models'));

		const buttons = () => [...node.querySelectorAll('button')];

		const read = () =>
			buttons().find(
				(button) => button.textContent.trim() === i18n.global.t('agent.settings.providers.registryReadStatus'),
			);

		const refresh = () =>
			buttons().find(
				(button) => button.textContent.trim() === i18n.global.t('agent.settings.providers.registryRefresh'),
			);

		refresh().click();
		await until(() => unknownNotice() && read() && !read().disabled && refresh().disabled);
		check(
			refresh().disabled && writes === 1 && !node.textContent.includes('operation_unknown'),
			'unknown refresh blocks replay and uses safe localized message',
		);
		refresh().click();
		await nextTick();
		check(writes === 1, 'disabled refresh does not replay');
		read().click();
		await until(() => !refresh().disabled && !node.querySelector('[role="alert"]'));
		check(writes === 1, 'read-only recovery never repeats mutation');
		for (const locale of ['zh-CN', 'ja-JP']) {
			await setLocale(locale);
			await nextTick();
			refresh().click();
			await until(() => unknownNotice() && read() && !read().disabled && refresh().disabled);
			check(
				unknownNotice()?.message === i18n.global.t('agent.settings.providers.registryUnknown'),
				locale + ' safe unknown message',
			);
			read().click();
			await until(() => !refresh().disabled);
		}
		await setLocale('en-US');
		await nextTick();
		refresh().click();
		await until(() => read() && refresh().disabled);
		let release;
		let held = false;
		window.fetch = () => {
			held = true;
			return new Promise((resolve) => {
				release = () => resolve(json({ ...wire, entryCount: 99 }));
			});
		};
		read().click();
		await until(() => held);
		authenticatedSessionLifecycle.logout();
		await nextTick();
		release();
		await new Promise((resolve) => setTimeout(resolve, 30));
		check(
			!node.textContent.includes('99 models') &&
				!node.textContent.includes('3 models') &&
				!node.querySelector('[role="alert"]'),
			'late response after identity revocation cannot republish state',
		);
		mounted.unmount();
		mounted = undefined;
		node.remove();
		node = undefined;
		window.fetch = nativeFetch;
		window.fetch = async () => json({ code: 'unauthenticated' }, 401);
		await failure(() => getModelRegistryStatus(), 'unauthenticated', 'confirmed');
		return checks;
	} finally {
		window.fetch = nativeFetch;
		mounted?.unmount();
		node?.remove();
		authenticatedSessionLifecycle.dispose();
	}
});
