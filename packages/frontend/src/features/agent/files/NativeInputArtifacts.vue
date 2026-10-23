<script setup lang="ts">
	import type { ViewRevocation } from '@/shared/session/use-authenticated-view-scope';
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import ArtifactPicker from './ArtifactPicker.vue';
	import AgentConfigPopover from './AgentConfigPopover.vue';
	import { attachManagedArtifact, getManagedArtifact } from '../api/artifact-management-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import { fromArtifact } from '../model/artifact-mapper';
	import { AgentManagementFailure } from '../model/management-failure';
	import type { ManagedArtifact } from '../model/artifact-types';
	import type { NativeArtifactReference } from '../model/native-input-types';

	const props = defineProps<{
		appId: string;
		appNames?: Record<string, string>;
		threadId: string;
		active: boolean;
		disabled: boolean;
	}>();
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

	const operation = useAgentManagementOperation(revoke, () => props.active, { retainOnView: true });

	const locked = computed(() => props.disabled || operation.busy.value || unknown.value);
	const needsAttention = computed(
		() =>
			unknown.value ||
			(!prepared.value &&
				items.value.length > 0 &&
				((operation.notice.value !== '' && operation.notice.value !== 'saved') ||
					operation.refreshRequired.value)),
	);

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
			emit(
				'ready',
				value,
				items.value.map((item) => ({ id: item.id, name: item.name })),
			);
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

	function remove(value: ManagedArtifact): void {
		if (locked.value || prepared.value) return;
		items.value = items.value.filter((item) => item.id !== value.id);
	}

	function removeById(id: string): void {
		const value = items.value.find((item) => item.id === id);
		if (value) remove(value);
	}

	defineExpose({ removeById });
</script>
<template>
	<div class="flex min-w-0 flex-1 items-center gap-1">
		<ArtifactPicker
			v-model="items"
			:app-id="appId"
			:app-names="appNames"
			:active="active"
			:disabled="locked"
			compact
		/>
		<UiButton
			v-if="items.length && !prepared"
			density="compact"
			appearance="ghost"
			icon-only
			:title="t('agent.nativeRun.bindAttachments')"
			:aria-label="t('agent.nativeRun.bindAttachments')"
			:loading="operation.busy.value"
			:disabled="locked || operation.refreshRequired.value"
			@click="prepare"
		>
			<i class="fa-solid fa-paperclip text-[9px]" aria-hidden="true"></i>
		</UiButton>
		<span
			v-if="prepared"
			class="flex h-7 w-7 shrink-0 items-center justify-center text-success"
			:title="t('agent.nativeRun.attachmentsReady')"
		>
			<i class="fa-solid fa-circle-check text-[10px]" aria-hidden="true"></i>
		</span>
		<AgentConfigPopover
			v-if="needsAttention"
			:ariaLabel="t('agent.nativeRun.attachmentUnknown')"
			:title="t('agent.nativeRun.attachmentUnknown')"
			align="right"
			panel-class="w-72"
			trigger-variant="square"
			trigger-class="!text-warning"
		>
			<template #trigger>
				<i class="fa-solid fa-triangle-exclamation text-[10px]" aria-hidden="true"></i>
			</template>
			<template #panel>
				<div class="space-y-2 text-xs">
					<p class="leading-4 text-warning">
						{{
							unknown
								? t('agent.nativeRun.attachmentUnknown')
								: t('agent.settings.appManagement.' + (operation.notice.value || 'refreshRequired'))
						}}
					</p>
					<UiButton
						density="compact"
						appearance="soft"
						:disabled="disabled || operation.busy.value"
						@click="read"
					>
						{{ t('agent.nativeRun.inspect') }}
					</UiButton>
					<template v-if="unknown">
						<div class="flex items-start gap-2 leading-4 text-text-secondary">
							<UiCheckbox
								v-model="acknowledged"
								density="compact"
								:disabled="operation.busy.value"
								:aria-label="t('agent.nativeRun.acknowledge')"
							/>
							<span>{{ t('agent.nativeRun.acknowledge') }}</span>
						</div>
						<UiButton
							density="compact"
							appearance="soft"
							:disabled="
								disabled ||
								operation.busy.value ||
								!inspected ||
								!acknowledged ||
								operation.refreshRequired.value
							"
							@click="newIntent"
						>
							{{ t('agent.nativeThreads.abandon') }}
						</UiButton>
					</template>
				</div>
			</template>
		</AgentConfigPopover>
		<span v-if="operation.notice.value === 'saved' && !unknown" class="sr-only" role="status">
			{{ t('agent.settings.appManagement.saved') }}
		</span>
	</div>
</template>
