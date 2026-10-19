<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInput, UiModal } from '@/foundation/ui';
	import { useHostKeyManagement } from '../composables/use-host-key-management';
	const props = defineProps<{ visible: boolean }>();
	const emit = defineEmits<{ close: [] }>();
	const { t } = useI18n();
	const { items, draft, loading, needsRefresh, message, canWrite, refresh, confirm, remove } = useHostKeyManagement(
		props,
		() => emit('close'),
	);
</script>
<template>
	<UiModal
		:visible="visible"
		:title="t('hostKeys.title')"
		:close-on-backdrop="false"
		panel-class="w-[calc(100vw-2rem)] max-w-3xl"
		@close="emit('close')"
	>
		<p class="mb-3 text-sm text-text-secondary">{{ t('hostKeys.warning') }}</p>
		<UiButton :disabled="loading" @click="refresh">{{ t('hostKeys.refresh') }}</UiButton>
		<p v-if="needsRefresh" class="mt-2 text-text-secondary">{{ t('hostKeys.failures.recovery_required') }}</p>
		<p v-if="message" role="status" class="my-3">{{ message }}</p>
		<ul class="my-4 space-y-3">
			<li
				v-for="item in items"
				:key="JSON.stringify([item.host, item.port])"
				class="rounded border border-border p-3"
			>
				<p class="break-all">{{ item.host }}:{{ item.port }}</p>
				<code class="block break-all">{{ item.fingerprint }}</code>
				<time class="block text-sm text-text-secondary">{{ new Date(item.confirmedAt).toLocaleString() }}</time>
				<UiButton tone="danger" :disabled="!canWrite" @click="remove(item)">{{
					t('hostKeys.remove')
				}}</UiButton>
			</li>
		</ul>
		<form class="space-y-3" @submit.prevent="confirm">
			<label class="block"
				>{{ t('hostKeys.host')
				}}<UiInput v-model="draft.host" :disabled="!canWrite" :aria-label="t('hostKeys.host')" required
			/></label>
			<label class="block"
				>{{ t('hostKeys.port')
				}}<UiInput
					v-model="draft.port"
					:disabled="!canWrite"
					:aria-label="t('hostKeys.port')"
					inputmode="numeric"
					required
			/></label>
			<label class="block"
				>{{ t('hostKeys.fingerprint')
				}}<UiInput
					v-model="draft.fingerprint"
					:disabled="!canWrite"
					:aria-label="t('hostKeys.fingerprint')"
					placeholder="SHA256:…"
					required
			/></label>
			<UiButton type="submit" :disabled="!canWrite">{{ t('hostKeys.confirm') }}</UiButton>
		</form>
		<template #footer>
			<UiButton @click="emit('close')">{{ t('common.close') }}</UiButton>
		</template>
	</UiModal>
</template>
