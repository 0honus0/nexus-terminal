import { test, vi, afterEach } from 'vitest';
import { openFrontendApplication } from '../../../../support/http/frontend-application.mjs';
afterEach(() => vi.unstubAllGlobals());

test('execution settings editor preserves actual HTTP budgets, CAS, unknown writes and identity fences', async () => {
	const fixture = await openFrontendApplication();
	vi.stubGlobal('fetch', fixture.fetch);
	try {
		const { getExecutionSettings, saveExecutionSettings, saveExecutionHardLimits } =
			await import('../../../../../packages/frontend/src/features/agent/api/execution-api.ts');
		const { AgentManagementFailure } =
			await import('../../../../../packages/frontend/src/features/agent/model/management-failure.ts');
		const { createAccessApi } =
			await import('../../../../../packages/frontend/src/features/auth/api/access-api.ts');
		const { createApp, h, nextTick, defineComponent } = await import('vue');
		const { createPinia } = await import('pinia');
		const { default: AgentSettingsPanel } =
			await import('../../../../../packages/frontend/src/features/agent/settings/AgentSettingsPanel.vue');
		const { default: ExecutionSettingsCard } =
			await import('../../../../../packages/frontend/src/features/agent/settings/ExecutionSettings.vue');
		const { useExecutionSettings } =
			await import('../../../../../packages/frontend/src/features/agent/composables/use-execution-settings.ts');
		const { default: i18n, setLocale } = await import('../../../../../packages/frontend/src/app/i18n/index.ts');
		const { authenticatedSessionLifecycle } =
			await import('../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts');
		const ExecutionSettings = defineComponent({
			setup() {
				const editor = useExecutionSettings();
				return () =>
					h('div', [
						h(
							'button',
							{
								disabled: editor.busy.value,

								onClick: () => editor.perform('read'),
							},
							i18n.global.t('agent.settings.execution.read'),
						),
						...['budget', 'runtime', 'storage', 'subagents'].map((section) =>
							h(ExecutionSettingsCard, { editor, section }),
						),
					]);
			},
		});
		const { useNotificationStore } =
			await import('../../../../../packages/frontend/src/shared/feedback/store/notification.store.ts');
		const pinia = createPinia();
		const notifications = useNotificationStore(pinia);

		const hasFeedback = (message) => notifications.notifications.some((item) => item.message === message);

		const nativeFetch = window.fetch;
		const checks = [];
		let mounted;
		let node;

		function check(value, name) {
			if (!value) throw Error(name);
			checks.push(name);
		}

		function json(value, status = 200) {
			return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
		}

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
			throw Error('Execution UI did not converge: ' + node?.textContent?.slice(0, 500));
		}

		try {
			await failure(() => getExecutionSettings(), 'unauthenticated', 'confirmed');
			const access = createAccessApi();
			await access.setup({
				username: 'admin',
				password: 'execution-fixture-password',
				confirmPassword: 'execution-fixture-password',
			});
			await access.login({ username: 'admin', password: 'execution-fixture-password' });
			const initial = await getExecutionSettings();
			check(
				initial.version === 0 && initial.enabled === false && !('profiles' in initial),
				'real defaults without independent child profiles',
			);
			const input = structuredClone(initial);
			input.limits.maxModelRequests = 79;
			let current = await saveExecutionSettings(input);
			check(
				current.version === 1 && current.limits.maxModelRequests === 79,
				'real PUT persists shared execution budget',
			);
			await failure(() => saveExecutionSettings(input), 'version_conflict', 'confirmed');
			const hard = structuredClone(current.hardLimits);
			hard.maxModelRequests = 159;
			current = await saveExecutionHardLimits(current.version, hard);
			check(
				current.version === 2 &&
					current.hardLimits.maxModelRequests === 159 &&
					current.limits.maxModelRequests === 79,
				'real hard-limit save changes only hard limits',
			);
			check((await getExecutionSettings()).version === 2, 'real read confirms persisted update');
			let dispatched = 0;
			window.fetch = async (...args) => {
				dispatched += 1;
				return nativeFetch(...args);
			};
			const invalid = structuredClone(current);
			invalid.limits.maxModelRequests = 0;
			await failure(() => saveExecutionSettings(invalid), 'invalid_input', 'not_dispatched');
			check(dispatched === 0, 'invalid execution limits rejected before dispatch');
			const wire = { settings: current };
			window.fetch = async () => json({ ...wire, secret: 'private' });
			await failure(() => getExecutionSettings(), 'protocol_failure', 'unknown');
			window.fetch = async () =>
				json({
					settings: {
						...wire.settings,
						version: 3,
						limits: { ...wire.settings.limits, maxModelRequests: 78 },
					},
				});
			const expected = structuredClone(current);
			expected.limits.maxModelRequests = 77;
			await failure(() => saveExecutionSettings(expected), 'protocol_failure', 'unknown');
			window.fetch = async () =>
				json({
					confirmation: {
						id: crypto.randomUUID(),
						expectedVersion: 1,
						expiresAt: Date.now() + 60000,
						proposed: { ...hard, maxModelRequests: 158 },
						occupiedArtifactBytes: 0,
						activeRuns: 0,
					},
				});
			await failure(() => saveExecutionHardLimits(1, hard), 'protocol_failure', 'unknown');
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
			await failure(() => saveExecutionSettings(expected), 'request_failed', 'unknown');
			window.fetch = nativeFetch;
			authenticatedSessionLifecycle.attach(1);
			await setLocale('en-US');
			node = document.createElement('div');
			document.body.append(node);
			mounted = createApp({ render: () => h(ExecutionSettings) })
				.use(pinia)
				.use(i18n);
			mounted.mount(node);
			await until(() => node.querySelectorAll('input').length === Object.keys(current.limits).length * 2);
			check(
				node.querySelectorAll('textarea').length === 0 && node.querySelectorAll('select').length === 0,
				'actual components render shared budgets and hard limits without child overrides',
			);

			function button(key) {
				return [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === i18n.global.t(key));
			}

			function editBudget(value) {
				const field = node.querySelector('input');
				field.value = String(value);
				field.dispatchEvent(new Event('input', { bubbles: true }));
			}

			function save() {
				return button('common.save');
			}

			function read() {
				return button('agent.settings.execution.read');
			}

			editBudget(78);
			await nextTick();
			save().click();
			await until(() => hasFeedback(i18n.global.t('agent.settings.execution.saved')));
			check(
				(await getExecutionSettings()).limits.maxModelRequests === 78,
				'actual component saves through real Access and backend',
			);
			let writes = 0;
			let readFails = false;
			window.fetch = async (url, init) => {
				if (init?.method === 'PUT') {
					writes += 1;
					return json({ code: 'operation_unknown' }, 503);
				}
				if (readFails && String(url).endsWith('/execution-settings'))
					return json({ code: 'storage_unavailable' }, 503);
				return nativeFetch(url, init);
			};
			editBudget(77);
			await nextTick();
			save().click();
			await until(() => hasFeedback(i18n.global.t('agent.settings.execution.unknown')));
			check(node.querySelector('fieldset').disabled && writes === 1, 'unknown write fences editing and replay');
			save().click();
			await nextTick();
			check(writes === 1, 'fenced UI does not repeat mutation');
			readFails = true;
			read().click();
			await nextTick();
			await until(() => !read().disabled);
			check(node.querySelector('fieldset').disabled, 'failed read does not release unknown fence');
			readFails = false;
			read().click();
			await nextTick();
			await until(() => !node.querySelector('fieldset').disabled);
			check(
				writes === 1 && node.querySelector('input').value === '78',
				'successful read recovers actual saved state without replay',
			);
			for (const locale of ['zh-CN', 'ja-JP']) {
				const expectedWrites = writes + 1;
				await setLocale(locale);
				await nextTick();
				editBudget(77);
				await nextTick();
				save().click();
				await until(
					() =>
						writes === expectedWrites &&
						node.querySelector('fieldset').disabled &&
						!read().disabled &&
						hasFeedback(i18n.global.t('agent.settings.execution.unknown')),
				);
				check(hasFeedback(i18n.global.t('agent.settings.execution.unknown')), locale + ' safe unknown message');
				read().click();
				await nextTick();
				await until(() => !node.querySelector('fieldset').disabled);
			}
			await setLocale('en-US');
			await nextTick();
			window.fetch = nativeFetch;
			let hardInput = node.querySelector('details input');
			hardInput.value = '158';
			hardInput.dispatchEvent(new Event('input', { bubbles: true }));
			await nextTick();
			check(
				![...node.querySelectorAll('button')].some((item) => /preview/i.test(item.textContent)),
				'hard limits have no preview action',
			);
			check(node.querySelector('fieldset').disabled, 'hard-limit edits freeze ordinary settings draft');
			hardInput.value = '157';
			hardInput.dispatchEvent(new Event('input', { bubbles: true }));
			await nextTick();
			save().click();
			await until(
				() =>
					hasFeedback(i18n.global.t('agent.settings.execution.saved')) &&
					!node.querySelector('fieldset').disabled,
			);
			check(
				(await getExecutionSettings()).hardLimits.maxModelRequests === 157,
				'actual component saves hard limits without a preview step',
			);
			let modelReads = 0;
			window.fetch = async (url, init) => {
				if (String(url).includes('/ai/')) modelReads += 1;
				return nativeFetch(url, init);
			};
			mounted.unmount();
			mounted = createApp({ render: () => h(ExecutionSettings) })
				.use(pinia)
				.use(i18n);
			mounted.mount(node);
			await until(() => node.querySelectorAll('input').length === Object.keys(current.limits).length * 2);
			check(modelReads === 0, 'inherited Subagent settings do not load a separate model directory');
			window.fetch = nativeFetch;
			hardInput = node.querySelector('details input');
			window.fetch = async (url, init) =>
				init?.method === 'PUT' ? json({ code: 'version_conflict' }, 409) : nativeFetch(url, init);
			editBudget(77);
			await nextTick();
			save().click();
			await until(() => node.querySelector('fieldset').disabled && !read().disabled);
			check(
				hasFeedback(i18n.global.t('agent.settings.execution.conflict')),
				'UI conflict requires explicit read and a new draft',
			);
			read().click();
			await nextTick();
			await until(() => !node.querySelector('fieldset').disabled);

			const pendingReads = [];
			let held = false;
			window.fetch = () => {
				held = true;
				return new Promise((resolve) => {
					pendingReads.push(() => resolve(json(wire)));
				});
			};
			mounted.unmount();
			mounted = createApp({ render: () => h(ExecutionSettings) })
				.use(pinia)
				.use(i18n);
			mounted.mount(node);
			await nextTick();
			await until(() => held);
			authenticatedSessionLifecycle.logout();
			await nextTick();
			for (const release of pendingReads) release();
			await new Promise((resolve) => setTimeout(resolve, 30));
			check(
				node.querySelectorAll('input').length === 0 && !node.querySelector('[role=alert]'),
				'revoked view rejects late settings and clears private drafts',
			);
			window.fetch = nativeFetch;
			mounted.unmount();
			authenticatedSessionLifecycle.attach(1);
			window.fetch = async (url, init) =>
				String(url).endsWith('/ai/providers')
					? json({ code: 'storage_unavailable' }, 503)
					: nativeFetch(url, init);
			mounted = createApp({ render: () => h(AgentSettingsPanel) })
				.use(pinia)
				.use(i18n);
			mounted.mount(node);
			await until(() => hasFeedback(i18n.global.t('agent.settings.providerManagement.failed')));
			Array.from(node.querySelectorAll('nav button'))
				.find((button) => button.textContent.trim() === i18n.global.t('agent.settings.groups.runtime'))
				.click();
			await nextTick();
			await until(() => node.querySelector('section[aria-label="Execution and performance"] input'));
			check(
				!node.querySelector('section[aria-label="Execution and performance"] fieldset').disabled,
				'formal settings panel keeps shared execution limits usable while provider loading fails',
			);

			await access.logout();
			await failure(() => getExecutionSettings(), 'unauthenticated', 'confirmed');
			return checks;
		} finally {
			window.fetch = nativeFetch;
			mounted?.unmount();
			node?.remove();
			authenticatedSessionLifecycle.dispose();
		}
	} finally {
		await fixture.close();
	}
});
