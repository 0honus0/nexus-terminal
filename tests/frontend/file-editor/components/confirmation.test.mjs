import assert from 'node:assert/strict';
import { test } from 'vitest';

test('editor confirmations bind their triggering view and reject draft changes, deactivation and revoked owners', async () => {
	const { createApp, h, KeepAlive, nextTick, ref } = await import('vue');
	const { createFileEditorSession } =
		await import('../../../../packages/frontend/src/features/file-editor/public.ts');
	const { useFileEditorActions } =
		await import('../../../../packages/frontend/src/features/file-editor/composables/use-file-editor-actions.ts');
	const { authenticatedSessionLifecycle } =
		await import('../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts');
	const checks = [];
	const owners = new Set();

	const check = (condition, name) => {
		if (!condition) throw new Error(name);
		checks.push(name);
	};

	const openDocument = async () => {
		const loads = [];
		const session = createFileEditorSession({
			load: async (path, encoding = 'utf-8') => {
				loads.push({ path, encoding });
				return { path, content: 'remote', encoding };
			},

			save: async () => {},
		});
		await session.open('/file');
		session.update('original draft');
		return { session, loads };
	};

	const mountOwner = (session, keepAlive = false) => {
		const active = ref(true);
		const shown = ref(true);
		const confirmations = [];
		let actions;
		const component = {
			setup() {
				actions = useFileEditorActions({
					session: () => session,

					active: () => active.value,

					confirmDiscard: (signal) => new Promise((resolve) => confirmations.push({ signal, resolve })),
				});
				return () => h('div');
			},
		};
		const host = document.createElement('div');
		document.body.append(host);
		const app = createApp({
			render: () =>
				keepAlive ? h(KeepAlive, null, { default: () => (shown.value ? h(component) : null) }) : h(component),
		});
		app.mount(host);
		const owner = {
			actions,
			active,
			shown,
			confirmations,

			dispose: () => {
				app.unmount();
				host.remove();
				owners.delete(owner);
			},
		};
		owners.add(owner);
		return owner;
	};

	authenticatedSessionLifecycle.attach(1);
	try {
		for (const operation of ['reload', 'encoding']) {
			const { session, loads } = await openDocument();
			const owner = mountOwner(session);
			const pending = operation === 'reload' ? owner.actions.reload() : owner.actions.changeEncoding('utf-16le');
			const confirmation = owner.confirmations[0];
			session.update('new draft');
			check(confirmation.signal.aborted, operation + ' cancels confirmation when the draft changes');
			session.update('original draft');
			confirmation.resolve(true);
			await pending;
			check(
				loads.length === 1 && session.active.value.content === 'original draft',
				operation + ' ignores a late approval even after the draft is restored',
			);
			owner.dispose();
		}

		for (const reason of ['hidden', 'deactivated', 'unmounted', 'logout']) {
			const { session, loads } = await openDocument();
			const owner = mountOwner(session, reason === 'deactivated');
			const pending = owner.actions.reload();
			const confirmation = owner.confirmations[0];
			if (reason === 'hidden') owner.active.value = false;
			else if (reason === 'deactivated') owner.shown.value = false;
			else if (reason === 'unmounted') owner.dispose();
			else authenticatedSessionLifecycle.logout();
			await nextTick();
			check(confirmation.signal.aborted, reason + ' cancels the original editor confirmation');
			confirmation.resolve(true);
			await pending;
			check(
				loads.length === 1 && session.active.value.content === 'original draft',
				reason + ' prevents a late approved reload from discarding the draft',
			);
			if (reason === 'logout') authenticatedSessionLifecycle.attach(1);
			if (reason !== 'unmounted') {
				owner.active.value = true;
				owner.shown.value = true;
				await nextTick();
				const resumed = owner.actions.changeEncoding('utf-16le');
				owner.confirmations.at(-1).resolve(true);
				await resumed;
				check(
					loads.length === 2 && session.active.value.encoding === 'utf-16le',
					reason + ' allows a new explicit encoding change after reactivation',
				);
				owner.dispose();
			}
		}

		const shared = await openDocument();
		const firstView = mountOwner(shared.session);
		const secondView = mountOwner(shared.session);
		const firstClose = firstView.actions.closeAll();
		check(
			firstView.confirmations.length === 1 && secondView.confirmations.length === 0,
			'shared close uses its triggering view even when another active view registered later',
		);
		firstView.active.value = false;
		firstView.confirmations[0].resolve(true);
		check(
			!(await firstClose) && shared.session.tabs.value.length === 1 && secondView.active.value,
			'late approval from hidden shared view cannot borrow the other active view',
		);
		const secondClose = secondView.actions.close(shared.session.active.value.id);
		secondView.confirmations[0].resolve(true);
		check(await secondClose, 'other shared view can explicitly confirm its own close');
		firstView.dispose();
		secondView.dispose();

		const { session } = await openDocument();
		const original = mountOwner(session);
		const current = mountOwner(session);
		original.dispose();
		const closing = session.closeAll();
		check(current.confirmations.length === 1, 'old shared view cleanup preserves the current confirmation owner');
		current.active.value = false;
		check(current.confirmations[0].signal.aborted, 'hiding the close owner cancels its confirmation');
		current.confirmations[0].resolve(true);
		check(!(await closing) && session.tabs.value.length === 1, 'late close approval preserves the dirty tab');
		check(!(await session.closeAll()), 'dirty close without an active confirmation owner is refused');
		current.active.value = true;
		const confirmedClose = session.closeAll();
		current.confirmations.at(-1).resolve(true);
		check(await confirmedClose, 'reactivated view can explicitly confirm closing the original dirty tab');
		current.dispose();

		const reset = await openDocument();
		let confirmReset;
		reset.session.setCloseConfirmation(() => new Promise((resolve) => (confirmReset = resolve)));
		const oldClose = reset.session.closeAll();
		reset.session.reset();
		confirmReset(true);
		check(!(await oldClose), 'reset invalidates a pending close approval');
		const clean = await openDocument();
		await clean.session.save();
		const revoked = clean.session.setCloseConfirmation(async () => true);
		revoked.dispose();
		check(
			!(await revoked.closeAll()) && clean.session.tabs.value.length === 1,
			'revoked close capability cannot close even a clean document',
		);
		assert.ok(checks.length >= 20);
	} finally {
		for (const owner of owners) owner.dispose();
		authenticatedSessionLifecycle.logout();
	}
});
