<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiTokenInput, type UiTokenOption } from '@/foundation/ui';
	import { useTagPicker } from '../composables/use-tag-picker';

	const model = defineModel<number[]>({ default: () => [] });
	const { data, pending, message, refresh, create, remove, updateSelection } = useTagPicker(model);
	const { t } = useI18n();
	const options = computed<UiTokenOption[]>(() => data.tags.value.map((tag) => ({ value: tag.id, label: tag.name })));
</script>

<template>
	<div class="space-y-2">
		<UiButton
			v-if="message || data.needsRefresh.value"
			type="button"
			:disabled="pending || data.busy.value"
			@click="refresh"
		>
			{{ t('tags.refresh') }}
		</UiButton>
		<UiTokenInput
			:model-value="model"
			@update:model-value="updateSelection"
			:disabled="pending || data.busy.value || data.needsRefresh.value"
			:options="options"
			:placeholder="t('tags.inputPlaceholder')"
			:remove-token-label="t('tags.removeSelection')"
			:delete-option-label="t('tags.deleteTagGlobally')"
			allow-custom
			allow-option-delete
			@create="create"
			@delete-option="remove($event.value)"
		/>
	</div>
</template>
