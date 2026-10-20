<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiSelect } from '@/foundation/ui';
	import type { ManagedApp } from '../model/app-management-types';
	import type { ManagedMemory, MemoryImportConfirmation } from '../model/memory-types';
	import {
		confirmManagedMemoryImport,
		getManagedMemory,
		previewManagedMemoryImport,
	} from '../api/memory-management-api';
	import { AgentManagementFailure } from '../model/management-failure';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import { formatAgentDateTime } from '../locale-format';
	import MemorySourcePicker from './MemorySourcePicker.vue';

	const props = defineProps<{ appId: string; apps: ManagedApp[] }>();
	const emit = defineEmits<{ imported: [] }>();
	const { t, locale } = useI18n();
	const sourceAppId = ref('');
	const sourceMemoryId = ref('');
	const source = ref<ManagedMemory | null>(null);
	const preview = ref<MemoryImportConfirmation | null>(null);
	const unknown = ref(false);
	const operation = useAgentManagementOperation(() => {
		sourceAppId.value = '';
		sourceMemoryId.value = '';
		source.value = null;
		preview.value = null;
		unknown.value = false;
	});
	const sourceApps = computed(() => props.apps.filter((app) => app.id !== props.appId));

	async function prepare(): Promise<void> {
		if (operation.busy.value || preview.value || unknown.value) {
			return;
		}
		const appId = sourceAppId.value;
		const memoryId = sourceMemoryId.value;
		await operation.execute(
			async (signal) => {
				const source = await getManagedMemory(appId, memoryId, signal);
				if (source.status !== 'published') {
					throw new AgentManagementFailure('invalid_input', 'not_dispatched');
				}
				const confirmation = await previewManagedMemoryImport(props.appId, source, signal);
				if (confirmation.sourceVersion !== source.version) {
					throw new AgentManagementFailure('version_conflict', 'confirmed');
				}
				return { source, confirmation };
			},
			(value) => {
				source.value = value.source;
				preview.value = value.confirmation;
			},
			{ write: false },
		);
	}

	async function confirm(): Promise<void> {
		if (operation.busy.value || operation.refreshRequired.value || preview.value === null || unknown.value) {
			return;
		}
		const confirmation = preview.value;
		// Confirmation is single-use, without replay semantics. Keep its allocated memory ID for read-only recovery.
		unknown.value = true;
		await operation.execute(
			(signal) => confirmManagedMemoryImport(props.appId, confirmation, signal),
			() => {
				preview.value = null;
				source.value = null;
				unknown.value = false;
				emit('imported');
			},
			{ write: true },
		);
		if (preview.value === confirmation && operation.notice.value !== 'unknown') {
			unknown.value = false;
		}
	}

	async function checkResult(): Promise<void> {
		if (preview.value === null) {
			return;
		}
		const memoryId = preview.value.memoryId;
		await operation.execute(
			(signal) => getManagedMemory(props.appId, memoryId, signal),
			() => {
				preview.value = null;
				source.value = null;
				unknown.value = false;
				emit('imported');
			},
			{ write: false },
		);
	}

	function discard(): void {
		if (operation.busy.value || unknown.value) {
			return;
		}
		preview.value = null;
		source.value = null;
	}
</script>
<template>
	<div class="space-y-3 border-t border-border/60 pt-5">
		<h4 class="text-sm font-semibold text-foreground">{{ t('agent.settings.memoryManagement.import') }}</h4>
		<p class="text-sm text-text-secondary">{{ t('agent.settings.memoryManagement.importHelp') }}</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="unknown" class="text-sm text-warning">{{ t('agent.settings.memoryManagement.importUnknown') }}</p>
		<fieldset :disabled="operation.busy.value || preview !== null || unknown" class="space-y-3">
			<label class="block text-xs text-text-secondary"
				>{{ t('agent.settings.memoryManagement.sourceApp')
				}}<UiSelect
					v-model="sourceAppId"
					class="mt-1 w-full"
					:disabled="operation.busy.value || preview !== null || unknown"
					@update:model-value="sourceMemoryId = ''"
				>
					<option value="">{{ t('agent.settings.appManagement.chooseApp') }}</option>
					<option v-for="app in sourceApps" :key="app.id" :value="app.id">
						{{ app.name }}
					</option>
				</UiSelect></label
			>
			<MemorySourcePicker
				v-if="sourceAppId"
				:key="sourceAppId"
				:app-id="sourceAppId"
				:selected-id="sourceMemoryId"
				:disabled="operation.busy.value || preview !== null || unknown"
				@select="(id) => (sourceMemoryId = id)"
			/>
			<UiButton type="button" :disabled="!sourceAppId || !sourceMemoryId" @click="prepare">{{
				t('agent.settings.memoryManagement.preview')
			}}</UiButton>
		</fieldset>
		<template v-if="preview && source">
			<p class="whitespace-pre-wrap break-words text-sm">{{ source.content }}</p>
			<p class="text-[11px] text-text-secondary">
				{{
					t('agent.settings.memoryManagement.confirmationExpires', {
						date: formatAgentDateTime(locale, new Date(preview.expiresAt)),
					})
				}}
			</p>
			<UiButton
				type="button"
				:disabled="operation.busy.value || operation.refreshRequired.value || unknown"
				@click="confirm"
				>{{ t('agent.settings.memoryManagement.confirmImport') }}</UiButton
			>
			<UiButton type="button" :disabled="operation.busy.value || unknown" @click="discard">{{
				t('common.cancel')
			}}</UiButton>
			<UiButton type="button" :disabled="operation.busy.value" @click="checkResult">{{
				t('agent.settings.memoryManagement.checkImport')
			}}</UiButton>
		</template>
	</div>
</template>
