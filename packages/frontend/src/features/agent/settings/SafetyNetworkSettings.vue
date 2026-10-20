<script setup lang="ts">
	import { computed, onActivated, onMounted, ref, toRaw } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInfoHint } from '@/foundation/ui';
	import { useConnections } from '@/features/connections/public';
	import { AGENT_DENYLIST_MAX_TARGETS } from '@nexus-terminal/shared/agent/governance/values';
	import { getAgentDenylist, saveAgentDenylist } from '../api/app-management-api';
	import type { AgentDenylist, AgentDenylistDraft } from '../model/app-management-types';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import { agentHostEvents } from '../events/agent-host-events';
	import { formatAgentDateTime } from '../locale-format';
	import AgentTargetPicker from './AgentTargetPicker.vue';

	const { t, locale } = useI18n();
	const expanded = ref(false);
	const saved = ref<AgentDenylist | null>(null);
	const draft = ref<AgentDenylistDraft>({ connectionIds: [], reason: '' });
	const operation = useAgentManagementOperation(() => {
		saved.value = null;
		draft.value = { connectionIds: [], reason: '' };
	});
	const directoryOperation = useAgentManagementOperation();
	const connections = useConnections();
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || saved.value === null);
	const selected = computed(() => draft.value.connectionIds.map((id) => String(id)));

	function accept(value: AgentDenylist): void {
		saved.value = value;
		draft.value = {
			connectionIds: value.entries.map((entry) => entry.connectionId),
			reason: value.entries[0]?.reason ?? '',
		};
	}

	async function load(): Promise<void> {
		await operation.execute(getAgentDenylist, accept, { write: false });
	}

	async function loadTargets(): Promise<void> {
		await directoryOperation.execute(
			() => connections.load(),
			() => {},
			{ write: false },
		);
	}

	async function save(): Promise<void> {
		if (!saved.value) {
			return;
		}
		const revision = saved.value.revision;
		const input = structuredClone(toRaw(draft.value));
		await operation.execute(
			(signal) => saveAgentDenylist(revision, input, signal),
			(value) => {
				accept(value);
				agentHostEvents.emit('authorization-changed', {
					revision: value.revision,
					connectionIds: value.entries.map((entry) => entry.connectionId),
				});
			},
			{ write: true },
		);
	}

	function initial(): void {
		if (saved.value === null) {
			void load();
		}
		if (directoryOperation.refreshRequired.value) {
			void loadTargets();
		}
	}

	onMounted(initial);
	onActivated(initial);
</script>
<template>
	<section
		class="rounded-2xl border border-border bg-card shadow-xs transition-all"
		:aria-label="t('agent.settings.appManagement.denylist')"
	>
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-header/50 px-4 py-3 sm:px-5 sm:py-3.5"
		>
			<div class="flex items-center gap-2.5">
				<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.safety.title') }}</h3>
				<span class="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-text-secondary">{{
					t('agent.settings.safety.blockedCount', {
						blocked: draft.connectionIds.length,
						total: connections.connections.value.length,
					})
				}}</span
				><UiInfoHint :text="t('agent.settings.appManagement.denylistHelp')" />
			</div>
			<UiButton type="button" appearance="soft" :aria-expanded="expanded" @click="expanded = !expanded"
				><i class="fa-solid fa-shield-halved text-[10px] text-primary/80" aria-hidden="true"></i
				>{{ t(expanded ? 'agent.settings.safety.collapseTargets' : 'agent.settings.safety.manageTargets')
				}}<i
					class="fa-solid fa-chevron-down text-[8px] transition-transform"
					:class="{ 'rotate-180': expanded }"
					aria-hidden="true"
				></i
			></UiButton>
		</div>
		<div class="space-y-3 px-4 py-3 sm:px-5">
			<p class="text-sm text-text-secondary">{{ t('agent.settings.appManagement.denylistHelp') }}</p>
			<p v-if="operation.notice.value" role="status">
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<p v-if="operation.refreshRequired.value" class="text-sm text-warning">
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>
			<div class="flex flex-wrap gap-2">
				<UiButton
					v-if="operation.refreshRequired.value || operation.notice.value === 'failed'"
					type="button"
					:disabled="operation.busy.value"
					@click="load"
					>{{ t('agent.settings.appManagement.readDenylist') }}</UiButton
				><UiButton
					v-if="directoryOperation.refreshRequired.value || directoryOperation.notice.value === 'failed'"
					type="button"
					:disabled="directoryOperation.busy.value"
					@click="loadTargets"
					>{{ t('agent.settings.appManagement.readTargets') }}</UiButton
				>
			</div>
			<p v-if="directoryOperation.notice.value" role="alert">
				{{ t('agent.settings.appManagement.targetsFailed') }}
			</p>
			<fieldset v-show="expanded" :disabled="blocked" class="space-y-3">
				<AgentTargetPicker
					:items="connections.connections.value"
					:model-value="selected"
					:max="AGENT_DENYLIST_MAX_TARGETS"
					@update:model-value="(ids) => (draft.connectionIds = ids.map((id) => Number(id)))"
				/>
				<label class="block text-sm"
					>{{ t('agent.settings.appManagement.reason')
					}}<input v-model="draft.reason" class="mt-1 w-full rounded border border-border bg-background p-2"
				/></label>
				<UiButton type="button" appearance="solid" tone="primary" @click="save">{{
					t('common.save')
				}}</UiButton>
			</fieldset>
			<div
				v-for="entry in saved?.entries"
				:key="entry.connectionId"
				class="space-y-1 border-t border-border pt-2 text-xs"
			>
				<p>#{{ entry.connectionId }} · {{ entry.reason }}</p>
				<p>
					{{ formatAgentDateTime(locale, new Date(entry.changedAt)) }} ·
					{{ t('agent.settings.appManagement.changedBy', { id: entry.changedBy }) }}
				</p>
			</div>
		</div>
	</section>
</template>
