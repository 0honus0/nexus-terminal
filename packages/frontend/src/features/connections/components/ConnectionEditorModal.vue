<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiLoadingState, UiModal } from '@/foundation/ui';
	import ConnectionForm from './ConnectionForm.vue';
	import { useConnectionEditor } from '../composables/use-connection-editor';
	import type { ConnectionSummary } from '../model/connection-types';
	const props = defineProps<{ visible: boolean; connection?: ConnectionSummary | null }>();
	const emit = defineEmits<{ close: []; saved: [connection: ConnectionSummary]; deleted: [id: number] }>();
	const { t } = useI18n();
	const { snapshot, credential, loading, ready, data, refresh, save, saveMany, saveCredential, remove } =
		useConnectionEditor(props, emit);
</script>
<template>
	<UiModal
		:visible="visible"
		:z-index="150"
		panel-class="ui-form-surface !max-w-3xl !p-4 sm:!p-6 lg:!p-7"
		:panel-style="{ height: 'min(760px, calc(100dvh - 2rem))', maxHeight: 'calc(100dvh - 2rem)' }"
		content-class="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !py-0"
		@close="emit('close')"
	>
		<UiLoadingState
			v-if="loading && !ready"
			class="min-h-48"
			compact
			:bordered="false"
			:title="t('common.loading')"
		/>
		<div v-else-if="!ready" class="space-y-4 py-4">
			<div class="flex flex-wrap justify-end gap-2">
				<UiButton type="button" :disabled="loading" @click="refresh">
					{{ t('connections.refresh') }}
				</UiButton>
				<UiButton type="button" @click="emit('close')">{{ t('common.close') }}</UiButton>
			</div>
		</div>
		<div v-else class="flex min-h-0 flex-1 flex-col gap-3">
			<div v-if="data.needsRefresh.value" class="flex justify-end">
				<UiButton type="button" density="compact" :disabled="loading" @click="refresh">
					{{ t('connections.refresh') }}
				</UiButton>
			</div>
			<ConnectionForm
				:connection="snapshot"
				:credential="credential"
				:loading="loading || data.needsRefresh.value"
				@submit="save"
				@submit-many="saveMany"
				@credential="saveCredential"
				@cancel="emit('close')"
				@delete="remove"
			/>
		</div>
	</UiModal>
</template>
