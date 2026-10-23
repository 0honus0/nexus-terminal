<script setup lang="ts">
	import { filesystemFailureMessage } from '@/features/filesystem/public';
	import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiInlineLoading, UiInlineNotice, UiSpinner } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import ImagePreview from './ImagePreview.vue';
	import FilePreviewDialog from './FilePreviewDialog.vue';

	const MarkdownPreview = defineAsyncComponent({
		loader: () => import('./MarkdownPreview.vue'),

		loadingComponent: UiSpinner,
		delay: 120,
	});
	const PdfPreview = defineAsyncComponent({
		loader: () => import('./PdfPreview.vue'),

		loadingComponent: UiSpinner,
		delay: 120,
	});
	const SpreadsheetPreview = defineAsyncComponent({
		loader: () => import('./SpreadsheetPreview.vue'),

		loadingComponent: UiSpinner,
		delay: 120,
	});
	const DatabasePreview = defineAsyncComponent({
		loader: () => import('./DatabasePreview.vue'),

		loadingComponent: UiSpinner,
		delay: 120,
	});
	const DocxPreview = defineAsyncComponent({
		loader: () => import('./DocxPreview.vue'),

		loadingComponent: UiSpinner,
		delay: 120,
	});

	import { createFilePreviewSession, type FilePreviewSessionController } from '../composables/useFilePreviewTabs';
	import type { FilePreviewSource } from '../ports/file-preview-source';

	const props = defineProps<{
		source: FilePreviewSource;
		scopeId?: string;
		scopeLabel?: string;
		showScopeLabel?: boolean;
		session?: FilePreviewSessionController;
		spreadsheetRowsPerPage?: number;
		spreadsheetMaxColumns?: number;
	}>();
	const emit = defineEmits<{ edit: [path: string]; hide: []; dismiss: [] }>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const preview = props.session ?? createFilePreviewSession(props.source);
	const root = ref<HTMLElement | null>(null);
	const loadingTab = computed(() => (preview.active.value?.loading ? preview.active.value : null));

	const formatBytes = (bytes: number): string => {
		if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	};

	const previewError = (tab: (typeof preview.tabs.value)[number]): string => {
		if (!tab.error) return '';
		if (tab.error.type === 'tooLarge') {
			return t('fileManager.preview.fileTooLarge', { size: formatBytes(tab.error.maxBytes) });
		}
		return filesystemFailureMessage(tab.error.message, t);
	};

	const open = (path: string) =>
		preview.open(path, {
			scopeId: props.scopeId,
			scopeLabel: props.showScopeLabel ? props.scopeLabel : undefined,
			source: props.source,
		});

	const retry = async (tab: (typeof preview.tabs.value)[number]): Promise<void> => {
		try {
			await preview.refresh(tab);
		} catch {
			feedback.notifyError(t('fileManager.preview.refreshFailed'));
		}
	};

	const cancelLoading = (closeWorkspace: boolean): void => {
		const tab = loadingTab.value;
		if (!tab) return;
		preview.close(tab.id);
		if (closeWorkspace) emit('hide');
		else emit('dismiss');
	};

	const handleLoadingKeydown = (event: KeyboardEvent): void => {
		if (
			!loadingTab.value ||
			!root.value?.getClientRects().length ||
			event.defaultPrevented ||
			event.key !== 'Escape'
		)
			return;
		event.preventDefault();
		cancelLoading(false);
	};

	onMounted(() => document.addEventListener('keydown', handleLoadingKeydown));
	onBeforeUnmount(() => document.removeEventListener('keydown', handleLoadingKeydown));

	defineExpose({ open, close: preview.close, clear: preview.clear, refresh: preview.refresh });
</script>

<template>
	<section ref="root" class="relative flex h-full min-h-0 flex-col bg-background">
		<template v-for="tab in preview.tabs.value" :key="tab.id">
			<div v-show="preview.activeId.value === tab.id" class="absolute inset-0 min-h-0">
				<UiSpinner v-if="tab.loading" class="m-6" />
				<FilePreviewDialog
					v-else-if="tab.error"
					:file="{ name: tab.name, path: tab.path }"
					:session="preview"
					:active="preview.activeId.value === tab.id"
					@close="emit('hide')"
				>
					<div class="flex h-full min-h-[18rem] items-center justify-center p-6">
						<UiInlineNotice class="max-w-xl" tone="danger">
							<p class="m-0">{{ t('fileManager.preview.loadFailed') }}</p>
							<p class="mt-1 break-words text-xs opacity-80">{{ previewError(tab) }}</p>
							<template #actions>
								<UiButton
									appearance="soft"
									tone="danger"
									density="compact"
									:loading="tab.refreshing"
									@click="retry(tab)"
								>
									{{ t('common.retry') }}
								</UiButton>
							</template>
						</UiInlineNotice>
					</div>
				</FilePreviewDialog>
				<template v-else-if="tab.file">
					<ImagePreview
						v-if="tab.kind === 'image'"
						:file="tab.file"
						:session="preview"
						:active="preview.activeId.value === tab.id"
						@close="emit('hide')"
					/>
					<MarkdownPreview
						v-else-if="tab.kind === 'markdown'"
						:file="tab.file"
						:session="preview"
						:active="preview.activeId.value === tab.id"
						@open="open"
						@edit="emit('edit', tab.path)"
						@close="emit('hide')"
					/>
					<PdfPreview
						v-else-if="tab.kind === 'pdf'"
						:file="tab.file"
						:session="preview"
						:active="preview.activeId.value === tab.id"
						@close="emit('hide')"
					/>
					<SpreadsheetPreview
						v-else-if="tab.kind === 'spreadsheet'"
						:file="tab.file"
						:session="preview"
						:active="preview.activeId.value === tab.id"
						:rows-per-page="spreadsheetRowsPerPage"
						:max-columns="spreadsheetMaxColumns"
						@close="emit('hide')"
					/>
					<DatabasePreview
						v-else-if="tab.kind === 'database'"
						:file="tab.file"
						:session="preview"
						:active="preview.activeId.value === tab.id"
						@close="emit('hide')"
					/>
					<DocxPreview
						v-else-if="tab.kind === 'docx'"
						:file="tab.file"
						:session="preview"
						:active="preview.activeId.value === tab.id"
						@close="emit('hide')"
					/>
					<div v-else class="grid h-full place-items-center text-text-secondary">
						{{ t('fileManager.preview.unavailable') }}
					</div>
				</template>
			</div>
		</template>
		<div
			v-if="loadingTab"
			class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70"
			role="dialog"
			aria-modal="true"
			:aria-label="t('fileManager.preview.loading')"
			@click.self="cancelLoading(false)"
		>
			<div class="file-preview-loading-card ui-loading-shimmer">
				<UiInlineLoading density="default" :label="t('fileManager.preview.loading')" />
				<button
					type="button"
					class="flex h-11 w-11 items-center justify-center text-2xl leading-none hover:text-white/70 focus:outline-none focus:ring-1 focus:ring-white/70"
					:aria-label="t('fileManager.preview.close')"
					:title="t('fileManager.preview.close')"
					@click="cancelLoading(true)"
				>
					×
				</button>
			</div>
		</div>
		<UiEmptyState
			v-if="!preview.tabs.value.length"
			class="h-full"
			compact
			:bordered="false"
			icon="fa-regular fa-file-lines"
			:title="t('fileManager.preview.openFiles')"
		/>
	</section>
</template>

<style scoped>
	.file-preview-loading-card {
		--ui-text: #fff;
		--ui-text-muted: rgb(255 255 255 / 74%);
		--ui-tone-accent: #fff;
		display: flex;
		min-width: min(22rem, calc(100vw - 2rem));
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.7rem 0.85rem 0.7rem 1rem;
		border: 1px solid rgb(255 255 255 / 18%);
		border-radius: 0.75rem;
		background: linear-gradient(135deg, rgb(255 255 255 / 7%), transparent 62%), rgb(20 20 20 / 92%);
		box-shadow: 0 18px 42px -26px rgb(0 0 0 / 78%);
		color: #fff;
	}
</style>
