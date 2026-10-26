<script setup lang="ts">
	import { computed, nextTick, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import type { FilePreviewSessionController } from '../composables/useFilePreviewTabs';

	const props = withDefaults(
		defineProps<{
			file: { name: string; path: string };
			session: FilePreviewSessionController;
			subtitle?: string;
			active?: boolean;
		}>(),
		{ active: true, subtitle: undefined },
	);
	const emit = defineEmits<{ close: [] }>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const root = ref<HTMLElement | null>(null);

	const activeTab = computed(
		() => props.session.tabs.value.find((tab) => tab.id === props.session.activeId.value) ?? null,
	);
	const isRefreshing = computed(() => Boolean(activeTab.value?.refreshing));

	const activateTab = (tabId: string): void => {
		props.session.activate(tabId);
	};

	const closeTab = (event: MouseEvent, tabId: string): void => {
		event.stopPropagation();
		props.session.close(tabId);
		if (!props.session.tabs.value.length) emit('close');
	};

	const handleTabKeydown = (event: KeyboardEvent, tabId: string): void => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		activateTab(tabId);
	};

	const refreshCurrentTab = async (): Promise<void> => {
		if (!activeTab.value || isRefreshing.value) return;
		try {
			await props.session.refresh(activeTab.value);
		} catch {
			feedback.notifyError(t('fileManager.preview.refreshFailed'));
		}
	};

	const scrollActiveTabIntoView = (): void => {
		const activeId = props.session.activeId.value;
		if (!activeId || !root.value) return;
		const active = Array.from(root.value.querySelectorAll<HTMLElement>('[data-preview-tab-id]')).find(
			(element) => element.dataset.previewTabId === activeId,
		);
		active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
	};

	watch(
		() => [props.active, props.session.activeId.value] as const,
		([active]) => {
			if (active) void nextTick(scrollActiveTabIntoView);
		},
	);
</script>

<template>
	<section
		ref="root"
		data-file-preview-dialog
		class="file-preview-dialog relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground"
	>
		<div v-if="active" class="file-preview-header ui-glass-chrome">
			<div
				v-if="session.tabs.value.length"
				role="tablist"
				:aria-label="t('fileManager.preview.openFiles')"
				class="file-preview-tabs"
			>
				<div
					v-for="tab in session.tabs.value"
					:key="tab.id"
					role="tab"
					:aria-label="tab.name"
					:aria-selected="tab.id === session.activeId.value"
					:tabindex="tab.id === session.activeId.value ? 0 : -1"
					:title="tab.path"
					:data-preview-tab-id="tab.id"
					class="preview-tab"
					:class="{ active: tab.id === session.activeId.value }"
					@click="activateTab(tab.id)"
					@keydown="handleTabKeydown($event, tab.id)"
				>
					<span class="preview-tab-name">{{ tab.name }}</span>
					<UiButton
						appearance="ghost"
						density="compact"
						icon-only
						class="preview-tab-close"
						:aria-label="t('fileManager.preview.closeFile', { file: tab.name })"
						@click="closeTab($event, tab.id)"
					>
						<i class="fas fa-times" aria-hidden="true"></i>
					</UiButton>
				</div>
			</div>
			<div v-else class="file-preview-tabs"></div>
			<UiButton
				appearance="ghost"
				density="compact"
				icon-only
				class="preview-header-close"
				:aria-label="t('fileManager.preview.close')"
				:title="t('fileManager.preview.close')"
				@click="emit('close')"
			>
				<i class="fas fa-xmark" aria-hidden="true"></i>
			</UiButton>
		</div>

		<div class="min-h-0 flex-1 overflow-auto">
			<slot />
		</div>

		<footer v-if="active && activeTab" class="file-preview-footer ui-glass-chrome">
			<div class="file-preview-statusbar">
				<i class="fas fa-file-lines" aria-hidden="true"></i>
				<span class="file-preview-path" :title="activeTab.path">{{ activeTab.path }}</span>
				<span v-if="activeTab.scopeLabel" class="file-preview-scope" :title="activeTab.scopeLabel">{{
					activeTab.scopeLabel
				}}</span>
				<span v-if="subtitle" class="file-preview-kind">{{ subtitle }}</span>
			</div>
			<div class="file-preview-toolbar">
				<slot name="toolbar" />
				<UiButton
					appearance="soft"
					density="compact"
					icon-only
					class="preview-footer-action"
					:loading="isRefreshing"
					:disabled="isRefreshing"
					:aria-label="t('fileManager.preview.refresh')"
					:title="t('fileManager.preview.refresh')"
					@click="refreshCurrentTab"
				>
					<i class="fas fa-rotate" aria-hidden="true"></i>
				</UiButton>
			</div>
		</footer>
	</section>
</template>

<style scoped>
	.file-preview-dialog {
		container-type: inline-size;
		container-name: file-preview-dialog;
	}

	.file-preview-header {
		display: flex;
		min-height: 2rem;
		flex: 0 0 auto;
		align-items: stretch;
		border-bottom: 1px solid var(--border-color);
	}

	.file-preview-tabs {
		display: flex;
		min-width: 0;
		min-height: 2rem;
		flex: 1 1 auto;
		flex-wrap: nowrap;
		gap: 0.18rem;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.3rem 0.25rem 0 0.38rem;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--text-color) 20%, transparent) transparent;
		-webkit-overflow-scrolling: touch;
	}

	.file-preview-tabs::-webkit-scrollbar {
		height: 3px;
	}

	.file-preview-tabs::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-color) 20%, transparent);
	}

	.preview-tab {
		position: relative;
		display: flex;
		min-width: 0;
		max-width: 15rem;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.35rem 0.3rem 0.5rem;
		border: 1px solid transparent;
		border-bottom: 0;
		border-radius: 0.48rem 0.48rem 0 0;
		color: var(--text-color-secondary);
		font-size: 0.7rem;
		white-space: nowrap;
		cursor: pointer;
		scroll-snap-align: start;
		outline: none;
		transition:
			background-color 0.14s ease,
			color 0.14s ease,
			box-shadow 0.14s ease;
	}

	.preview-tab:hover,
	.preview-tab:focus-visible {
		background: color-mix(in srgb, var(--card-bg-color) 58%, transparent);
		color: var(--text-color);
	}

	.preview-tab.active {
		border-color: color-mix(in srgb, var(--border-color) 46%, transparent);
		background: color-mix(in srgb, var(--card-bg-color) 72%, transparent);
		color: var(--text-color);
		box-shadow: inset 0 -2px 0 var(--link-active-color);
	}

	.preview-tab-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preview-header-close {
		width: 2.125rem;
		height: 2.125rem;
		min-width: 2.125rem;
		flex: 0 0 2.125rem;
		margin: 0 0.55rem 0 0.2rem;
		align-self: center;
		--ui-control-padding-inline: 0;
		--ui-control-height: 2.125rem;
	}

	.preview-header-close i {
		font-size: 0.85rem;
	}

	.file-preview-footer {
		display: flex;
		min-width: 0;
		min-height: 2.75rem;
		flex: 0 0 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.6rem;
		padding: 0.3rem 0.55rem;
		border-top: 1px solid var(--border-color);
	}

	.file-preview-toolbar {
		display: flex;
		min-width: 0;
		max-width: 100%;
		flex: 0 1 auto;
		align-items: center;
		justify-content: flex-start;
		gap: 0.32rem;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding-block: 0.1rem;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--text-color) 20%, transparent) transparent;
		-webkit-overflow-scrolling: touch;
	}

	.file-preview-toolbar > :first-child {
		margin-left: auto;
	}

	.file-preview-toolbar::-webkit-scrollbar {
		height: 3px;
	}

	.file-preview-toolbar::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-color) 20%, transparent);
	}

	.file-preview-statusbar {
		display: flex;
		min-width: 0;
		min-height: 2rem;
		flex: 1 1 12rem;
		align-items: center;
		gap: 0.45rem;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 0.68rem;
		white-space: nowrap;
	}

	.file-preview-statusbar > i {
		flex: 0 0 auto;
		color: var(--link-active-color);
		font-size: 0.62rem;
	}

	.file-preview-path {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		color: var(--text-color);
		font-family: var(--font-family-monospace);
		text-overflow: ellipsis;
	}

	.file-preview-scope {
		max-width: 8rem;
		flex: 0 0 auto;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--link-active-color) 24%, var(--border-color));
		border-radius: 999px;
		padding: 0.1rem 0.42rem;
		color: color-mix(in srgb, var(--link-active-color) 78%, var(--text-color));
		text-overflow: ellipsis;
	}

	.file-preview-kind {
		max-width: 14rem;
		flex: 0 0 auto;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preview-tab-close {
		width: 1.35rem;
		height: 1.35rem;
		min-width: 1.35rem;
		flex: 0 0 1.35rem;
		opacity: 0.72;
	}

	.preview-tab-close:hover {
		opacity: 1;
	}

	.preview-footer-action {
		width: 2rem;
		height: 2rem;
		min-width: 2rem;
		flex: 0 0 2rem;
	}

	@container file-preview-dialog (max-width: 640px) {
		.file-preview-footer {
			gap: 0.25rem;
			padding: 0.3rem 0.5rem;
		}

		.file-preview-statusbar {
			flex-basis: 100%;
		}

		.file-preview-toolbar {
			width: 100%;
			flex-basis: 100%;
		}

		.preview-header-close {
			width: 2.75rem;
			height: 2.75rem;
			min-width: 2.75rem;
			flex-basis: 2.75rem;
		}
	}

	@container file-preview-dialog (max-width: 420px) {
		.file-preview-kind {
			display: none;
		}

		.preview-tab {
			max-width: 11rem;
			padding-inline: 0.45rem 0.3rem;
		}

		.preview-footer-action {
			width: 2.75rem;
			height: 2.75rem;
			min-width: 2.75rem;
			flex-basis: 2.75rem;
		}
	}
</style>
