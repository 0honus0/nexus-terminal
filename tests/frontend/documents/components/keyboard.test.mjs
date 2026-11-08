import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { createApp, h, nextTick, ref, shallowRef } from 'vue';
import { createPinia } from 'pinia';

vi.mock('../../../../packages/frontend/src/features/file-editor/components/MonacoEditor.vue', () => ({
	default: { render: () => null },
}));
vi.mock('../../../../packages/frontend/src/features/file-editor/components/CodeMirrorMobileEditor.vue', () => ({
	default: { render: () => null },
}));
afterEach(() => vi.restoreAllMocks());

test('document keyboard ownership dispatches once to the focused editor and preview', async () => {
	// jsdom has no layout. Supply visible surfaces to check event ownership;
	// actual editor geometry and native shortcuts remain browser coverage.
	vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 640, 480)]);
	const { default: i18n, setLocale } = await import('../../../../packages/frontend/src/app/i18n/index.ts');
	await setLocale('en-US');
	const { default: FileEditor } =
		await import('../../../../packages/frontend/src/features/file-editor/components/FileEditor.vue');
	const { default: PreviewSearchBar } =
		await import('../../../../packages/frontend/src/features/file-preview/components/PreviewSearchBar.vue');
	const { default: FilePreview } =
		await import('../../../../packages/frontend/src/features/file-preview/components/FilePreview.vue');
	const { createFilePreviewSession } =
		await import('../../../../packages/frontend/src/features/file-preview/composables/useFilePreviewTabs.ts');
	const { createFileEditorSession } =
		await import('../../../../packages/frontend/src/features/file-editor/public.ts');
	const { authenticatedSessionLifecycle } =
		await import('../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts');
	const checks = [];

	const check = (condition, name) => {
		if (!condition) throw Error(name);
		checks.push(name);
	};

	const send = (target, key, modifiers = {}, prevented = false) => {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
		if (prevented) event.preventDefault();
		target.dispatchEvent(event);
		return event;
	};

	const createSession = async () => {
		const session = createFileEditorSession({
			load: async (path) => ({ path, content: '', encoding: 'utf-8' }),

			save: async () => {},
		});
		for (const path of ['/one', '/two', '/three']) await session.open(path);
		session.activeId.value = session.tabs.value[0].id;
		return session;
	};

	const mount = (render) => {
		const host = document.createElement('div');
		document.body.append(host);
		const app = createApp({ render });
		app.use(createPinia());
		app.use(i18n);
		app.mount(host);
		return {
			host,

			close: () => {
				app.unmount();
				host.remove();
			},
		};
	};

	authenticatedSessionLifecycle.attach(1);
	const shared = await createSession();
	const other = await createSession();
	const active = ref(true);
	const sessions = shallowRef([shared, shared]);
	const editor = mount(() =>
		sessions.value.map((session) => h(FileEditor, { session, port: {}, active: active.value })),
	);
	try {
		const roots = editor.host.querySelectorAll('.file-editor-container');
		for (const root of roots) root.tabIndex = 0;
		roots[1].focus();
		send(roots[1], 'ArrowRight', { altKey: true });
		check(
			shared.activeId.value === shared.tabs.value[1].id,
			'shared editors dispatch Alt+Right once in the focused editor',
		);
		send(document, 'ArrowLeft', { altKey: true });
		check(shared.activeId.value === shared.tabs.value[0].id, 'document events use the focused editor scope');
		active.value = false;
		await nextTick();
		send(roots[1], 'ArrowRight', { altKey: true });
		check(shared.activeId.value === shared.tabs.value[0].id, 'inactive rendered editors ignore tab shortcuts');
		active.value = true;
		sessions.value = [shared, other];
		await nextTick();
		roots[1].focus();
		send(roots[1], 'ArrowRight', { altKey: true }, true);
		check(other.activeId.value === other.tabs.value[0].id, 'prevented tab shortcut is not dispatched');
		send(roots[1], 'ArrowRight', { altKey: true });
		check(
			shared.activeId.value === shared.tabs.value[0].id && other.activeId.value === other.tabs.value[1].id,
			'independent editors change only the focused document session',
		);
		roots[1].blur();
		send(document, 'ArrowRight', { altKey: true });
		check(
			shared.activeId.value === shared.tabs.value[1].id && other.activeId.value === other.tabs.value[1].id,
			'unscoped tab shortcut uses one available editor',
		);
	} finally {
		editor.close();
		shared.reset();
		other.reset();
	}
	const opened = [ref(false), ref(false)];
	const preview = mount(() =>
		opened.map((open) =>
			h('section', { 'data-document-keyboard-scope': '', tabindex: 0 }, [
				h(PreviewSearchBar, {
					open: open.value,
					query: '',
					current: 0,
					total: 0,

					onOpen: () => {
						open.value = true;
					},

					onClose: () => {
						open.value = false;
					},
				}),
			]),
		),
	);
	try {
		const scopes = preview.host.querySelectorAll('section');
		scopes[1].focus();
		send(scopes[1], 'f', { ctrlKey: true });
		await nextTick();
		check(!opened[0].value && opened[1].value, 'preview find opens only in the focused document');
		opened[0].value = true;
		await nextTick();
		scopes[1].querySelector('input').focus();
		send(document, 'Escape');
		await nextTick();
		check(opened[0].value && !opened[1].value, 'Escape closes only the focused preview search');
		opened[0].value = false;
		await nextTick();
		document.activeElement?.blur();
		send(document, 'f', { ctrlKey: true });
		await nextTick();
		check(opened[0].value && !opened[1].value, 'unscoped find preserves one available preview fallback');
		const foreign = document.createElement('div');
		foreign.dataset.documentKeyboardScope = '';
		foreign.tabIndex = 0;
		document.body.append(foreign);
		foreign.focus();
		check(
			!send(foreign, 'f', { ctrlKey: true }).defaultPrevented,
			'preview search does not steal find from another document surface',
		);
		foreign.remove();
	} finally {
		preview.close();
		authenticatedSessionLifecycle.logout();
	}
	const source = {
		read: (_path, options) =>
			new Promise((resolve) => {
				options.signal.addEventListener('abort', () => resolve({ bytes: new ArrayBuffer(0) }), {
					once: true,
				});
			}),
	};
	const loadingSessions = [createFilePreviewSession(source), createFilePreviewSession(source)];
	const pendingLoads = loadingSessions.map((session) => session.open('/loading.md'));
	const loading = mount(() => loadingSessions.map((session) => h(FilePreview, { session, source })));
	try {
		loading.host.children[1].querySelector('button').focus();
		send(document, 'Escape');
		await nextTick();
		check(
			loadingSessions[0].tabs.value.length === 1 && loadingSessions[1].tabs.value.length === 0,
			'Escape cancels only the focused loading preview',
		);
		const foreign = document.createElement('div');
		foreign.dataset.documentKeyboardScope = '';
		foreign.tabIndex = 0;
		document.body.append(foreign);
		foreign.focus();
		check(
			!send(foreign, 'Escape').defaultPrevented && loadingSessions[0].tabs.value.length === 1,
			'loading preview does not consume Escape from another document surface',
		);
		foreign.remove();
		send(document, 'Escape');
		check(loadingSessions[0].tabs.value.length === 0, 'unscoped Escape preserves loading preview fallback');
	} finally {
		loading.close();
		for (const session of loadingSessions) session.clear();
		await Promise.all(pendingLoads);
	}
	assert.equal(checks.length, 13);
});
