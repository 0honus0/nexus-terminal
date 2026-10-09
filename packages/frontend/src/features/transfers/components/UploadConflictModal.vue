<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiConfirmationPanel } from '@/foundation/ui';
	const props = defineProps<{ visible: boolean; path?: string }>();
	const emit = defineEmits<{ resolve: [strategy: 'overwrite' | 'skip', applyToAll: boolean] }>();
	const { t } = useI18n();
	const all = ref(false);
	const filename = computed(() => props.path?.split(/[\/]/).filter(Boolean).at(-1) || props.path || '');
	watch(
		() => [props.visible, props.path] as const,
		([visible], previous) => {
			if (visible && (!previous || !previous[0] || previous[1] !== props.path)) all.value = false;
		},
	);
</script>
<template>
	<UiConfirmationPanel
		:visible="visible"
		:z-index="1200"
		:close-on-backdrop="false"
		:title="t('fileManager.uploadConflict.title')"
		:description="t('fileManager.uploadConflict.description')"
		tone="warning"
		icon="fas fa-triangle-exclamation"
	>
		<div class="ui-solid-inset mb-4 rounded-xl px-3 py-3">
			<div class="break-words font-medium" :title="filename">{{ filename }}</div>
			<div class="mt-1 break-all text-xs text-text-secondary">{{ path }}</div>
		</div>

		<label class="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
			<UiCheckbox v-model="all" />
			{{ t('fileManager.uploadConflict.applyToAll') }}
		</label>

		<template #actions>
			<UiButton type="button" appearance="soft" @click="emit('resolve', 'skip', all)">
				{{ t('fileManager.uploadConflict.skip') }}
			</UiButton>
			<UiButton type="button" appearance="solid" tone="danger" @click="emit('resolve', 'overwrite', all)">
				{{ t('fileManager.uploadConflict.overwrite') }}
			</UiButton>
		</template>
	</UiConfirmationPanel>
</template>
