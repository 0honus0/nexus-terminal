import { test, expect as verify } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';

test('quick commands preserve real CAS, cascading tag revisions, usage and all pages', async () => {
	await openAuthenticatedFrontendApplication();
	const { quickCommandsApi } =
		await import('../../../../packages/frontend/src/features/quick-commands/api/quick-commands-api.ts');
	const { useQuickCommandsStore } =
		await import('../../../../packages/frontend/src/features/quick-commands/store/quickCommands.store.ts');
	const { PreferenceRequestFailure } =
		await import('../../../../packages/frontend/src/client/preferences/preference-request.ts');
	const results = [];

	const expect = (condition, name) => {
		if (!condition) throw Error(name);
		results.push(name);
	};

	const commands = useQuickCommandsStore();
	await commands.load(true);
	const created = await commands.save({
		name: 'Shared command',
		command: 'printf shared',
		variables: { x: 'value' },
		tagIds: [],
	});
	const revised = await commands.save(
		{ name: created.name, command: 'printf updated', variables: {}, tagIds: [] },
		created,
	);
	expect(
		revised.version === created.version + 1 && revised.command === 'printf updated',
		'command create/update converts Shared wire into independent application summaries',
	);
	let stale;
	try {
		await commands.save({ name: null, command: 'stale', variables: {}, tagIds: [] }, created);
	} catch (cause) {
		stale = cause;
	}
	expect(
		stale instanceof PreferenceRequestFailure && stale.code === 'version_conflict',
		'command editing preserves its original version',
	);
	await commands.load(true);
	const assignment = await commands.createTagForCommands('Assigned tag', [revised]);
	expect(
		assignment.assigned && commands.items.find((item) => item.id === revised.id)?.version === revised.version + 1,
		'tag assignment rereads authoritative command versions',
	);
	const renamed = await commands.renameTag(assignment.tag, 'Renamed tag');
	await commands.removeTag(renamed);
	const detached = commands.items.find((item) => item.id === revised.id);
	expect(
		detached.version === revised.version + 2 && detached.tagIds.length === 0,
		'tag deletion rereads cascading version changes',
	);
	await commands.recordUsage(detached.id);
	const counted = commands.items.find((item) => item.id === detached.id);
	expect(
		counted.version === detached.version + 1 && counted.usageCount === 1,
		'usage increment consumes finite versioned mutation',
	);
	await commands.remove(counted);
	for (let index = 0; index < 51; index++)
		await quickCommandsApi.create({ name: 'Page ' + index, command: 'true', variables: {}, tagIds: [] });
	await commands.load(true);
	expect(
		commands.items.length === 51,
		'commands follow Shared fifty-entry pagination without accepting a legacy array',
	);
	const permission = new AbortController();
	permission.abort();
	let denied;
	try {
		await commands.save(
			{ name: null, command: 'must not dispatch', variables: {}, tagIds: [] },
			undefined,
			permission.signal,
		);
	} catch (cause) {
		denied = cause;
	}
	expect(
		denied instanceof PreferenceRequestFailure && denied.outcome === 'not_dispatched',
		'revoked queued UI intent is rejected before HTTP dispatch',
	);

	verify(results).toHaveLength(7);
});
