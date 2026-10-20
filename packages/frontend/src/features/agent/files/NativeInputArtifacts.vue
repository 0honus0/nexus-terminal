<script setup lang="ts">
	import type { ViewRevocation } from '@/shared/session/use-authenticated-view-scope';
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import ArtifactPicker from './ArtifactPicker.vue';
	import { attachManagedArtifact, getManagedArtifact } from '../api/artifact-management-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import { fromArtifact } from '../model/artifact-mapper';
	import { AgentManagementFailure } from '../model/management-failure';
	import type { ManagedArtifact } from '../model/artifact-types';
	import type { NativeArtifactReference } from '../model/native-input-types';

	const props = defineProps<{ appId: string; threadId: string; active: boolean; disabled: boolean }>();
	const emit = defineEmits<{
		ready: [value: boolean, references: NativeArtifactReference[]];
		working: [value: boolean];
	}>();
	const { t } = useI18n();
	const items = ref<ManagedArtifact[]>([]);
	const prepared = ref(false);
	const unknown = ref(false);
	const inspected = ref(false);
	const acknowledged = ref(false);

	function revoke(reason: ViewRevocation): void {
		const keep = reason === 'view' && unknown.value;
		const originals = keep ? items.value : [];
		items.value = [];
		prepared.value = false;
		unknown.value = false;
		inspected.value = false;
		acknowledged.value = false;
		if (keep) {
			items.value = originals;
			unknown.value = true;
		}
	}

	function onReadFailure(cause: unknown): void {
		if (
			cause instanceof AgentManagementFailure &&
			(cause.code === 'unauthenticated' || cause.code === 'forbidden')
		) {
			revoke('session');
			emit('ready', false, []);
		}
	}

	const operation = useAgentManagementOperation(revoke, () => props.active);

	const locked = computed(() => props.disabled || operation.busy.value || unknown.value);

	watch(
		() => items.value.map((item) => item.id + ':' + item.version).join('|'),
		() => {
			prepared.value = false;
		},
		{ flush: 'sync' },
	);
	watch(
		() => [prepared.value, items.value.length, unknown.value, props.active] as const,
		() => {
			const value = (prepared.value || items.value.length === 0) && !unknown.value;
			emit('ready', value, value ? items.value.map((item) => ({ id: item.id, name: item.name })) : []);
		},
		{ immediate: true, flush: 'post' },
	);
	watch(operation.busy, (value) => emit('working', value), { flush: 'sync' });

	async function read(): Promise<void> {
		if (props.disabled) return;
		const originals = items.value.map((item) => ({ appId: item.appId, id: item.id }));
		await operation.execute(
			(signal) => Promise.all(originals.map((item) => getManagedArtifact(item.appId, item.id, signal))),
			(values) => {
				items.value = values;
				inspected.value = unknown.value;
			},
			{ write: false, onFailure: onReadFailure },
		);
	}

	async function prepare(): Promise<void> {
		if (locked.value || operation.refreshRequired.value || !items.value.length) return;
		const originals = items.value.map(fromArtifact);
		unknown.value = true;
		emit('ready', false, []);
		await operation.execute(
			async (signal) => {
				const confirmed: ManagedArtifact[] = [];
				for (const item of originals) {
					// An explicit attachment precedes Run creation; it never grants artifacts.read.
					if (signal.aborted) throw new AgentManagementFailure('cancelled', 'not_dispatched');
					const result = await attachManagedArtifact(
						item,
						{ appId: props.appId, threadId: props.threadId, runId: null },
						signal,
					);
					confirmed.push(result.artifact);
				}
				return confirmed;
			},
			(values) => {
				items.value = values;
				prepared.value = true;
				unknown.value = false;
			},
			{
				write: true,
				refreshAfterSuccess: true,

				onFailure(cause) {
					onReadFailure(cause);
					unknown.value = !(cause instanceof AgentManagementFailure) || cause.outcome === 'unknown';
					prepared.value = false;
					emit('ready', false, []);
				},
			},
		);
	}

	function newIntent(): void {
		if (operation.busy.value || !inspected.value || !acknowledged.value || operation.refreshRequired.value) return;
		unknown.value = false;
		inspected.value = false;
		acknowledged.value = false;
		prepared.value = false;
		emit('ready', items.value.length === 0, []);
	}
</script>
<template>
	<div class="space-y-2 text-xs">
		<ArtifactPicker v-model="items" :app-id="appId" :active="active" :disabled="locked" />
		<div v-if="items.length" class="flex flex-wrap gap-2">
			<span v-for="item in items" :key="item.id">{{ item.name }}</span
			><button type="button" :disabled="locked" @click="items = []">
				{{ t('agent.nativeRun.clearAttachments') }}
			</button>
		</div>
		<button v-if="items.length" type="button" :disabled="disabled || operation.busy.value" @click="read">
			{{ t('agent.nativeRun.readAttachments') }}
		</button>
		<button
			v-if="items.length && !prepared"
			type="button"
			:disabled="locked || operation.refreshRequired.value"
			@click="prepare"
		>
			{{ t('agent.nativeRun.bindAttachments') }}
		</button>
		<p v-if="prepared">{{ t('agent.nativeRun.attachmentsReady') }}</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<template v-if="unknown"
			><p>{{ t('agent.nativeRun.attachmentUnknown') }}</p>
			<label><input v-model="acknowledged" type="checkbox" />{{ t('agent.nativeRun.acknowledge') }}</label
			><button
				type="button"
				:disabled="
					disabled || operation.busy.value || !inspected || !acknowledged || operation.refreshRequired.value
				"
				@click="newIntent"
			>
				{{ t('agent.nativeThreads.abandon') }}
			</button></template
		>
	</div>
</template>
