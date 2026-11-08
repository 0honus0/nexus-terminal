import { test, expect } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';

test('personal presentation retains a coherent snapshot, original CAS and frozen reactive drafts', async () => {
	await openAuthenticatedFrontendApplication();
	const { usePresentationStore, usePreferences } =
		await import('../../../../packages/frontend/src/features/preferences/public.ts');
	const { reactive } = await import('vue');
	const { PreferenceRequestFailure } =
		await import('../../../../packages/frontend/src/client/preferences/preference-request.ts');
	const store = usePresentationStore();
	const preferences = usePreferences();
	const checks = [];
	const initial = await store.load(true);
	if (!initial.layout.id || !Number.isSafeInteger(initial.version)) throw Error('initial presentation snapshot');
	const saved = await store.update({
		action: 'preferences',
		expectedVersion: initial.version,
		preferences: { ...initial.preferences, timezone: 'Asia/Tokyo' },
	});
	if (saved.version !== initial.version + 1 || preferences.values.value.timezone !== 'Asia/Tokyo')
		throw Error('preferences receipt');
	checks.push('four real Shared reads form one coherent personal presentation snapshot');
	try {
		await store.update({ action: 'focus', expectedVersion: initial.version, focus: initial.focus });
		throw Error('stale accepted');
	} catch (cause) {
		if (!(cause instanceof PreferenceRequestFailure) || cause.code !== 'version_conflict') throw cause;
	}
	if (!store.blocked) throw Error('conflict failed to fence');
	const fresh = await store.load(true);
	if (store.blocked || fresh.preferences.timezone !== 'Asia/Tokyo') throw Error('conflict recovery');
	checks.push('personal domains share original CAS version and recover only by explicit read');
	const input = reactive({
		action: 'focus',
		expectedVersion: fresh.version,
		focus: { sequence: ['commandInput'], shortcuts: { commandInput: 'Alt+C' } },
	});
	const pending = store.update(input);
	input.focus.shortcuts.commandInput = 'Alt+D';
	const focused = await pending;
	if (focused.focus.shortcuts.commandInput !== 'Alt+C') throw Error('draft was not frozen');
	checks.push('reactive focus drafts are whitelisted before queueing and later mutations cannot alter the request');
	const workspace = await store.update({
		action: 'workspace',
		expectedVersion: focused.version,
		layout: focused.layout,
		sidebar: { left: ['connections'], right: ['dockerManager'] },
	});
	if (
		workspace.version !== focused.version + 1 ||
		workspace.sidebar.right[0] !== 'dockerManager' ||
		workspace.focus.shortcuts.commandInput !== 'Alt+C'
	)
		throw Error('workspace atomic write');
	checks.push('layout and sidebar update atomically while preserving the other personal domains');
	expect(checks).toHaveLength(4);
});
