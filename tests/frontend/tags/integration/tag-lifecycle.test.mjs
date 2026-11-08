import { test, expect as verify } from 'vitest';
import { h, ref, nextTick } from 'vue';
import { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { openTargetPanel } from '../../targets/support/panel.mjs';

test('tag relationships, partial creation and real panels preserve CAS, recovery and lifecycle', async () => {
	const { pinia, dialogs, original, check, checks, until, mount, hasFeedback, i18n, failure, response } =
		await openTargetPanel();
	try {
		const { tagsApi } = await import('../../../../packages/frontend/src/features/tags/api/tags-api.ts');
		const { useTagsStore } = await import('../../../../packages/frontend/src/features/tags/store/tags.store.ts');
		const { default: TagPicker } =
			await import('../../../../packages/frontend/src/features/tags/components/ConnectionTagPicker.vue');
		const { default: TagManager } =
			await import('../../../../packages/frontend/src/runtimes/workspace/components/WorkspaceTagGroupManager.vue');
		const { useConnectionsStore } =
			await import('../../../../packages/frontend/src/features/connections/store/connections.store.ts');
		const tags = useTagsStore(pinia);
		await tags.load();
		await failure(() => tags.create('猫'.repeat(43)), 'invalid_input');
		check(!tags.needsRefresh && tags.items.length === 0, 'UTF-8 tag name capacity rejected before dispatch');
		const initialTag = await tags.create('  integration tag  ');
		check(initialTag.name === 'integration tag' && initialTag.version === 1, 'real tag creation normalizes name');
		const renamedTag = await tags.rename(initialTag, 'renamed tag');
		await failure(() => tags.rename(initialTag, 'stale name'), 'version_conflict');
		check(
			tags.needsRefresh && (await tagsApi.list()).find((tag) => tag.id === initialTag.id).name === 'renamed tag',
			'real tag CAS refuses stale edit and fences writes',
		);
		await tags.load(true);
		const ensured = await tags.ensure([' existing tag ', 'existing tag', 'renamed tag']);
		check(
			ensured.length === 2 && ensured[1].id === initialTag.id,
			'real ensure deduplicates normalized names and reuses existing tag',
		);
		let postCount = 0;
		window.fetch = (url, options) => {
			if (options?.method === 'POST' && String(url).endsWith('/tags')) {
				postCount += 1;
			}
			return original(url, options);
		};
		let rejectedNames = false;
		try {
			await tags.ensure(['must not create', ' ']);
		} catch {
			rejectedNames = true;
		}
		check(rejectedNames && postCount === 0, 'complete ensure input rejected before any create');
		window.fetch = original;
		const tagConnectionResponse = await original('/api/v1/targets/connections', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'tag owner',
				type: 'SSH',
				host: 'localhost',
				port: 22,
				username: 'user',
				route: 'direct',
				proxyId: null,
				notes: null,
				tagIds: [],
				jumpIds: [],
			}),
		});
		check(tagConnectionResponse.status === 201, 'real connection created for tag relationships');
		const tagConnection = await tagConnectionResponse.json();
		await tags.setConnections(initialTag.id, [tagConnection.id, tagConnection.id]);
		let associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
		check(
			associated.tagIds.length === 1 &&
				associated.tagIds[0] === initialTag.id &&
				associated.version === tagConnection.version + 1,
			'real tag replacement merges duplicate IDs and advances connection CAS',
		);
		await failure(
			() => tags.setConnections(initialTag.id, [tagConnection.id, Number.MAX_SAFE_INTEGER]),
			'reference_not_found',
		);
		associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
		check(
			associated.tagIds.length === 1 && associated.version === tagConnection.version + 1,
			'real missing relationship refuses complete replacement atomically',
		);
		await tags.setConnections(initialTag.id, []);
		associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
		check(
			associated.tagIds.length === 0 && associated.version === tagConnection.version + 2,
			'real empty tag replacement clears associations',
		);
		await tags.setConnections(initialTag.id, [tagConnection.id]);
		const managerVisible = ref(true);
		let groupChanged = 0;
		const manager = mount(TagManager, {}, () =>
			h(TagManager, {
				visible: managerVisible.value,
				tag: renamedTag,
				connections: [associated],

				onClose: () => {
					managerVisible.value = false;
				},

				onChanged: () => {
					groupChanged += 1;
				},
			}),
		);
		try {
			await nextTick();
			const groupName = document.querySelector(
				'input[aria-label="' + i18n.global.t('workspaceConnectionList.manageTags.tagName') + '"]',
			);
			groupName.value = 'UI renamed tag';
			groupName.dispatchEvent(new Event('input', { bubbles: true }));
			await nextTick();
			[...document.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('tags.renameOnly'))
				.click();
			await until(() => tags.items.some((tag) => tag.name === 'UI renamed tag'));
			check(
				groupChanged === 0 && managerVisible.value,
				'real formal tag rename is a separate action from relationship replacement',
			);
			[...document.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('tags.saveAssociations'))
				.click();
			await until(() => dialogs.state.visible);
			dialogs.accept();
			await until(() => !managerVisible.value);
			associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
			check(
				groupChanged === 1 && associated.tagIds.length === 0 && !useConnectionsStore(pinia).loaded,
				'real formal group replacement confirms success and invalidates connection cache',
			);
		} finally {
			manager.close();
		}

		const latestTag = tags.items.find((tag) => tag.id === initialTag.id);
		let deleteDispatches = 0;
		window.fetch = (url, options) => {
			if (String(url).endsWith(`/tags/${initialTag.id}`) && options?.method === 'DELETE') {
				deleteDispatches += 1;
			}
			return original(url, options);
		};
		const cancellingManager = mount(TagManager, { visible: true, tag: latestTag, connections: [] });
		await nextTick();
		[...document.querySelectorAll('button')]
			.find((button) => button.textContent.trim() === i18n.global.t('common.delete'))
			.click();
		await until(() => dialogs.state.visible);
		cancellingManager.close();
		await nextTick();
		check(
			!dialogs.state.visible && deleteDispatches === 0,
			'tag group unmount cancels own delete confirmation without dispatch',
		);
		window.fetch = original;

		let relationDispatches = 0;
		window.fetch = (url, options) => {
			if (String(url).endsWith(`/tags/${initialTag.id}/connections`) && options?.method === 'PUT') {
				relationDispatches += 1;
				return Promise.resolve(response({ code: 'operation_unknown' }, 503));
			}
			return original(url, options);
		};
		const recoveryManager = mount(TagManager, { visible: true, tag: latestTag, connections: [] });
		try {
			await nextTick();
			[...document.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('tags.saveAssociations'))
				.click();
			await until(() => dialogs.state.visible);
			dialogs.accept();
			await until(() => tags.needsRefresh);
			await tags.load(true);
			await nextTick();
			const retryButton = [...document.querySelectorAll('button')].find(
				(button) => button.textContent.trim() === i18n.global.t('tags.saveAssociations'),
			);
			retryButton.click();
			check(
				retryButton.disabled && relationDispatches === 1 && !useConnectionsStore(pinia).loaded,
				'tag-only refresh cannot unlock an unknown relationship write in the old panel',
			);
		} finally {
			recoveryManager.close();
			window.fetch = original;
		}

		for (const mismatch of [
			{ ...latestTag, id: latestTag.id + 1000, version: latestTag.version + 1 },
			{ ...latestTag, version: latestTag.version + 2 },
		]) {
			window.fetch = (url, options) =>
				String(url).endsWith(`/tags/${initialTag.id}`) && options?.method === 'PUT'
					? Promise.resolve(response({ status: 'updated', value: mismatch }))
					: original(url, options);
			await failure(() => tags.rename(latestTag, 'unrelated response'), 'protocol_failure');
			check(
				tags.needsRefresh && tags.items.find((tag) => tag.id === initialTag.id).version === latestTag.version,
				'tag rename rejects unrelated resource or revision',
			);
			window.fetch = original;
			await tags.load(true);
		}

		const selectedTags = ref([]);
		const picker = mount(TagPicker, { modelValue: selectedTags.value }, () =>
			h(TagPicker, {
				modelValue: selectedTags.value,

				'onUpdate:modelValue': (value) => {
					selectedTags.value = value;
				},
			}),
		);
		try {
			await until(() => picker.node.querySelector('input') && !picker.node.querySelector('input').disabled);
			const input = picker.node.querySelector('input');
			input.value = 'formal picker tag';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await until(() => selectedTags.value.length === 1);
			check(
				tags.items.some((tag) => tag.id === selectedTags.value[0] && tag.name === 'formal picker tag'),
				'real formal picker creates and selects local mapped tag',
			);
			const preservedId = selectedTags.value[0];
			tags.reset();
			await nextTick();
			window.fetch = (url, options) =>
				String(url).endsWith('/tags') && options?.method === 'GET'
					? Promise.resolve(response({ code: 'storage_unavailable' }, 503))
					: original(url, options);
			[...picker.node.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('tags.refresh'))
				.click();
			await until(() => hasFeedback('tags.failures.failed'));
			check(
				selectedTags.value[0] === preservedId &&
					!picker.node.textContent.includes(i18n.global.t('tags.failures.unknown')),
				'failed or reset tag list preserves selected IDs and uses read failure feedback',
			);
			window.fetch = original;
			await tags.load(true);
			await tags.remove(preservedId);
			await nextTick();
			check(
				selectedTags.value.length === 0,
				'authoritative confirmed tag deletion clears stale picker selection',
			);
		} finally {
			picker.close();
		}

		let tagWrites = 0;
		window.fetch = async (url, options) => {
			if (String(url).endsWith('/tags') && options?.method === 'POST') {
				tagWrites += 1;
				const reply = await original(url, options);
				if (tagWrites === 2) {
					await reply.arrayBuffer();
					throw new TypeError('controlled lost acknowledgement');
				}
				return reply;
			}
			return original(url, options);
		};
		const unknownTags = await failure(
			() => tags.ensure(['partial first', 'partial second', 'never dispatched']),
			'request_failed',
		);
		await failure(() => tags.create('blocked replay'), 'recovery_required');
		check(
			unknownTags.outcome === 'unknown' &&
				tagWrites === 2 &&
				tags.items.some((tag) => tag.name === 'partial first') &&
				!tags.items.some((tag) => tag.name === 'partial second'),
			'partial ensure preserves confirmed items and stops on unknown without replay',
		);
		window.fetch = original;
		await tags.load(true);
		check(
			tags.items.some((tag) => tag.name === 'partial second') &&
				!tags.items.some((tag) => tag.name === 'never dispatched'),
			'real readback resolves partial ensure unknown result',
		);
		const { TagEnsureFailure } =
			await import('../../../../packages/frontend/src/features/tags/model/tag-errors.ts');
		let refusedCreates = 0;
		window.fetch = (url, options) => {
			if (String(url).endsWith('/tags') && options?.method === 'POST') {
				refusedCreates += 1;
				if (refusedCreates === 2) {
					return Promise.resolve(response({ code: 'conflict' }, 409));
				}
			}
			return original(url, options);
		};
		const partialRefusal = await failure(
			() => tags.ensure(['confirmed before refusal', 'refused name', 'skipped name']),
			'conflict',
		);
		check(
			partialRefusal instanceof TagEnsureFailure &&
				partialRefusal.completed === 1 &&
				partialRefusal.outcome === 'confirmed' &&
				refusedCreates === 2 &&
				tags.needsRefresh,
			'known partial creation has typed confirmed count and blocks group replay',
		);
		window.fetch = original;
		await tags.load(true);
		check(
			tags.items.some((tag) => tag.name === 'confirmed before refusal') &&
				!tags.items.some((tag) => tag.name === 'skipped name'),
			'real known partial creation readback preserves prior commit',
		);

		const safeTags = await tagsApi.list();
		for (const invalid of [
			[safeTags[0], safeTags[0]],
			[{ ...safeTags[0], updatedAt: safeTags[0].createdAt - 1 }],
			[{ ...safeTags[0], password: 'not public' }],
		]) {
			window.fetch = (url, options) =>
				String(url).endsWith('/tags') && options?.method === 'GET'
					? Promise.resolve(response(invalid))
					: original(url, options);
			await failure(() => tags.load(true), 'protocol_failure');
		}
		check(
			tags.needsRefresh && tags.items.length === safeTags.length,
			'tag collection rejects duplicate IDs, reversed timestamps and leaked fields without overwriting cache',
		);
		window.fetch = original;
		await tags.load(true);
		await tags.setConnections(initialTag.id, [tagConnection.id]);
		await tags.remove(initialTag.id);
		associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
		check(
			!associated.tagIds.includes(initialTag.id) &&
				!(await tagsApi.list()).some((tag) => tag.id === initialTag.id),
			'real tag delete removes associated references and local cache',
		);
		const deletedTagConnection = await original(`/api/v1/targets/connections/${tagConnection.id}`, {
			method: 'DELETE',
		});
		check(deletedTagConnection.status === 200, 'real tag fixture connection cleanup');
		for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
			await setLocale(locale);
			check(
				i18n.global.te('tags.failures.unknown', locale) && i18n.global.te('tags.saveAssociations', locale),
				'tag recovery and separate-operation labels translated: ' + locale,
			);
		}
	} finally {
		globalThis.fetch = original;
	}
	verify(checks.length).toBe(28);
});
