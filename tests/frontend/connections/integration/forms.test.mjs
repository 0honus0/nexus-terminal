import { test, expect } from 'vitest';
import { h, ref, nextTick } from 'vue';
import { openTargetPanel } from '../../targets/support/panel.mjs';
import Editor from '../../../../packages/frontend/src/features/connections/components/ConnectionEditorModal.vue';
import { useConnectionsStore } from '../../../../packages/frontend/src/features/connections/store/connections.store.ts';
import { connectionsApi } from '../../../../packages/frontend/src/features/connections/api/connections-api.ts';
import { useTagsStore } from '../../../../packages/frontend/src/features/tags/store/tags.store.ts';

test('connection forms create atomic credentials, edit by CAS and expand script/range imports with cache refresh', async () => {
	const { mount, until, fill, check, checks } = await openTargetPanel();
	const connections = useConnectionsStore();
	const tags = useTagsStore();
	await Promise.all([connections.load(), tags.load()]);

	const editorVisible = ref(true);
	const editor = mount(Editor, {}, () =>
		h(Editor, {
			visible: editorVisible.value,

			onClose: () => {
				editorVisible.value = false;
			},
		}),
	);
	await until(() => document.getElementById('conn-host') && !document.getElementById('conn-host').disabled);
	fill('conn-host', '127.0.0.1');
	fill('conn-username', 'user');
	fill('conn-name', 'formal connection');
	fill('conn-password', 'formal secret');
	await nextTick();
	document
		.querySelector('form.connection-form')
		.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await until(() => !editorVisible.value);
	editor.close();
	const formal = (await connectionsApi.list()).find((row) => row.name === 'formal connection');
	check(
		formal && (await connectionsApi.credential(formal.id)).credential.kind === 'password',
		'formal create form writes atomic metadata and credential',
	);
	const editingVisible = ref(true);
	const editingUi = mount(Editor, {}, () =>
		h(Editor, {
			visible: editingVisible.value,
			connection: formal,

			onClose: () => {
				editingVisible.value = false;
			},
		}),
	);
	await until(() => document.getElementById('conn-password') && !document.getElementById('conn-password').disabled);
	check(document.getElementById('conn-password').value === '', 'formal editor never populates stored secret');
	fill('conn-password', 'replacement secret');
	await nextTick();
	document
		.querySelector('form.connection-form')
		.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await until(() => !editingVisible.value);
	editingUi.close();
	check(
		(await connectionsApi.get(formal.id)).version === formal.version + 1,
		'formal save atomically advances metadata and credential CAS',
	);
	for (const mode of ['script', 'range']) {
		const visible = ref(true);
		const creation = mount(Editor, {}, () =>
			h(Editor, {
				visible: visible.value,

				onClose: () => {
					visible.value = false;
				},
			}),
		);
		await until(() => document.getElementById('conn-host') && !document.getElementById('conn-host').disabled);
		if (mode === 'script') {
			document.querySelector('button[role="switch"]').click();
			await nextTick();
			fill('conn-script-input', 'user@localhost -name "formal script" -p " secret " -tags "formal script tag"');
		} else {
			fill('conn-host', '192.168.50.1~192.168.50.3');
			fill('conn-name', 'formal range');
			fill('conn-username', 'user');
			fill('conn-password', 'range secret');
		}
		await nextTick();
		document
			.querySelector('form.connection-form')
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await until(() => !visible.value);
		creation.close();
		const count = (await connectionsApi.list()).filter((row) => row.name.startsWith('formal ' + mode)).length;
		check(count === (mode === 'script' ? 1 : 3), 'formal ' + mode + ' creates complete import intents');
	}
	check(
		tags.items.some((row) => row.name === 'formal script tag'),
		'script-created tags refresh their actual cache owner',
	);

	expect(checks).toHaveLength(6);
});
