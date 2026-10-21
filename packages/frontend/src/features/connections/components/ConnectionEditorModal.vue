<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiModal, UiSpinner } from '@/foundation/ui';
	import ConnectionForm from './ConnectionForm.vue';
	import { useConnectionEditor } from '../composables/use-connection-editor';
	import type { ConnectionSummary } from '../model/connection-types';
	const props = defineProps<{ visible: boolean; connection?: ConnectionSummary | null }>();
	const emit = defineEmits<{ close: []; saved: [connection: ConnectionSummary]; deleted: [id: number] }>();
	const { t } = useI18n();
	const { snapshot, credential, loading, ready, message, data, refresh, save, saveMany, saveCredential, remove } =
		useConnectionEditor(props, emit);
</script>
<template>
	<UiModal
		:visible="visible"
		:z-index="150"
		panel-class="ui-form-surface !max-w-3xl !max-h-[92dvh] !p-4 sm:!p-6 lg:!p-7"
		content-class="!overflow-hidden !py-0"
		@close="emit('close')"
	>
		<div v-if="loading && !ready" class="flex min-h-48 flex-col items-center justify-center gap-3">
			<UiSpinner />
			<p class="text-sm text-text-secondary">{{ t('common.loading') }}</p>
		</div>
		<div v-else-if="!ready" class="space-y-4 py-4">
			<p role="alert" class="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
				{{ message || t('connections.failures.recovery_required') }}
			</p>
			<div class="flex flex-wrap justify-end gap-2">
				<UiButton type="button" :disabled="loading" @click="refresh">
					{{ t('connections.refresh') }}
				</UiButton>
				<UiButton type="button" @click="emit('close')">{{ t('common.close') }}</UiButton>
			</div>
		</div>
		<div v-else class="space-y-3">
			<p v-if="message" role="status" class="rounded-md border border-border/60 px-3 py-2 text-sm">
				{{ message }}
			</p>
			<div
				v-if="data.needsRefresh.value"
				role="alert"
				class="flex flex-wrap items-center gap-3 rounded-md border border-warning/25 bg-warning/10 p-3 text-sm text-warning"
			>
				<span class="min-w-0 flex-1">{{ t('connections.failures.recovery_required') }}</span>
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
