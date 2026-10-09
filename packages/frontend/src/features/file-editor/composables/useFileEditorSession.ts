import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { FileDocumentPort } from '../ports/file-document-port';
import type { EditorDocument, EditorLineEnding } from '../model/editor';
import { canonicalEditorEncoding } from '../model/editorEncoding';

export interface FileEditorOpenContext {
	scopeId?: string;
	scopeLabel?: string;
	port: FileDocumentPort;
}

export interface FileEditorSessionController {
	tabs: Ref<EditorDocument[]>;
	activeId: Ref<string | null>;
	active: ComputedRef<EditorDocument | null>;
	loading: Ref<boolean>;
	open(path: string, context?: FileEditorOpenContext): Promise<EditorDocument>;
	update(content: string): void;
	save(doc?: EditorDocument | null): Promise<void>;
	reload(id: string): Promise<void>;
	changeEncoding(id: string, encoding: string): Promise<void>;
	changeLineEnding(id: string, lineEnding: EditorLineEnding): void;
	updateScrollPosition(id: string, scrollTop: number, scrollLeft: number): void;
	setCloseConfirmation(confirm: () => Promise<boolean>): void;
	close(id: string): Promise<boolean>;
	closeOthers(id: string): Promise<boolean>;
	closeToRight(id: string): Promise<boolean>;
	closeToLeft(id: string): Promise<boolean>;
	closeAll(): Promise<boolean>;
	closeScope(scopeId: string): void;
	invalidatePaths(scopeId: string, paths: readonly string[]): boolean;
	activateRelative(delta: number): void;
}

export function createFileEditorSession(defaultPort?: FileDocumentPort): FileEditorSessionController {
	const tabs = ref<EditorDocument[]>([]);
	const activeId = ref<string | null>(null);
	const loading = ref(false);
	const ports = new Map<string, FileDocumentPort>();
	const savingDocuments = new Set<string>();
	let loadingOperations = 0;
	let openGeneration = 0;
	let closeEpoch = 0;
	const scopeGenerations = new Map<string | undefined, number>();

	let confirmClose = async (): Promise<boolean> => false;

	const unavailableDocuments = new Set<string>();
	const active = computed(() => tabs.value.find((item) => item.id === activeId.value) ?? null);

	const beginLoading = (): void => {
		loadingOperations += 1;
		loading.value = true;
	};

	const endLoading = (): void => {
		loadingOperations = Math.max(0, loadingOperations - 1);
		loading.value = loadingOperations > 0;
	};

	async function open(path: string, context?: FileEditorOpenContext): Promise<EditorDocument> {
		const generation = ++openGeneration;
		const scopeId = context?.scopeId;
		const scopeGeneration = scopeGenerations.get(scopeId) ?? 0;
		const epoch = closeEpoch;
		const existing = tabs.value.find((item) => item.path === path && item.scopeId === scopeId);
		if (existing) {
			activeId.value = existing.id;
			return existing;
		}
		const port = context?.port ?? defaultPort;
		if (!port) throw new Error('No document port is available for this file.');
		beginLoading();
		try {
			const loaded = await port.load(path);
			if (epoch !== closeEpoch || scopeGeneration !== (scopeGenerations.get(scopeId) ?? 0))
				throw new DOMException('Document scope was closed or changed.', 'AbortError');
			const loadedExisting = tabs.value.find((item) => item.path === path && item.scopeId === scopeId);
			if (loadedExisting) {
				if (generation === openGeneration || !activeId.value) activeId.value = loadedExisting.id;
				return loadedExisting;
			}
			const doc: EditorDocument = {
				id: crypto.randomUUID(),
				scopeId,
				scopeLabel: context?.scopeLabel,
				path,
				name: path.split('/').pop() || path,
				content: loaded.content,
				originalContent: loaded.content,
				encoding: canonicalEditorEncoding(loaded.encoding),
				dirty: false,
				saveState: 'idle',
				scrollTop: 0,
				scrollLeft: 0,
			};
			ports.set(doc.id, port);
			tabs.value.push(doc);
			if (generation === openGeneration || !activeId.value) activeId.value = doc.id;
			return doc;
		} finally {
			endLoading();
		}
	}

	function update(content: string): void {
		if (!active.value) return;
		const doc = active.value;
		doc.content = content;
		doc.dirty = content !== doc.originalContent;
		if (!savingDocuments.has(doc.id)) {
			doc.saveState = 'idle';
			doc.error = undefined;
		}
	}

	async function save(doc = active.value): Promise<void> {
		if (!doc) return;
		if (savingDocuments.has(doc.id)) return;
		const port = unavailableDocuments.has(doc.id) ? undefined : (ports.get(doc.id) ?? defaultPort);
		if (!port) {
			const error = new Error('The source session for this file is no longer available.');
			doc.saveState = 'error';
			doc.error = error.message;
			throw error;
		}
		const contentToSave = doc.content;
		const encodingToSave = doc.encoding;
		savingDocuments.add(doc.id);
		doc.saveState = 'saving';
		doc.error = undefined;
		try {
			await port.save(doc.path, contentToSave, encodingToSave);
			doc.originalContent = contentToSave;
			doc.dirty = doc.content !== contentToSave;
			doc.saveState = doc.dirty ? 'idle' : 'saved';
		} catch (cause) {
			doc.saveState = 'error';
			doc.error = cause instanceof Error ? cause.message : String(cause);
			throw cause;
		} finally {
			savingDocuments.delete(doc.id);
		}
	}

	async function reload(id: string): Promise<void> {
		const doc = tabs.value.find((item) => item.id === id);
		if (!doc) return;
		if (savingDocuments.has(doc.id)) return;
		const port = unavailableDocuments.has(doc.id) ? undefined : (ports.get(doc.id) ?? defaultPort);
		if (!port) throw new Error('The source session for this file is no longer available.');
		beginLoading();
		doc.error = undefined;
		try {
			const loaded = await port.load(doc.path);
			doc.content = loaded.content;
			doc.originalContent = loaded.content;
			doc.encoding = canonicalEditorEncoding(loaded.encoding);
			doc.dirty = false;
			doc.saveState = 'idle';
		} catch (cause) {
			doc.error = cause instanceof Error ? cause.message : String(cause);
			throw cause;
		} finally {
			endLoading();
		}
	}

	async function changeEncoding(id: string, encoding: string): Promise<void> {
		const doc = tabs.value.find((item) => item.id === id);
		if (!doc || !encoding || doc.encoding === encoding) return;
		if (savingDocuments.has(doc.id)) return;
		const port = unavailableDocuments.has(doc.id) ? undefined : (ports.get(doc.id) ?? defaultPort);
		if (!port) throw new Error('The source session for this file is no longer available.');
		beginLoading();
		doc.error = undefined;
		try {
			const loaded = await port.load(doc.path, encoding);
			doc.content = loaded.content;
			doc.originalContent = loaded.content;
			doc.encoding = canonicalEditorEncoding(loaded.encoding);
			doc.dirty = false;
			doc.saveState = 'idle';
		} catch (cause) {
			doc.error = cause instanceof Error ? cause.message : String(cause);
			throw cause;
		} finally {
			endLoading();
		}
	}

	function changeLineEnding(id: string, lineEnding: EditorLineEnding): void {
		const doc = tabs.value.find((item) => item.id === id);
		if (!doc) return;
		if (savingDocuments.has(doc.id)) return;
		const delimiter = lineEnding === 'crlf' ? '\r\n' : lineEnding === 'cr' ? '\r' : '\n';
		const normalized = doc.content.replace(/\r\n|\r|\n/g, '\n');
		const next = normalized.replace(/\n/g, delimiter);
		if (next === doc.content) return;
		doc.content = next;
		doc.dirty = next !== doc.originalContent;
		doc.saveState = 'idle';
		doc.error = undefined;
	}

	function updateScrollPosition(id: string, scrollTop: number, scrollLeft: number): void {
		const doc = tabs.value.find((item) => item.id === id);
		if (!doc) return;
		doc.scrollTop = Math.max(0, scrollTop);
		doc.scrollLeft = Math.max(0, scrollLeft);
	}

	function removeDocument(id: string): void {
		const index = tabs.value.findIndex((item) => item.id === id);
		if (index < 0) return;
		tabs.value.splice(index, 1);
		ports.delete(id);
		unavailableDocuments.delete(id);
		if (activeId.value === id) activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.id ?? null;
	}

	async function closeDocuments(documents: EditorDocument[]): Promise<boolean> {
		if (documents.some((doc) => savingDocuments.has(doc.id))) return false;
		const snapshots = documents.map((doc) => ({ id: doc.id, content: doc.content, dirty: doc.dirty }));
		if (documents.some((doc) => doc.dirty) && !(await confirmClose())) return false;
		if (
			documents.some((doc) => savingDocuments.has(doc.id)) ||
			snapshots.some((saved) => {
				const current = tabs.value.find((doc) => doc.id === saved.id);
				return current && (current.content !== saved.content || current.dirty !== saved.dirty);
			})
		)
			return false;
		for (const doc of documents) removeDocument(doc.id);
		return true;
	}

	function close(id: string): Promise<boolean> {
		return closeDocuments(tabs.value.filter((doc) => doc.id === id));
	}

	function closeOthers(id: string): Promise<boolean> {
		if (!tabs.value.some((item) => item.id === id)) return Promise.resolve(false);
		return closeDocuments(tabs.value.filter((tab) => tab.id !== id));
	}

	function closeToRight(id: string): Promise<boolean> {
		const index = tabs.value.findIndex((item) => item.id === id);
		return index < 0 ? Promise.resolve(false) : closeDocuments(tabs.value.slice(index + 1));
	}

	function closeToLeft(id: string): Promise<boolean> {
		const index = tabs.value.findIndex((item) => item.id === id);
		return index < 0 ? Promise.resolve(false) : closeDocuments(tabs.value.slice(0, index));
	}

	function closeAll(): Promise<boolean> {
		closeEpoch += 1;
		return closeDocuments([...tabs.value]);
	}

	function closeScope(scopeId: string): void {
		scopeGenerations.set(scopeId, (scopeGenerations.get(scopeId) ?? 0) + 1);
		for (const tab of [...tabs.value])
			if (tab.scopeId === scopeId) {
				if (tab.dirty || savingDocuments.has(tab.id)) {
					ports.delete(tab.id);
					unavailableDocuments.add(tab.id);
				} else removeDocument(tab.id);
			}
	}

	function activateRelative(delta: number): void {
		if (tabs.value.length <= 1 || !activeId.value) return;
		const index = tabs.value.findIndex((item) => item.id === activeId.value);
		if (index < 0) return;
		activeId.value = tabs.value[(index + delta + tabs.value.length) % tabs.value.length]!.id;
	}

	function invalidatePaths(scopeId: string, paths: readonly string[]): boolean {
		const documents = tabs.value.filter(
			(doc) =>
				doc.scopeId === scopeId &&
				paths.some((path) => doc.path === path || doc.path.startsWith(`${path.replace(/\/$/, '')}/`)),
		);
		if (documents.some((doc) => savingDocuments.has(doc.id))) return false;
		scopeGenerations.set(scopeId, (scopeGenerations.get(scopeId) ?? 0) + 1);
		for (const doc of documents) {
			ports.delete(doc.id);
			unavailableDocuments.add(doc.id);
		}
		return true;
	}

	return {
		tabs,
		activeId,
		active,
		loading,
		open,
		update,
		save,
		reload,
		changeEncoding,
		changeLineEnding,
		updateScrollPosition,
		close,

		setCloseConfirmation: (confirm) => {
			confirmClose = confirm;
		},

		closeOthers,
		closeToRight,
		closeToLeft,
		closeAll,
		closeScope,
		invalidatePaths,
		activateRelative,
	};
}

export const useFileEditorSession = createFileEditorSession;
