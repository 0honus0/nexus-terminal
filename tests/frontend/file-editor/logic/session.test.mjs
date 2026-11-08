// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test } from 'vitest';

test('editor and preview preserve draft revisions, stale read/save fencing and original close ownership', async () => {
	const { createFileEditorSession } =
		await import('../../../../packages/frontend/src/features/file-editor/public.ts');
	const { createFilePreviewSession } =
		await import('../../../../packages/frontend/src/features/file-preview/public.ts');
	const checks = [];

	const check = (condition, name) => {
		if (!condition) throw new Error(name);
		checks.push(name);
	};

	const rejected = (task) =>
		task.then(
			() => false,
			() => true,
		);

	const loaded = (content) => ({ path: '/file', content, encoding: 'utf-8' });

	const reads = [];
	const writes = [];
	let saveCalls = 0;
	const port = {
		load: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),

		save: () => {
			saveCalls += 1;
			return new Promise((resolve, reject) => writes.push({ resolve, reject }));
		},
	};
	const editor = createFileEditorSession(port);
	const opening = editor.open('/file', { scopeId: 'original', port });
	reads.shift().resolve(loaded('initial'));
	await opening;
	const original = editor.active.value;
	const first = rejected(editor.reload(original.id));
	const second = editor.changeEncoding(original.id, 'utf-16le');
	const firstRead = reads.shift();
	reads.shift().resolve({ path: '/file', content: 'latest read', encoding: 'utf-16le' });
	await second;
	firstRead.resolve(loaded('old read'));
	check(await first, 'superseded read rejects');
	check(original.content === 'latest read' && original.encoding === 'utf-16le', 'latest encoding read wins');
	const duringEdit = rejected(editor.reload(original.id));
	editor.update('new draft');
	reads.shift().resolve(loaded('remote old'));
	check(await duringEdit, 'read invalidated by editing rejects');
	check(original.content === 'new draft' && original.dirty, 'late read preserves new draft');
	const saving = editor.save();
	editor.update('typed while saving');
	writes.shift().resolve();
	await saving;
	check(
		original.originalContent === 'new draft' && original.dirty,
		'save confirms original snapshot and preserves subsequent typing',
	);
	const lateReload = rejected(editor.reload(original.id));
	editor.closeScope('original');
	reads.shift().resolve(loaded('late closed scope'));
	check(await lateReload, 'scope closure invalidates in-flight read');
	check(
		editor.tabs.value.length === 1 && original.content === 'typed while saving',
		'ordinary closure retains copyable draft',
	);
	check(await rejected(editor.save()), 'retained draft cannot write to disconnected scope');
	editor.reset();
	check(editor.tabs.value.length === 0 && editor.active.value === null, 'reset discards revoked draft');
	const staleCalls = saveCalls;
	check(await rejected(editor.save(original)), 'closed document cannot use default port');
	check(saveCalls === staleCalls, 'closed document dispatches no save');
	const oldOpen = rejected(editor.open('/old'));
	const oldRead = reads.shift();
	editor.reset();
	const newOpen = editor.open('/new');
	oldRead.resolve(loaded('revoked bytes'));
	check(await oldOpen, 'late open after reset rejects');
	check(editor.loading.value, 'old finally preserves new loading');
	reads.shift().resolve(loaded('new identity'));
	await newOpen;
	check(
		editor.tabs.value.length === 1 && editor.active.value.content === 'new identity' && !editor.loading.value,
		'only new document is published',
	);
	editor.update('in-flight save');
	const oldSave = rejected(editor.save());
	const oldDocument = editor.active.value;
	editor.reset();
	writes.shift().resolve();
	check(await oldSave, 'save completing after reset cannot confirm revoked document');
	check(
		editor.tabs.value.length === 0 && oldDocument.originalContent === 'new identity',
		'late save cannot republish or change original snapshot',
	);
	const nextOpen = editor.open('/next');
	reads.shift().resolve(loaded('next'));
	await nextOpen;
	const nextDocument = editor.active.value;
	const busySave = editor.save();
	check(!(await editor.closeAll()), 'close-all refuses saving document');
	writes.shift().resolve();
	await busySave;
	check(nextDocument.saveState === 'saved', 'refused close-all does not invalidate original save');
	const pendingOpen = rejected(editor.open('/pending'));
	const pendingRead = reads.shift();
	await editor.closeAll();
	pendingRead.resolve(loaded('closed'));
	check(await pendingOpen, 'close-all invalidates pending open');
	check(editor.tabs.value.length === 0 && !editor.loading.value, 'closed pending open cannot restore tabs');
	let previewReads = 0;
	let resolvePreview;
	let previewSignal;
	const preview = createFilePreviewSession({
		read: (_path, options) => {
			previewReads += 1;
			previewSignal = options.signal;
			return new Promise((resolve) => {
				resolvePreview = resolve;
			});
		},
	});
	const previewOpen = preview.open('/image.png');
	const oldPreview = preview.tabs.value[0];
	preview.clear();
	check(previewSignal.aborted, 'preview reset aborts original source');
	resolvePreview({ bytes: new ArrayBuffer(1) });
	await previewOpen;
	await preview.refresh(oldPreview);
	check(
		previewReads === 1 && preview.tabs.value.length === 0,
		'late preview and stale refresh do not restore or read old source',
	);
	assert.ok(checks.length >= 15);
});
