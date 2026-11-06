<script setup lang="ts">
	import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiSearchInput } from '@/foundation/ui';
	import { ownsDocumentKeyboardEvent } from '@/shared/focus/public';

	const props = withDefaults(
		defineProps<{
			open: boolean;
			query: string;
			current: number;
			total: number;
			active?: boolean;
			busy?: boolean;
		}>(),
		{
			active: true,
			busy: false,
		},
	);

	const emit = defineEmits<{
		open: [];
		close: [];
		'update:query': [value: string];
		previous: [];
		next: [];
	}>();

	const { t } = useI18n();
	const inputRef = ref<{ focus?: (options?: FocusOptions) => void; select?: () => void } | null>(null);

	const buttonRef = ref<InstanceType<typeof UiButton> | null>(null);
	const controlsRef = ref<HTMLElement | null>(null);
	let mounted = false;
	let lifecycleActive = true;
	let listening = false;
	let focusRevision = 0;

	const available = (): boolean => {
		const element = controlsRef.value ?? buttonRef.value?.$el;
		return (
			mounted &&
			lifecycleActive &&
			props.active &&
			element instanceof HTMLElement &&
			element.getClientRects().length > 0
		);
	};

	const focus = () => {
		const revision = ++focusRevision;
		void nextTick(() => {
			if (revision !== focusRevision || !props.open || !available()) return;
			inputRef.value?.focus?.({ preventScroll: true });
			inputRef.value?.select?.();
		});
	};

	const handleDocumentKeydown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || !available()) return;
		const element = controlsRef.value ?? buttonRef.value?.$el;
		const scope = element instanceof HTMLElement ? element.closest('[data-document-keyboard-scope]') : null;
		if (scope instanceof HTMLElement && !ownsDocumentKeyboardEvent(scope, event)) return;

		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			emit('open');
			focus();
			return;
		}

		if (props.open && event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			emit('close');
		}
	};

	const handleInputKeydown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || !available()) return;
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

	const syncListener = (): void => {
		const shouldListen = mounted && lifecycleActive && props.active;
		if (shouldListen === listening) return;
		listening = shouldListen;
		if (listening) document.addEventListener('keydown', handleDocumentKeydown, true);
		else document.removeEventListener('keydown', handleDocumentKeydown, true);
	};

	watch(
		() => [props.open, props.active] as const,
		([open, active]) => {
			focusRevision++;
			syncListener();
			if (open && active) focus();
		},
		{ flush: 'sync' },
	);

	onMounted(() => {
		mounted = true;
		syncListener();
	});
	onActivated(() => {
		lifecycleActive = true;
		syncListener();
	});
	onDeactivated(() => {
		lifecycleActive = false;
		focusRevision++;
		syncListener();
	});
	onBeforeUnmount(() => {
		mounted = false;
		focusRevision++;
		syncListener();
	});

	defineExpose({ focus });
</script>

<template>
	<UiButton
		v-if="!props.open"
		ref="buttonRef"
		type="button"
		appearance="soft"
		density="compact"
		icon-only
		class="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
		:aria-label="t('fileManager.preview.search', 'Search in document')"
		:title="t('fileManager.preview.search', 'Search in document')"
		@click="emit('open')"
	>
		<i class="fas fa-search" aria-hidden="true"></i>
	</UiButton>

	<div
		v-else
		ref="controlsRef"
		class="preview-search-controls flex h-9 max-w-[min(72vw,22rem)] items-center gap-1 rounded-lg border border-border bg-background px-1 shadow-sm sm:h-8"
	>
		<UiSearchInput
			ref="inputRef"
			:model-value="props.query"
			:placeholder="t('fileManager.preview.searchPlaceholder', 'Search document...')"
			:aria-label="t('fileManager.preview.search', 'Search in document')"
			:clear-label="t('common.clear')"
			density="compact"
			class="preview-search-input flex-1"
			@update:model-value="emit('update:query', $event)"
			@keydown="handleInputKeydown"
		/>
		<span class="min-w-10 shrink-0 text-center text-[11px] tabular-nums text-text-alt" aria-live="polite">
			<template v-if="props.busy">…</template>
			<template v-else-if="props.query.trim()"
				>{{ props.total > 0 ? Math.max(1, props.current) : 0 }}/{{ props.total }}</template
			>
		</span>
		<UiButton
			type="button"
			appearance="ghost"
			density="compact"
			icon-only
			class="preview-search-action h-7 w-7 shrink-0 text-xs"
			:disabled="props.busy || props.total === 0"
			:aria-label="t('fileManager.preview.searchPrevious', 'Previous match')"
			:title="t('fileManager.preview.searchPrevious', 'Previous match')"
			@click="emit('previous')"
		>
			<i class="fas fa-chevron-up" aria-hidden="true"></i>
		</UiButton>
		<UiButton
			type="button"
			appearance="ghost"
			density="compact"
			icon-only
			class="preview-search-action h-7 w-7 shrink-0 text-xs"
			:disabled="props.busy || props.total === 0"
			:aria-label="t('fileManager.preview.searchNext', 'Next match')"
			:title="t('fileManager.preview.searchNext', 'Next match')"
			@click="emit('next')"
		>
			<i class="fas fa-chevron-down" aria-hidden="true"></i>
		</UiButton>
		<UiButton
			type="button"
			appearance="ghost"
			density="compact"
			icon-only
			class="preview-search-action h-7 w-7 shrink-0 self-center text-xs leading-none"
			:aria-label="t('fileManager.preview.searchClose', 'Close search')"
			:title="t('fileManager.preview.searchClose', 'Close search')"
			@click="emit('close')"
		>
			<i class="fas fa-times" aria-hidden="true"></i>
		</UiButton>
	</div>
</template>

<style scoped>
	.preview-search-input {
		min-width: 6rem;
	}
	@container file-preview-dialog (max-width: 640px) {
		.preview-search-controls {
			--preview-search-touch-layout: grid;
			--preview-search-action-size: 44px;
			--preview-search-width: 100%;
		}
	}

	@media (pointer: coarse) {
		.preview-search-controls {
			--preview-search-touch-layout: grid;
			--preview-search-action-size: 44px;
			--preview-search-width: 100%;
		}
	}

	.preview-search-controls {
		flex-shrink: 0;
		display: var(--preview-search-touch-layout, flex);
		grid-template-columns: minmax(0, 1fr) repeat(3, var(--preview-search-action-size, 28px));
		width: var(--preview-search-width, auto);
		min-width: var(--preview-search-width, 16rem);
		max-width: var(--preview-search-width, min(72vw, 22rem));
		height: auto;
		min-height: 2rem;
	}

	.preview-search-input {
		grid-column: 1 / -1;
	}

	.preview-search-action {
		width: var(--preview-search-action-size, 28px);
		height: var(--preview-search-action-size, 28px);
	}
</style>
