<script setup lang="ts">
	import { computed, ref, toRaw } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import { attachManagedArtifact, detachManagedArtifact, getManagedArtifact } from '../api/artifact-management-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type { ManagedArtifact } from '../model/artifact-types';
	import type { ManagedApp } from '../model/app-management-types';

	const props = defineProps<{ artifact: ManagedArtifact; apps: ManagedApp[]; disabled: boolean }>();
	const emit = defineEmits<{ changed: [] }>();
	const { t } = useI18n();
	const snapshot = ref<ManagedArtifact | null>(null);
	const targetAppId = ref('');
	const threadId = ref('');
	const runId = ref('');
	const unknown = ref(false);
	const acknowledged = ref(false);
	const operation = useAgentManagementOperation(() => {
		snapshot.value = null;
		targetAppId.value = '';
		threadId.value = '';
		runId.value = '';
		unknown.value = false;
		acknowledged.value = false;
	});
	const blocked = computed(
		() =>
			props.disabled ||
			operation.busy.value ||
			operation.refreshRequired.value ||
			unknown.value ||
			snapshot.value === null,
	);

	async function read(): Promise<void> {
		if (props.disabled || operation.busy.value) {
			return;
		}
		await operation.execute(
			(signal) => getManagedArtifact(props.artifact.appId, props.artifact.id, signal),
			(value) => {
				snapshot.value = value;
			},
			{ write: false },
		);
	}

	async function mutate(action: 'attach' | 'detach'): Promise<void> {
		if (blocked.value || !snapshot.value || !threadId.value.trim()) {
			return;
		}
		const original = structuredClone(toRaw(snapshot.value));
		const thread = threadId.value.trim();
		const target = { appId: targetAppId.value, threadId: thread, runId: runId.value.trim() || null };
		await operation.execute(
			async (signal) =>
				action === 'attach'
					? (await attachManagedArtifact(original, target, signal)).artifact
					: detachManagedArtifact(original, thread, signal),
			(value) => {
				snapshot.value = value;
				emit('changed');
			},
			{
				write: true,

				onFailure() {
					unknown.value = operation.notice.value === 'unknown';
				},
			},
		);
	}

	function newIntent(): void {
		if (props.disabled || operation.busy.value || operation.refreshRequired.value || !acknowledged.value) {
			return;
		}
		unknown.value = false;
		acknowledged.value = false;
	}
</script>
<template>
	<div class="space-y-2 rounded border border-border p-3">
		<h5 class="text-sm">{{ t('agent.artifactManagement.attachments') }}</h5>
		<p class="text-xs text-text-secondary">{{ t('agent.artifactManagement.attachmentHelp') }}</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<UiButton type="button" :disabled="disabled || operation.busy.value" @click="read">{{
			t('agent.artifactManagement.readAttachmentVersion')
		}}</UiButton>
		<p v-if="snapshot" class="text-xs">{{ snapshot.id }} · v{{ snapshot.version }}</p>
		<fieldset :disabled="blocked" class="space-y-2">
			<label class="block text-xs"
				>{{ t('agent.artifactManagement.targetApp')
				}}<select v-model="targetAppId" class="ml-2 rounded border border-border bg-background p-2">
					<option value="">{{ t('agent.settings.appManagement.chooseApp') }}</option>
					<option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }} · {{ app.id }}</option>
				</select></label
			>
			<label class="block text-xs"
				>{{ t('agent.artifactManagement.threadId')
				}}<input v-model="threadId" class="ml-2 rounded border border-border bg-background p-2"
			/></label>
			<label class="block text-xs"
				>{{ t('agent.artifactManagement.runId')
				}}<input v-model="runId" class="ml-2 rounded border border-border bg-background p-2"
			/></label>
			<UiButton
				type="button"
				:disabled="!targetAppId || !threadId.trim() || snapshot?.status !== 'ready'"
				@click="mutate('attach')"
				>{{ t('agent.artifactManagement.attach') }}</UiButton
			>
			<UiButton type="button" :disabled="!threadId.trim()" @click="mutate('detach')">{{
				t('agent.artifactManagement.detach')
			}}</UiButton>
		</fieldset>
		<template v-if="unknown">
			<p class="text-xs text-warning">{{ t('agent.artifactManagement.attachmentUnknown') }}</p>
			<UiCheckbox v-model="acknowledged">{{ t('agent.artifactManagement.acknowledgeAttachment') }}</UiCheckbox>
			<UiButton
				type="button"
				:disabled="disabled || operation.busy.value || operation.refreshRequired.value || !acknowledged"
				@click="newIntent"
				>{{ t('agent.artifactManagement.newAttachmentIntent') }}</UiButton
			>
		</template>
	</div>
</template>
