<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiSearchInput } from '@/foundation/ui';
	const { t } = useI18n();
	const search = defineModel<string>({ default: '' });
	defineProps<{ placeholder: string }>();
</script>

<template>
	<div class="min-w-0 space-y-3">
		<slot name="selection" />
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<UiSearchInput
				v-model="search"
				class="min-w-0 flex-1"
				:placeholder="placeholder"
				:aria-label="placeholder"
				:clear-label="t('common.clear')"
			/>
			<slot />
		</div>
	</div>
</template>
