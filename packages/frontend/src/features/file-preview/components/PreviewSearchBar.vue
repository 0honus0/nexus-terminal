<script setup lang="ts">
	import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiSearchInput } from '@/foundation/ui';

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

	const focus = () => {
		void nextTick(() => {
			inputRef.value?.focus?.({ preventScroll: true });
			inputRef.value?.select?.();
		});
	};

	const handleDocumentKeydown = (event: KeyboardEvent) => {
		if (!props.active) return;

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

	watch(
		() => props.open,
		(open) => {
			if (open && props.active) focus();
		},
	);

	watch(
		() => props.active,
		(active) => {
			if (active && props.open) focus();
		},
	);

	onMounted(() => document.addEventListener('keydown', handleDocumentKeydown, true));
	onBeforeUnmount(() => document.removeEventListener('keydown', handleDocumentKeydown, true));

	defineExpose({ focus });
</script>

<template>
	<UiButton
		v-if="!props.open"
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
		class="flex h-9 min-w-0 max-w-[min(72vw,22rem)] items-center gap-1 rounded-lg border border-border bg-background px-1 shadow-sm sm:h-8"
	>
		<UiSearchInput
			ref="inputRef"
			:model-value="props.query"
			:placeholder="t('fileManager.preview.searchPlaceholder', 'Search document...')"
			:aria-label="t('fileManager.preview.search', 'Search in document')"
			:clear-label="t('fileManager.preview.searchClose', 'Close search')"
			density="compact"
			class="min-w-20 flex-1"
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
			class="h-7 w-7 shrink-0 text-xs"
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
			class="h-7 w-7 shrink-0 text-xs"
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
			class="h-7 w-7 shrink-0 self-center text-xs leading-none"
			:aria-label="t('fileManager.preview.searchClose', 'Close search')"
			:title="t('fileManager.preview.searchClose', 'Close search')"
			@click="emit('close')"
		>
			<i class="fas fa-times" aria-hidden="true"></i>
		</UiButton>
	</div>
</template>
