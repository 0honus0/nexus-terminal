<script setup lang="ts">
	import { nextTick, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiSearchInput } from '@/foundation/ui';

	const props = defineProps<{
		query: string;
		current: number;
		total: number;
	}>();

	const emit = defineEmits<{
		'update:query': [value: string];
		previous: [];
		next: [];
		close: [];
	}>();

	const { t } = useI18n();
	const inputRef = ref<{ focus?: (options?: FocusOptions) => void; select?: () => void } | null>(null);

	const resultLabel = () => {
		if (!props.query.trim()) return '';
		return props.total > 0 ? `${Math.max(1, props.current)}/${props.total}` : '0/0';
	};

	const focus = (): void => {
		void nextTick(() => {
			inputRef.value?.focus?.({ preventScroll: true });
			inputRef.value?.select?.();
		});
	};

	const handleInputKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (event.shiftKey) emit('previous');
			else emit('next');
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			emit('close');
		}
	};

	onMounted(focus);
	defineExpose({ focus });
</script>

<template>
	<div class="file-editor-search-bar" role="search">
		<UiSearchInput
			ref="inputRef"
			:model-value="props.query"
			:placeholder="t('fileManager.preview.searchPlaceholder', 'Search document...')"
			:aria-label="t('fileManager.preview.search', 'Search in document')"
			:clear-label="t('fileManager.preview.searchClose', 'Close search')"
			density="compact"
			class="file-editor-search-input"
			@update:model-value="emit('update:query', $event)"
			@keydown="handleInputKeydown"
		/>
		<span class="file-editor-search-count" aria-live="polite">{{ resultLabel() }}</span>
		<UiButton
			type="button"
			appearance="soft"
			density="compact"
			icon-only
			class="file-editor-search-action"
			:disabled="props.total === 0"
			:aria-label="t('fileManager.preview.searchPrevious', 'Previous match')"
			:title="t('fileManager.preview.searchPrevious', 'Previous match')"
			@click="emit('previous')"
		>
			<i class="fas fa-chevron-up" aria-hidden="true"></i>
		</UiButton>
		<UiButton
			type="button"
			appearance="soft"
			density="compact"
			icon-only
			class="file-editor-search-action"
			:disabled="props.total === 0"
			:aria-label="t('fileManager.preview.searchNext', 'Next match')"
			:title="t('fileManager.preview.searchNext', 'Next match')"
			@click="emit('next')"
		>
			<i class="fas fa-chevron-down" aria-hidden="true"></i>
		</UiButton>
		<UiButton
			type="button"
			appearance="soft"
			density="compact"
			icon-only
			class="file-editor-search-action"
			:aria-label="t('fileManager.preview.searchClose', 'Close search')"
			:title="t('fileManager.preview.searchClose', 'Close search')"
			@click="emit('close')"
		>
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
				<path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		</UiButton>
	</div>
</template>

<style scoped>
	.file-editor-search-bar {
		display: flex;
		min-width: 0;
		min-height: 2.35rem;
		flex: none;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
		padding: 0.28rem 0.55rem;
		border-bottom: 1px solid var(--editor-border);
		background: color-mix(in srgb, var(--editor-chrome) 88%, transparent);
		-webkit-backdrop-filter: var(--glass-backdrop-filter, blur(18px) saturate(160%));
		backdrop-filter: var(--glass-backdrop-filter, blur(18px) saturate(160%));
	}

	.file-editor-search-input {
		width: min(24rem, 100%);
		min-width: 0;
		flex: 0 1 24rem;
	}

	.file-editor-search-count {
		min-width: 2.6rem;
		flex: none;
		color: var(--editor-muted);
		font-size: 0.65rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.file-editor-search-action {
		flex: none;
		--ui-control-padding-inline: 0;
		--ui-control-height: 1.75rem;
		width: 1.75rem;
	}

	.file-editor-search-action i {
		font-size: 0.65rem;
	}

	.file-editor-search-action svg {
		display: block;
		width: 0.75rem;
		height: 0.75rem;
	}

	@media (max-width: 420px) {
		.file-editor-search-bar {
			gap: 0.22rem;
			padding-inline: 0.4rem;
		}

		.file-editor-search-input {
			flex-basis: auto;
			flex-grow: 1;
		}

		.file-editor-search-count {
			min-width: 2.1rem;
		}
	}
</style>
