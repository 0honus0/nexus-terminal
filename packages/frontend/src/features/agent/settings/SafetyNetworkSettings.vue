<script setup lang="ts">
	import { nextTick, computed, onActivated, onMounted, ref, toRaw } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiEmptyState,
		UiLoadingState,
		UiInfoHint,
		UiInlineNotice,
		UiInput,
		UiSearchInput,
	} from '@/foundation/ui';
	import { useConnections } from '@/features/connections/public';
	import { AGENT_DENYLIST_MAX_TARGETS } from '@nexus-terminal/shared/agent/governance/values';
	import { getAgentDenylist, saveAgentDenylist } from '../api/app-management-api';
	import type { AgentDenylist, AgentDenylistDraft } from '../model/app-management-types';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import { agentHostEvents } from '../events/agent-host-events';

	const { t } = useI18n();
	const expanded = ref(false);
	const searchQuery = ref('');
	const saved = ref<AgentDenylist | null>(null);
	const draft = ref<AgentDenylistDraft>({ connectionIds: [], reason: '' });
	const operation = useAgentManagementOperation(() => {
		saved.value = null;
		draft.value = { connectionIds: [], reason: '' };
	});
	const directoryOperation = useAgentManagementOperation();
	const connections = useConnections();
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || saved.value === null);
	const allConnections = computed(() => connections.connections.value);
	const filteredConnections = computed(() => {
		const query = searchQuery.value.trim().toLowerCase();
		if (!query) return allConnections.value;
		return allConnections.value.filter((connection) =>
			[
				connection.name,
				connection.host,
				connection.username,
				String(connection.id),
				String(connection.port),
			].some((value) => value.toLowerCase().includes(query)),
		);
	});
	const orphanIds = computed(() => {
		if (!connections.loaded.value) return [];
		const existing = new Set(allConnections.value.map((connection) => connection.id));
		return draft.value.connectionIds.filter((id) => !existing.has(id));
	});
	const reasonPresets = computed(() => [
		t('agent.settings.safety.reasonPresets.production'),
		t('agent.settings.safety.reasonPresets.compliance'),
		t('agent.settings.safety.reasonPresets.maintenance'),
		t('agent.settings.safety.reasonPresets.sandbox'),
	]);
	const isDirty = computed(() => {
		if (!saved.value) return false;
		const storedIds = saved.value.entries.map((entry) => entry.connectionId).sort((left, right) => left - right);
		const draftIds = [...draft.value.connectionIds].sort((left, right) => left - right);
		return (
			draft.value.reason !== (saved.value.entries[0]?.reason ?? '') ||
			storedIds.length !== draftIds.length ||
			storedIds.some((id, index) => id !== draftIds[index])
		);
	});
	const safetyHint = computed(
		() => `${t('agent.settings.safety.description')} ${t('agent.settings.safety.guardrails')}`,
	);
	const allFilteredBlocked = computed(
		() =>
			filteredConnections.value.length > 0 &&
			filteredConnections.value.every((connection) => draft.value.connectionIds.includes(connection.id)),
	);
	const noneFilteredBlocked = computed(
		() =>
			filteredConnections.value.length === 0 ||
			filteredConnections.value.every((connection) => !draft.value.connectionIds.includes(connection.id)),
	);

	function toggleConnection(id: number): void {
		if (blocked.value) return;
		const next = new Set(draft.value.connectionIds);
		if (next.has(id)) next.delete(id);
		else if (next.size < AGENT_DENYLIST_MAX_TARGETS) next.add(id);
		draft.value.connectionIds = [...next];
	}

	function blockFiltered(): void {
		const next = new Set(draft.value.connectionIds);
		for (const connection of filteredConnections.value) {
			if (next.size >= AGENT_DENYLIST_MAX_TARGETS) break;
			next.add(connection.id);
		}
		draft.value.connectionIds = [...next];
	}

	function allowFiltered(): void {
		const visible = new Set(filteredConnections.value.map((connection) => connection.id));
		draft.value.connectionIds = draft.value.connectionIds.filter((id) => !visible.has(id));
	}

	function removeOrphanId(id: number): void {
		draft.value.connectionIds = draft.value.connectionIds.filter((value) => value !== id);
	}

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
	onActivated(async () => {
		await nextTick();
		initial();
	});
</script>
<template>
	<section
		class="rounded-2xl border border-border bg-card shadow-xs transition-all"
		:aria-label="t('agent.settings.appManagement.denylist')"
	>
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-header/50 px-4 py-3 sm:px-5 sm:py-3.5"
		>
			<div>
				<div class="flex flex-wrap items-center gap-2.5">
					<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.safety.title') }}</h3>
					<UiBadge :tone="draft.connectionIds.length > 0 ? 'danger' : 'success'" density="compact">
						{{
							t('agent.settings.safety.blockedCount', {
								blocked: draft.connectionIds.length,
								total: allConnections.length,
							})
						}}
					</UiBadge>
					<UiInfoHint :text="safetyHint" />
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span v-if="saved" class="hidden text-[11px] font-mono text-text-secondary/60 sm:inline">{{
					t('agent.settings.safety.revision', { revision: saved.revision })
				}}</span>
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					:aria-expanded="expanded"
					@click="expanded = !expanded"
				>
					<i class="fa-solid fa-shield-halved text-[10px] text-primary/80" aria-hidden="true"></i>
					<span>{{
						t(expanded ? 'agent.settings.safety.collapseTargets' : 'agent.settings.safety.manageTargets')
					}}</span>
					<i
						class="fa-solid fa-chevron-down text-[8px] text-text-secondary transition-transform"
						:class="{ 'rotate-180': expanded }"
						aria-hidden="true"
					></i>
				</UiButton>
			</div>
		</div>

		<div v-if="expanded" class="space-y-4 border-t border-border p-4 sm:p-5">
			<UiInlineNotice v-if="operation.refreshRequired.value" tone="warning" compact>
				{{ t('agent.settings.appManagement.refreshRequired') }}
				<template #actions>
					<UiButton
						type="button"
						appearance="soft"
						density="compact"
						:disabled="operation.busy.value"
						@click="load"
						>{{ t('agent.settings.appManagement.readDenylist') }}</UiButton
					>
				</template>
			</UiInlineNotice>

			<div class="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
				<UiSearchInput
					v-model="searchQuery"
					class="max-w-md flex-1"
					:placeholder="t('agent.settings.safety.searchConnections')"
					:aria-label="t('agent.settings.safety.searchConnections')"
					:clear-label="t('common.clear')"
				/>
				<div v-if="filteredConnections.length > 0" class="flex items-center gap-2">
					<UiButton
						appearance="soft"
						tone="danger"
						type="button"
						:disabled="blocked || allFilteredBlocked"
						@click="blockFiltered"
					>
						<i class="fa-solid fa-ban text-[11px]" aria-hidden="true"></i>
						<span>{{ t('agent.settings.safety.blockAll') }}</span>
					</UiButton>
					<UiButton
						appearance="soft"
						tone="neutral"
						type="button"
						:disabled="blocked || noneFilteredBlocked"
						@click="allowFiltered"
					>
						<i class="fa-solid fa-check text-[11px]" aria-hidden="true"></i>
						<span>{{ t('agent.settings.safety.allowAll') }}</span>
					</UiButton>
				</div>
			</div>

			<UiLoadingState
				v-if="!connections.loaded.value && connections.busy.value"
				class="py-4"
				compact
				:bordered="false"
				:title="t('agent.settings.safety.loadingConnections')"
			/>
			<UiInlineNotice
				v-else-if="directoryOperation.notice.value || directoryOperation.refreshRequired.value"
				tone="warning"
				compact
			>
				{{ t('agent.settings.appManagement.targetsFailed') }}
				<template #actions>
					<UiButton
						type="button"
						appearance="soft"
						density="compact"
						:disabled="directoryOperation.busy.value"
						@click="loadTargets"
						>{{ t('agent.settings.appManagement.readTargets') }}</UiButton
					>
				</template>
			</UiInlineNotice>
			<div
				v-else
				class="grid max-h-[26rem] grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-border bg-background/50 p-2.5 pr-2 md:grid-cols-2"
			>
				<div
					v-for="connection in filteredConnections"
					:key="connection.id"
					role="button"
					:tabindex="blocked ? -1 : 0"
					class="flex cursor-pointer select-none items-center justify-between gap-2.5 rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
					:class="
						draft.connectionIds.includes(connection.id)
							? 'border-error/50 bg-error/10 shadow-xs ring-1 ring-error/30 hover:bg-error/15'
							: 'border-border/70 bg-card hover:bg-header/25'
					"
					@click="toggleConnection(connection.id)"
					@keydown.enter.prevent="toggleConnection(connection.id)"
					@keydown.space.prevent="toggleConnection(connection.id)"
				>
					<div class="flex min-w-0 items-center gap-2.5">
						<UiCheckbox
							class="shrink-0"
							tone="danger"
							:model-value="draft.connectionIds.includes(connection.id)"
							:disabled="blocked"
							:aria-label="connection.name || connection.host"
							@click.stop
							@update:model-value="toggleConnection(connection.id)"
						/>
						<div
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
							:class="
								draft.connectionIds.includes(connection.id)
									? 'border-error/25 bg-error/10 text-error'
									: 'border-border/60 bg-header/30 text-text-secondary'
							"
						>
							<i
								:class="connection.type === 'RDP' ? 'fa-solid fa-desktop' : 'fa-solid fa-terminal'"
								class="text-xs"
								aria-hidden="true"
							></i>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex min-w-0 items-center gap-2">
								<span class="truncate text-xs font-semibold text-foreground">{{
									connection.name || connection.host
								}}</span>
							</div>
							<div
								class="mt-0.5 flex items-center gap-2 truncate font-mono text-[11px] text-text-secondary/80"
							>
								<span v-if="connection.username" class="text-text-secondary"
									>{{ connection.username }}@</span
								>
								<span>{{ connection.host }}:{{ connection.port }}</span>
								<UiBadge class="shrink-0 uppercase" appearance="ghost" density="compact">{{
									connection.type
								}}</UiBadge>
							</div>
						</div>
					</div>
					<UiBadge
						v-if="draft.connectionIds.includes(connection.id)"
						class="shrink-0 font-semibold"
						tone="danger"
						density="compact"
					>
						<i class="fa-solid fa-ban text-[9px]" aria-hidden="true"></i>
						<span class="hidden sm:inline">{{ t('agent.settings.safety.blockedBadge') }}</span>
					</UiBadge>
					<UiBadge v-else class="shrink-0" tone="success" density="compact">
						<i class="fa-solid fa-check text-[9px]" aria-hidden="true"></i>
						<span class="hidden sm:inline">{{ t('agent.settings.safety.allowedBadge') }}</span>
					</UiBadge>
				</div>
				<UiEmptyState
					v-if="!filteredConnections.length"
					class="col-span-full"
					compact
					:bordered="false"
					icon="fa-solid fa-magnifying-glass"
					:title="t('agent.settings.safety.noSearchResults', { query: searchQuery })"
				/>
			</div>

			<UiInlineNotice v-if="orphanIds.length > 0" tone="warning" compact>
				<span>{{ t('agent.settings.safety.orphanIdsCount', { count: orphanIds.length }) }}</span>
				<template #actions>
					<UiButton
						type="button"
						appearance="ghost"
						tone="warning"
						density="compact"
						:disabled="blocked"
						@click="orphanIds.forEach(removeOrphanId)"
					>
						{{ t('agent.settings.safety.clearOrphanIds') }}
					</UiButton>
				</template>
				<details class="mt-2 border-t border-warning/20 pt-2">
					<summary class="cursor-pointer text-[10px] text-text-secondary">
						{{ t('agent.settings.safety.technicalDetails') }}
					</summary>
					<div class="mt-1.5 flex flex-wrap gap-1">
						<UiButton
							v-for="id in orphanIds"
							:key="id"
							type="button"
							appearance="ghost"
							tone="warning"
							density="compact"
							class="font-mono"
							:title="t('agent.settings.safety.removeOrphanId')"
							@click="removeOrphanId(id)"
						>
							<span>#{{ id }}</span>
							<i class="fa-solid fa-xmark text-[8px]" aria-hidden="true"></i>
						</UiButton>
					</div>
				</details>
			</UiInlineNotice>

			<div class="space-y-3 border-t border-border pt-4">
				<div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
					<label class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
						<span>{{ t('agent.settings.safety.reason') }}</span>
						<span class="text-[11px] font-normal text-text-secondary">{{
							t('agent.settings.safety.reasonAudit')
						}}</span>
					</label>
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-[11px] text-text-secondary">{{
							t('agent.settings.safety.commonReasons')
						}}</span>
						<UiButton
							v-for="preset in reasonPresets"
							:key="preset"
							type="button"
							appearance="ghost"
							density="compact"
							@click="draft.reason = preset"
						>
							{{ preset }}
						</UiButton>
					</div>
				</div>
				<div class="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
					<UiInput
						v-model="draft.reason"
						type="text"
						maxlength="512"
						class="flex-1"
						:placeholder="t('agent.settings.safety.reasonPlaceholder')"
						:aria-label="t('agent.settings.safety.reason')"
						@keydown.enter.prevent="save"
					/>
					<UiButton
						type="button"
						:appearance="isDirty && draft.reason.trim() ? 'solid' : 'soft'"
						:tone="isDirty && draft.reason.trim() ? 'primary' : 'neutral'"
						:disabled="blocked || !draft.reason.trim()"
						@click="save"
					>
						<i class="fa-solid fa-shield-check text-xs" aria-hidden="true"></i>
						<span>{{ t('agent.settings.safety.savePolicy') }}</span>
					</UiButton>
				</div>
			</div>
		</div>
	</section>
</template>
