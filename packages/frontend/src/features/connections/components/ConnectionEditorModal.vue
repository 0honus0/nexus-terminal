<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiModal } from '@/foundation/ui';
	import ConnectionForm from './ConnectionForm.vue';
	import { useConnectionEditor } from '../composables/use-connection-editor';
	import type { ConnectionSummary } from '../model/connection-types';
	const props = defineProps<{ visible: boolean; connection?: ConnectionSummary | null }>();
	const emit = defineEmits<{ close: []; saved: [connection: ConnectionSummary]; deleted: [id: number] }>();
	const { t } = useI18n();
	const {
		snapshot,
		credential,
		loading,
		ready,
		message,
		receipts,
		data,
		refresh,
		save,
		saveMany,
		saveCredential,
		remove,
	} = useConnectionEditor(props, emit);
</script>
<template>
	<UiModal
		:visible="visible"
		:z-index="150"
		panel-class="ui-form-surface !max-w-3xl !max-h-[92dvh] !p-4 sm:!p-6 lg:!p-7"
		content-class="!overflow-hidden !py-0"
		@close="emit('close')"
	>
		<p v-if="message" role="status" class="my-3">{{ message }}</p>
		<ol v-if="receipts.length" class="my-3 max-h-48 overflow-y-auto" aria-live="polite">
			<li v-for="item in receipts" :key="item.index">
				#{{ item.index }}:
				{{
					item.status === 'ok'
						? `${t('connections.saved')} (${item.id})`
						: t('connections.failures.' + item.code)
				}}
			</li>
		</ol>
		<UiButton :disabled="loading" @click="refresh">{{ t('connections.refresh') }}</UiButton>
		<p v-if="data.needsRefresh.value" class="my-2 text-text-secondary">
			{{ t('connections.failures.recovery_required') }}
		</p>
		<ConnectionForm
			v-if="visible && ready"
			:connection="snapshot"
			:credential="credential"
			:loading="loading || data.needsRefresh.value"
			@submit="save"
			@submit-many="saveMany"
			@credential="saveCredential"
			@cancel="emit('close')"
			@delete="remove"
		/>
		<UiButton v-else @click="emit('close')">{{ t('common.close') }}</UiButton>
	</UiModal>
</template>
