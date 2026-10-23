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
		class="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground"
	>
		<div
			v-if="active && session.tabs.value.length"
			role="tablist"
			:aria-label="t('fileManager.preview.openFiles')"
			class="file-preview-tabs flex shrink-0 overflow-x-auto border-b border-border bg-header"
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
				class="group flex min-h-11 min-w-0 max-w-56 shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2 py-0 text-xs outline-none transition-colors focus:ring-1 focus:ring-inset focus:ring-primary sm:min-h-0 sm:gap-2 sm:px-3 sm:py-2"
				:class="
					tab.id === session.activeId.value
						? 'bg-background text-foreground'
						: 'bg-header text-text-secondary hover:bg-border/70 hover:text-foreground'
				"
				@click="activateTab(tab.id)"
				@keydown="handleTabKeydown($event, tab.id)"
			>
				<span class="min-w-0 flex-1 truncate">{{ tab.name }}</span>
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

		<header v-if="active" class="file-preview-toolbar flex shrink-0 items-center justify-end gap-2">
			<slot name="toolbar" />
			<UiButton
				appearance="soft"
				density="compact"
				icon-only
				class="preview-header-action"
				:loading="isRefreshing"
				:disabled="isRefreshing"
				:aria-label="t('fileManager.preview.refresh')"
				:title="t('fileManager.preview.refresh')"
				@click="refreshCurrentTab"
			>
				<i class="fas fa-rotate" aria-hidden="true"></i>
			</UiButton>
			<UiButton
				appearance="soft"
				density="compact"
				icon-only
				class="preview-header-action"
				:aria-label="t('fileManager.preview.close')"
				:title="t('fileManager.preview.close')"
				@click="emit('close')"
			>
				<i class="fas fa-times" aria-hidden="true"></i>
			</UiButton>
		</header>

		<div class="min-h-0 flex-1 overflow-auto">
			<slot />
		</div>

		<footer v-if="active && activeTab" class="file-preview-statusbar">
			<i class="fas fa-file-lines" aria-hidden="true"></i>
			<span class="file-preview-path" :title="activeTab.path">{{ activeTab.path }}</span>
			<span v-if="activeTab.scopeLabel" class="file-preview-scope" :title="activeTab.scopeLabel">{{
				activeTab.scopeLabel
			}}</span>
			<span v-if="subtitle" class="file-preview-kind">{{ subtitle }}</span>
		</footer>
	</section>
</template>

<style scoped>
	.file-preview-tabs {
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		-webkit-overflow-scrolling: touch;
	}

	.file-preview-tabs > [role='tab'] {
		scroll-snap-align: start;
	}

	.file-preview-toolbar {
		min-height: 2.75rem;
		padding: 0.35rem 0.65rem;
		border-bottom: 1px solid var(--border-color);
		background: color-mix(in srgb, var(--header-bg-color) 82%, transparent);
	}

	.file-preview-statusbar {
		display: flex;
		min-width: 0;
		min-height: 2.25rem;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.45rem;
		overflow: hidden;
		padding: 0.35rem 0.75rem;
		border-top: 1px solid var(--border-color);
		background: color-mix(in srgb, var(--header-bg-color) 82%, transparent);
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
		width: 44px;
		height: 44px;
		min-width: 44px;
		flex: 0 0 44px;
		opacity: 0.72;
	}

	.preview-header-action {
		width: 44px;
		height: 44px;
		min-width: 44px;
		flex: 0 0 44px;
	}

	@media (min-width: 640px) {
		.preview-tab-close,
		.preview-header-action {
			width: 32px;
			height: 32px;
			min-width: 32px;
			flex-basis: 32px;
		}
	}

	@media (max-width: 639px) {
		.file-preview-toolbar {
			min-height: 2.75rem;
		}

		.file-preview-kind {
			display: none;
		}

		.file-preview-statusbar {
			padding-inline: 0.55rem;
		}
	}
</style>
