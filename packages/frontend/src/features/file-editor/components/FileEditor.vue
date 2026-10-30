<script setup lang="ts">
	import { filesystemFailureMessage } from '@/features/filesystem/public';
	import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiContextMenu,
		UiContextMenuItem,
		UiEmptyState,
		UiLoadingState,
		UiSelect,
		UiSpinner,
	} from '@/foundation/ui';
	import { useDeviceCapabilities } from '@/foundation/browser';
	import { focusRegistry } from '@/shared/focus/public';
	import { useFeedback } from '@/shared/feedback/public';

	const loadMonacoEditor = () => import('./MonacoEditor.vue');

	const loadCodeMirrorMobileEditor = () => import('./CodeMirrorMobileEditor.vue');

	const MonacoEditor = defineAsyncComponent(loadMonacoEditor);
	const CodeMirrorMobileEditor = defineAsyncComponent(loadCodeMirrorMobileEditor);
	import { createFileEditorSession, type FileEditorSessionController } from '../composables/useFileEditorSession';
	import type { FileDocumentPort } from '../ports/file-document-port';
	import type { EditorLineEnding } from '../model/editor';

	const encodingOptions = [
		['utf-8', 'UTF-8'],
		['utf-16le', 'UTF-16 LE'],
		['utf-16be', 'UTF-16 BE'],
		['gbk', 'GBK'],
		['gb18030', 'GB18030'],
		['big5', 'Big5'],
		['shift_jis', 'Shift-JIS'],
		['euc-jp', 'EUC-JP'],
		['euc-kr', 'EUC-KR'],
		['iso-8859-1', 'ISO-8859-1'],
		['iso-8859-15', 'ISO-8859-15'],
		['cp1252', 'Windows-1252'],
		['iso-8859-2', 'ISO-8859-2'],
		['cp1250', 'Windows-1250'],
		['iso-8859-5', 'ISO-8859-5'],
		['cp1251', 'Windows-1251'],
		['koi8-r', 'KOI8-R'],
		['koi8-u', 'KOI8-U'],
		['iso-8859-7', 'ISO-8859-7'],
		['cp1253', 'Windows-1253'],
		['iso-8859-9', 'ISO-8859-9'],
		['cp1254', 'Windows-1254'],
		['iso-8859-8', 'ISO-8859-8'],
		['cp1255', 'Windows-1255'],
		['iso-8859-6', 'ISO-8859-6'],
		['cp1256', 'Windows-1256'],
		['iso-8859-4', 'ISO-8859-4'],
		['iso-8859-13', 'ISO-8859-13'],
		['cp1257', 'Windows-1257'],
		['cp1258', 'Windows-1258'],
		['tis-620', 'TIS-620'],
		['cp874', 'Windows-874'],
	] as const;

	const props = withDefaults(
		defineProps<{
			port: FileDocumentPort;
			scopeId?: string;
			scopeLabel?: string;
			showScopeLabel?: boolean;
			session?: FileEditorSessionController;
			fontSize?: number;
			mobileFontSize?: number;
			fontFamily?: string;
			showCloseButton?: boolean;
		}>(),
		{ fontSize: 14, mobileFontSize: 16, showCloseButton: false },
	);
	const emit = defineEmits<{ fontSize: [size: number]; mobileFontSize: [size: number]; close: [] }>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const device = useDeviceCapabilities();
	let localSession: FileEditorSessionController | undefined;

	const resolveSession = (): FileEditorSessionController =>
		props.session ?? (localSession ??= createFileEditorSession(props.port));

	const editorSession = new Proxy({} as FileEditorSessionController, {
		get(_target, property) {
			return Reflect.get(resolveSession(), property);
		},
	});
	const root = ref<HTMLElement | null>(null);
	type SearchableEditor = { focus?: () => void; openSearch?: () => void };
	const mobileEditor = ref<SearchableEditor | null>(null);
	const desktopEditor = ref<SearchableEditor | null>(null);
	const context = ref<{ id: string; x: number; y: number } | null>(null);
	let unregisterFocus: (() => void) | undefined;

	const LARGE_FILE_CHARACTER_THRESHOLD = 2 * 1024 * 1024;
	const content = computed({
		get: () => editorSession.active.value?.content ?? '',

		set: (value) => editorSession.update(value),
	});
	const largeFile = computed(() => content.value.length >= LARGE_FILE_CHARACTER_THRESHOLD);
	const selectedEncoding = computed(() => editorSession.active.value?.encoding ?? 'utf-8');
	const currentLineEnding = computed<EditorLineEnding>(() => {
		const value = editorSession.active.value?.content ?? '';
		if (value.includes('\r\n')) return 'crlf';
		if (value.includes('\r')) return 'cr';
		return 'lf';
	});
	const activePath = computed(() => editorSession.active.value?.path ?? '');
	const activePathName = computed(() => {
		const path = activePath.value;
		const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
		return separator >= 0 ? path.slice(separator + 1) || path : path;
	});
	const activePathDirectory = computed(() => {
		const path = activePath.value;
		const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
		return separator >= 0 ? path.slice(0, separator + 1) : '';
	});
	const saveDisabled = computed(() => {
		const active = editorSession.active.value;
		if (!active) return true;
		return (
			editorSession.loading.value || active.saveState === 'saving' || (!props.showCloseButton && !active.dirty)
		);
	});
	const closeDisabled = computed(() => editorSession.tabs.value.some((tab) => tab.saveState === 'saving'));
	const contextIndex = computed(() =>
		context.value ? editorSession.tabs.value.findIndex((tab) => tab.id === context.value!.id) : -1,
	);
	const contextCanCloseOthers = computed(() => contextIndex.value >= 0 && editorSession.tabs.value.length > 1);
	const contextCanCloseRight = computed(
		() => contextIndex.value >= 0 && contextIndex.value < editorSession.tabs.value.length - 1,
	);
	const contextCanCloseLeft = computed(() => contextIndex.value > 0);
	const contextSaving = computed(() => {
		const tabs = editorSession.tabs.value;
		const index = contextIndex.value;
		return {
			close: tabs[index]?.saveState === 'saving',
			others: tabs.some((tab, position) => position !== index && tab.saveState === 'saving'),
			right: tabs.some((tab, position) => position > index && tab.saveState === 'saving'),
			left: tabs.some((tab, position) => position < index && tab.saveState === 'saving'),
		};
	});

	const save = () => editorSession.save();

	const triggerSave = (): void => {
		void save().catch(() => undefined);
	};

	const openSearch = (): void => {
		if (!editorSession.active.value) return;
		if (device.isMobile.value) mobileEditor.value?.openSearch?.();
		else desktopEditor.value?.openSearch?.();
	};

	const confirmDiscardIfDirty = async (): Promise<boolean> => {
		if (!editorSession.active.value?.dirty) return true;
		return feedback.confirm({ message: t('fileEditor.confirmDiscardChanges') });
	};

	const reload = async (): Promise<void> => {
		const active = editorSession.active.value;
		if (!active || active.saveState === 'saving' || !(await confirmDiscardIfDirty())) return;
		const current = editorSession.active.value;
		if (!current || current.id !== active.id || current.saveState === 'saving') return;
		try {
			await editorSession.reload(active.id);
		} catch {
			return;
		}
	};

	editorSession.setCloseConfirmation(() => feedback.confirm({ message: t('fileEditor.confirmDiscardChanges') }));

	const changeEncoding = async (value: unknown): Promise<void> => {
		const active = editorSession.active.value;
		const encoding = typeof value === 'string' ? value : '';
		if (!active || !encoding || encoding === active.encoding || active.saveState === 'saving') {
			return;
		}
		if (!(await confirmDiscardIfDirty())) {
			return;
		}
		const current = editorSession.active.value;
		if (!current || current.id !== active.id || current.saveState === 'saving') {
			return;
		}
		try {
			await editorSession.changeEncoding(active.id, encoding);
		} catch {}
	};

	const changeLineEnding = (value: unknown): void => {
		const active = editorSession.active.value;
		if (!active || active.saveState === 'saving' || (value !== 'lf' && value !== 'crlf' && value !== 'cr')) return;
		editorSession.changeLineEnding(active.id, value);
	};

	const updateScrollPosition = (position: { scrollTop: number; scrollLeft: number }): void => {
		const active = editorSession.active.value;
		if (active) editorSession.updateScrollPosition(active.id, position.scrollTop, position.scrollLeft);
	};

	const open = (path: string) => {
		if (device.isMobile.value) void loadCodeMirrorMobileEditor().catch(() => undefined);
		else void loadMonacoEditor().catch(() => undefined);
		return editorSession.open(path, { scopeId: props.scopeId, scopeLabel: props.scopeLabel, port: props.port });
	};

	const openContext = (event: MouseEvent, id: string) => {
		event.preventDefault();
		context.value = { id, x: event.clientX, y: event.clientY };
	};

	const contextAction = (action: 'close' | 'others' | 'right' | 'left') => {
		const id = context.value?.id;
		context.value = null;
		if (!id) return;
		if (action === 'close') editorSession.close(id);
		else if (action === 'others') editorSession.closeOthers(id);
		else if (action === 'right') editorSession.closeToRight(id);
		else editorSession.closeToLeft(id);
	};

	const handleEditorKeydown = (event: KeyboardEvent) => {
		if (!root.value?.getClientRects().length) return;
		if (!event.altKey) return;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		if (editorSession.tabs.value.length <= 1) return;
		event.preventDefault();
		event.stopPropagation();
		editorSession.activateRelative(event.key === 'ArrowLeft' ? -1 : 1);
	};

	onMounted(() => {
		unregisterFocus = focusRegistry.register(
			'fileEditorActive',
			() => {
				if (!editorSession.active.value) return false;
				if (device.isMobile.value) mobileEditor.value?.focus?.();
				else desktopEditor.value?.focus?.();
				return true;
			},
			() => Boolean(root.value?.getClientRects().length && editorSession.active.value),
		);
		window.addEventListener('keydown', handleEditorKeydown, true);
	});
	onBeforeUnmount(() => {
		unregisterFocus?.();
		window.removeEventListener('keydown', handleEditorKeydown, true);
	});
	defineExpose({
		open,
		save,

		close: (id: string) => editorSession.close(id),

		focus: () => (device.isMobile.value ? mobileEditor.value?.focus?.() : desktopEditor.value?.focus?.()),
	});
</script>
<template>
	<section ref="root" class="file-editor-container" :class="{ 'has-close-button': showCloseButton }">
		<div class="file-editor-header ui-glass-chrome">
			<div class="file-editor-tabs" role="tablist">
				<div
					v-for="tab in editorSession.tabs.value"
					:key="tab.id"
					class="tab-item"
					:class="{ active: editorSession.activeId.value === tab.id }"
					:title="showScopeLabel && tab.scopeLabel ? `${tab.scopeLabel}: ${tab.path}` : tab.path"
					role="tab"
					:aria-selected="editorSession.activeId.value === tab.id"
					tabindex="0"
					@click="editorSession.activeId.value = tab.id"
					@keydown.enter.prevent="editorSession.activeId.value = tab.id"
					@keydown.space.prevent="editorSession.activeId.value = tab.id"
					@contextmenu="openContext($event, tab.id)"
				>
					<i class="fas fa-file-code tab-file-icon" aria-hidden="true"></i>
					<span class="tab-filename">{{ tab.name }}</span>
					<span v-if="tab.dirty" class="tab-modified-indicator" aria-hidden="true">●</span>
					<button
						type="button"
						class="close-tab-btn"
						:title="t('fileManager.actions.closeTab')"
						:aria-label="t('fileManager.actions.closeTab')"
						:disabled="tab.saveState === 'saving'"
						@click.stop="editorSession.close(tab.id)"
					>
						<i class="fas fa-xmark" aria-hidden="true"></i>
					</button>
				</div>
				<div v-if="!editorSession.tabs.value.length" class="no-tabs-placeholder"></div>
			</div>
			<UiButton
				v-if="showCloseButton"
				type="button"
				class="editor-close-button"
				appearance="ghost"
				density="compact"
				icon-only
				:title="t('fileManager.actions.closeEditor')"
				:aria-label="t('fileManager.actions.closeEditor')"
				:disabled="closeDisabled"
				@click="emit('close')"
			>
				<i class="fas fa-xmark" aria-hidden="true"></i>
			</UiButton>
		</div>

		<div class="editor-content-area">
			<UiLoadingState
				v-if="editorSession.loading.value"
				class="editor-loading"
				compact
				:bordered="false"
				:title="t('fileManager.loadingFile')"
			/>
			<template v-else-if="editorSession.active.value">
				<CodeMirrorMobileEditor
					v-if="device.isMobile.value"
					:key="editorSession.active.value.id"
					ref="mobileEditor"
					v-model="content"
					class="editor-instance"
					:path="editorSession.active.value.path"
					:font-size="mobileFontSize"
					:font-family="fontFamily"
					:large-file="largeFile"
					:scroll-top="editorSession.active.value.scrollTop"
					:scroll-left="editorSession.active.value.scrollLeft"
					@request-save="triggerSave"
					@font-size-change="emit('mobileFontSize', $event)"
					@update-scroll-position="updateScrollPosition"
				/>
				<MonacoEditor
					v-else
					:key="editorSession.active.value.id"
					ref="desktopEditor"
					v-model="content"
					class="editor-instance"
					:path="editorSession.active.value.path"
					:font-size="fontSize"
					:font-family="fontFamily"
					:large-file="largeFile"
					:initial-scroll-top="editorSession.active.value.scrollTop"
					:initial-scroll-left="editorSession.active.value.scrollLeft"
					@request-save="triggerSave"
					@font-size="emit('fontSize', $event)"
					@update-scroll-position="updateScrollPosition"
				/>
			</template>
			<UiEmptyState
				v-else
				class="editor-placeholder"
				compact
				:bordered="false"
				icon="fa-regular fa-file-lines"
				:title="t('fileManager.selectFileToEdit')"
			/>
		</div>

		<p v-if="editorSession.active.value?.error" class="editor-error">
			<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
			{{ filesystemFailureMessage(editorSession.active.value.error, t) }}
		</p>

		<footer v-if="editorSession.active.value" class="editor-footer ui-glass-chrome">
			<div v-if="editorSession.active.value" class="editor-footer-identity">
				<span class="editor-file-icon" aria-hidden="true">
					<i class="fas fa-file-lines"></i>
				</span>
				<span class="editor-path-label" :title="editorSession.active.value.path">
					<span v-if="activePathDirectory" class="editor-path-directory">{{ activePathDirectory }}</span>
					<span class="editor-path-name">{{ activePathName }}</span>
				</span>
				<span v-if="editorSession.active.value.dirty" class="editor-dirty-dot" aria-hidden="true"></span>
				<UiBadge
					v-if="showScopeLabel && editorSession.active.value.scopeLabel"
					class="editor-scope"
					density="compact"
					appearance="ghost"
				>
					{{ editorSession.active.value.scopeLabel }}
				</UiBadge>
			</div>

			<div v-if="editorSession.active.value" class="editor-footer-meta">
				<UiSelect
					:model-value="selectedEncoding"
					class="encoding-select"
					density="compact"
					text-align="center"
					fit-longest-option
					:title="t('fileManager.changeEncodingTooltip')"
					:disabled="editorSession.loading.value || editorSession.active.value.saveState === 'saving'"
					@update:model-value="changeEncoding"
				>
					<option v-for="option in encodingOptions" :key="option[0]" :value="option[0]">
						{{ option[1] }}
					</option>
				</UiSelect>
				<UiSelect
					:model-value="currentLineEnding"
					class="encoding-select line-ending-select"
					density="compact"
					match-trigger-width
					:title="t('fileEditor.lineEnding')"
					:disabled="editorSession.loading.value || editorSession.active.value.saveState === 'saving'"
					@update:model-value="changeLineEnding"
				>
					<option value="lf">{{ t('fileEditor.lineEndingLf') }}</option>
					<option value="crlf">{{ t('fileEditor.lineEndingCrlf') }}</option>
					<option value="cr">{{ t('fileEditor.lineEndingCr') }}</option>
				</UiSelect>
			</div>

			<div class="editor-actions">
				<template v-if="editorSession.active.value">
					<UiBadge
						v-if="editorSession.active.value.saveState === 'saving'"
						class="save-status"
						density="compact"
						appearance="ghost"
					>
						<UiSpinner density="compact" />
						<span>{{ t('fileManager.saving') }}</span>
					</UiBadge>
					<UiBadge
						v-else-if="editorSession.active.value.saveState === 'saved'"
						class="save-status"
						tone="success"
						density="compact"
						role="status"
					>
						<i class="fas fa-check" aria-hidden="true"></i>
						<span>{{ t('fileManager.saveSuccess') }}</span>
					</UiBadge>
					<UiBadge
						v-else-if="editorSession.active.value.saveState === 'error'"
						class="save-status"
						tone="danger"
						density="compact"
						role="alert"
					>
						<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
						<span>{{ t('fileManager.saveError') }}</span>
					</UiBadge>

					<UiButton
						type="button"
						class="editor-action-button"
						appearance="ghost"
						density="compact"
						icon-only
						:title="t('fileManager.preview.search')"
						:aria-label="t('fileManager.preview.search')"
						@click="openSearch"
					>
						<i class="fas fa-search" aria-hidden="true"></i>
					</UiButton>
					<UiButton
						type="button"
						class="editor-action-button"
						appearance="ghost"
						density="compact"
						icon-only
						:title="t('fileEditor.refreshRemote')"
						:aria-label="t('fileEditor.refreshRemote')"
						:disabled="editorSession.loading.value || editorSession.active.value.saveState === 'saving'"
						@click="reload"
					>
						<i class="fas fa-rotate-right" aria-hidden="true"></i>
					</UiButton>
					<UiButton
						type="button"
						class="editor-action-button editor-save-button"
						appearance="solid"
						tone="primary"
						density="compact"
						:aria-label="t('fileManager.actions.save')"
						:disabled="saveDisabled"
						@click="triggerSave"
					>
						<i class="fas fa-floppy-disk" aria-hidden="true"></i>
						<span class="editor-save-label">{{ t('fileManager.actions.save') }}</span>
					</UiButton>
				</template>
			</div>
		</footer>

		<UiContextMenu :visible="Boolean(context)" :x="context?.x ?? 0" :y="context?.y ?? 0" @close="context = null">
			<UiContextMenuItem :disabled="contextSaving.close" @click="contextAction('close')">
				<i class="fas fa-xmark" aria-hidden="true"></i>
				<span>{{ t('fileEditor.contextMenu.close') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem
				v-if="contextCanCloseOthers"
				:disabled="contextSaving.others"
				@click="contextAction('others')"
			>
				<i class="fas fa-xmarks-lines" aria-hidden="true"></i>
				<span>{{ t('fileEditor.contextMenu.closeOthers') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem
				v-if="contextCanCloseRight"
				:disabled="contextSaving.right"
				@click="contextAction('right')"
			>
				<i class="fas fa-arrow-right" aria-hidden="true"></i>
				<span>{{ t('fileEditor.contextMenu.closeRight') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem v-if="contextCanCloseLeft" :disabled="contextSaving.left" @click="contextAction('left')">
				<i class="fas fa-arrow-left" aria-hidden="true"></i>
				<span>{{ t('fileEditor.contextMenu.closeLeft') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>
	</section>
</template>

<style scoped>
	.file-editor-container {
		--editor-bg: color-mix(in srgb, var(--app-bg-color, #212529) 88%, #0d0f12);
		--editor-chrome-raised: color-mix(in srgb, var(--card-bg-color, #2b3035) 72%, transparent);
		--editor-chrome-hover: color-mix(
			in srgb,
			var(--card-bg-color, #2b3035) 94%,
			var(--link-active-color, #a06cd5) 6%
		);
		--editor-border: color-mix(in srgb, var(--border-color, #495057) 46%, transparent);
		--editor-text: var(--text-color, #e9ecef);
		--editor-muted: var(--text-color-secondary, #adb5bd);
		--editor-accent: var(--link-active-color, #bd8cff);
		container-type: size;
		container-name: file-editor-pane;
		display: flex;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
		border-radius: inherit;
		background: var(--editor-bg);
		color: var(--editor-text);
	}

	.file-editor-header {
		display: flex;
		min-height: 2rem;
		flex: none;
		align-items: stretch;
		border-bottom: 1px solid var(--editor-border);
	}

	.file-editor-tabs {
		display: flex;
		min-width: 0;
		min-height: 2rem;
		flex: 1 1 auto;
		flex-wrap: nowrap;
		gap: 0.18rem;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.3rem 0.25rem 0 0.38rem;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--text-color) 20%, transparent) transparent;
	}

	.file-editor-tabs::-webkit-scrollbar {
		height: 3px;
	}

	.file-editor-tabs::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-color) 20%, transparent);
	}

	.editor-close-button {
		flex: none;
		align-self: center;
		width: 2.125rem;
		height: 2.125rem;
		margin: 0 0.85rem 0 0.14rem;
		--ui-control-padding-inline: 0;
		--ui-control-height: 2.125rem;
	}

	.editor-close-button i {
		font-size: 0.85rem;
	}

	.no-tabs-placeholder {
		min-height: 2rem;
		flex: 1;
	}

	.tab-item {
		position: relative;
		display: flex;
		min-width: 0;
		max-width: 15rem;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.35rem 0.3rem 0.5rem;
		border: 1px solid transparent;
		border-bottom: 0;
		border-radius: 0.48rem 0.48rem 0 0;
		color: var(--editor-muted);
		font-size: 0.7rem;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 0.14s ease,
			color 0.14s ease,
			box-shadow 0.14s ease;
	}

	.tab-item:hover {
		background: var(--editor-chrome-hover);
		color: var(--editor-text);
	}

	.tab-item.active {
		border-color: var(--editor-border);
		background: var(--editor-chrome-raised);
		color: var(--editor-text);
		box-shadow: inset 0 -2px 0 var(--editor-accent);
	}

	.tab-file-icon {
		flex: none;
		color: color-mix(in srgb, var(--editor-accent) 72%, var(--editor-muted));
		font-size: 0.62rem;
	}

	.tab-filename {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab-modified-indicator {
		flex: none;
		color: var(--editor-accent);
		font-size: 0.5rem;
	}

	.close-tab-btn {
		display: grid;
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
		place-items: center;
		margin-left: 0.05rem;
		padding: 0;
		border: 0;
		border-radius: 0.28rem;
		background: transparent;
		color: var(--editor-muted);
		font-size: 0.62rem;
		cursor: pointer;
		transition:
			background-color 0.14s ease,
			color 0.14s ease;
	}

	.close-tab-btn:hover,
	.close-tab-btn:focus-visible {
		background: rgb(255 255 255 / 9%);
		color: var(--editor-text);
		outline: none;
	}

	.close-tab-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.editor-footer-identity {
		display: flex;
		min-width: 8rem;
		flex: 1 1 16rem;
		align-items: center;
		gap: 0.35rem;
		overflow: hidden;
	}

	.editor-file-icon {
		display: grid;
		width: 1.55rem;
		height: 1.55rem;
		flex: none;
		place-items: center;
		border: 1px solid var(--editor-border);
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--editor-chrome-raised) 82%, transparent);
		color: color-mix(in srgb, var(--editor-accent) 75%, var(--editor-text));
		font-size: 0.65rem;
	}

	.editor-path-label {
		display: flex;
		min-width: 0;
		align-items: baseline;
		overflow: hidden;
		white-space: nowrap;
	}

	.editor-path-directory {
		min-width: 0;
		overflow: hidden;
		color: var(--editor-muted);
		text-overflow: ellipsis;
		font-family: var(--font-family-monospace);
		font-size: 0.65rem;
	}

	.editor-path-name {
		flex: none;
		color: var(--editor-text);
		font-family: var(--font-family-monospace);
		font-size: 0.68rem;
		font-weight: 600;
	}

	.editor-dirty-dot {
		width: 0.32rem;
		height: 0.32rem;
		flex: none;
		margin-left: 0.32rem;
		border-radius: 50%;
		background: var(--editor-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--editor-accent) 12%, transparent);
	}

	.editor-scope {
		max-width: 7rem;
		overflow: hidden;
		flex: none;
		text-overflow: ellipsis;
	}

	.editor-actions {
		display: flex;
		min-width: 0;
		flex: 0 1 auto;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
		margin-left: auto;
	}

	.editor-footer {
		display: flex;
		min-width: 0;
		flex: none;
		flex-wrap: nowrap;
		align-items: center;
		overflow: hidden;
		gap: 0.6rem;
		padding: 0.4rem 0.55rem;
		border-top: 1px solid var(--editor-border);
	}

	.file-editor-container.has-close-button .editor-footer {
		padding-right: 2.25rem;
	}

	.editor-footer-meta {
		display: flex;
		min-width: 0;
		flex: 0 1 auto;
		align-items: center;
		gap: 0.35rem;
	}

	.encoding-select {
		flex: none;
	}

	.line-ending-select {
		width: 3.8rem;
		max-width: 3.8rem;
		flex-basis: 3.8rem;
	}

	.save-status {
		flex: none;
		gap: 0.28rem;
	}

	.save-status :deep(.ui-spinner) {
		--ui-spinner-size: 10px;
	}

	.editor-action-button {
		flex: 0 0 auto;
		--ui-control-padding-inline: 8px;
	}

	.editor-save-button {
		white-space: nowrap;
	}

	.editor-save-button i {
		font-size: 0.65rem;
	}

	.editor-content-area {
		position: relative;
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1 1 auto;
		flex-direction: column;
		overflow: hidden;
		background: var(--editor-bg);
	}

	.editor-instance {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		flex: 1 1 auto;
	}

	.editor-loading,
	.editor-placeholder {
		flex: 1;
		justify-content: center;
		padding: 1rem;
		color: var(--editor-muted);
		font-size: 0.72rem;
		text-align: center;
	}

	.editor-placeholder {
		color: color-mix(in srgb, var(--editor-muted) 76%, transparent);
	}

	.editor-loading :deep(.ui-spinner) {
		--ui-spinner-size: 13px;
		--ui-tone-accent: color-mix(in srgb, var(--editor-accent) 80%, var(--editor-text));
	}

	.editor-error {
		display: flex;
		margin: 0;
		flex: none;
		align-items: center;
		gap: 0.35rem;
		padding: 0.32rem 0.6rem;
		border-top: 1px solid color-mix(in srgb, var(--status-error-color) 28%, transparent);
		background: color-mix(in srgb, var(--status-error-color) 12%, var(--editor-bg));
		color: color-mix(in srgb, var(--status-error-color) 64%, var(--editor-text));
		font-size: 0.65rem;
	}

	@container file-editor-pane (max-width: 560px) {
		.editor-footer {
			gap: 0.28rem;
			padding: 0.35rem 0.45rem;
		}

		.file-editor-container.has-close-button .editor-footer {
			padding-right: 0.45rem;
		}

		.editor-footer-identity {
			flex-basis: 8rem;
		}

		.editor-footer-meta {
			flex: 0 0 auto;
		}

		.line-ending-select {
			width: 3.5rem;
			max-width: 3.5rem;
			flex-basis: 3.5rem;
		}
	}

	@container file-editor-pane (max-width: 420px) {
		.tab-item {
			max-width: 11rem;
			padding-inline: 0.45rem 0.3rem;
		}

		.line-ending-select {
			width: 3.1rem;
			max-width: 3.1rem;
			flex-basis: 3.1rem;
		}

		.save-status span {
			display: none;
		}

		.save-status {
			padding-inline: 0.28rem;
		}

		.editor-path-directory {
			display: none;
		}

		.editor-footer-identity {
			min-width: 0;
			flex: 1 1 4.5rem;
		}

		.editor-path-label,
		.editor-path-name {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.editor-actions {
			flex: 0 0 auto;
		}

		.editor-save-label {
			display: none;
		}

		.editor-save-button {
			--ui-control-padding-inline: 0;
			width: 1.8rem;
		}

		.editor-file-icon {
			width: 1.35rem;
			height: 1.35rem;
		}

		.editor-scope {
			max-width: 4.5rem;
		}
	}

	@container file-editor-pane (max-width: 220px) and (max-height: 240px) {
		.file-editor-tabs {
			min-height: 1.7rem;
		}

		.tab-item {
			padding-block: 0.18rem;
		}

		.editor-footer-identity {
			display: none;
		}

		.editor-footer {
			justify-content: center;
			padding: 0.25rem;
		}

		.editor-footer-meta {
			display: none;
		}

		.editor-actions {
			width: auto;
			justify-content: center;
		}
	}

	@container file-editor-pane (max-height: 240px) {
		.file-editor-tabs {
			min-height: 1.75rem;
		}

		.tab-item {
			padding-block: 0.2rem;
		}

		.editor-footer {
			padding-block: 0.25rem;
		}
	}
</style>
