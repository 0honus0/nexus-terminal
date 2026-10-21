<script setup lang="ts">
	import { computed, onActivated, onMounted, ref, toRaw } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
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
	const blockedConnections = computed(() => {
		const selectedIds = new Set(draft.value.connectionIds);
		return allConnections.value.filter((connection) => selectedIds.has(connection.id));
	});
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
			<div>
				<div class="flex flex-wrap items-center gap-2.5">
					<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.safety.title') }}</h3>
					<span
						class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all"
						:class="
							draft.connectionIds.length > 0
								? 'border-error/30 bg-error/10 font-semibold text-error'
								: 'border-success/30 bg-success/10 text-success'
						"
					>
						{{
							t('agent.settings.safety.blockedCount', {
								blocked: draft.connectionIds.length,
								total: allConnections.length,
							})
						}}
					</span>
					<UiInfoHint :text="t('agent.settings.safety.description')" />
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

		<div class="border-t border-border/55 px-4 py-3 sm:px-5">
			<div class="flex items-start gap-2.5">
				<i class="fa-solid fa-lock mt-0.5 shrink-0 text-[10px] text-text-secondary/65" aria-hidden="true"></i>
				<div class="min-w-0 flex-1">
					<div class="text-[11px] leading-relaxed text-text-secondary">
						{{ t('agent.settings.safety.scopeHint') }}
					</div>
					<div v-if="blockedConnections.length" class="mt-2 flex flex-wrap gap-1.5">
						<span
							v-for="connection in blockedConnections.slice(0, 6)"
							:key="connection.id"
							class="inline-flex max-w-52 items-center gap-1 rounded-md bg-error/8 px-2 py-1 text-[11px] text-error"
						>
							<i class="fa-solid fa-ban text-[8px]" aria-hidden="true"></i>
							<span class="truncate">{{ connection.name || connection.host }}</span>
						</span>
						<span
							v-if="blockedConnections.length > 6"
							class="rounded-md bg-header/60 px-2 py-1 text-[11px] text-text-secondary"
							>+{{ blockedConnections.length - 6 }}</span
						>
					</div>
				</div>
			</div>
		</div>

		<div v-if="expanded" class="space-y-4 border-t border-border p-4 sm:p-5">
			<div
				class="flex items-start gap-2.5 rounded-lg bg-header/25 p-3.5 text-xs leading-relaxed text-text-secondary"
			>
				<i class="fa-solid fa-shield-halved mt-0.5 shrink-0 text-sm text-primary/80"></i>
				<span>{{ t('agent.settings.safety.guardrails') }}</span>
			</div>

			<p
				v-if="operation.notice.value"
				role="status"
				class="rounded-lg border border-border/60 bg-header/25 px-3 py-2 text-xs"
			>
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<div
				v-if="operation.refreshRequired.value"
				class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning"
			>
				<span>{{ t('agent.settings.appManagement.refreshRequired') }}</span>
				<UiButton
					v-if="operation.refreshRequired.value || operation.notice.value === 'failed'"
					type="button"
					appearance="soft"
					:disabled="operation.busy.value"
					@click="load"
					>{{ t('agent.settings.appManagement.readDenylist') }}</UiButton
				>
			</div>

			<div class="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
				<div class="relative max-w-md flex-1">
					<i
						class="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary/70"
						aria-hidden="true"
					></i>
					<input
						v-model="searchQuery"
						type="text"
						data-no-highlight
						class="h-8.5 w-full rounded-xl border border-border bg-background pl-8.5 pr-3 text-xs text-foreground shadow-2xs outline-none transition-all placeholder:text-text-secondary/60 focus:border-border-hover"
						:placeholder="t('agent.settings.safety.searchConnections')"
					/>
				</div>
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

			<div
				v-if="!connections.loaded.value && connections.busy.value"
				class="py-8 text-center text-xs text-text-secondary"
			>
				<i class="fa-solid fa-circle-notch fa-spin mb-2 text-lg text-primary" aria-hidden="true"></i>
				<div>{{ t('agent.settings.safety.loadingConnections') }}</div>
			</div>
			<div
				v-else-if="directoryOperation.notice.value || directoryOperation.refreshRequired.value"
				class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning"
			>
				<span>{{ t('agent.settings.appManagement.targetsFailed') }}</span>
				<UiButton
					type="button"
					appearance="soft"
					:disabled="directoryOperation.busy.value"
					@click="loadTargets"
					>{{ t('agent.settings.appManagement.readTargets') }}</UiButton
				>
			</div>
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
								<span
									class="rounded border border-border/70 bg-card/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-secondary"
									>{{ connection.type }}</span
								>
							</div>
						</div>
					</div>
					<span
						v-if="draft.connectionIds.includes(connection.id)"
						class="inline-flex shrink-0 items-center gap-1 rounded-md border border-error/30 bg-error/15 px-1.5 py-1 text-[10px] font-semibold text-error shadow-2xs lg:px-2 lg:text-[11px]"
					>
						<i class="fa-solid fa-ban text-[9px]" aria-hidden="true"></i>
						<span class="hidden sm:inline">{{ t('agent.settings.safety.blockedBadge') }}</span>
					</span>
					<span
						v-else
						class="inline-flex shrink-0 items-center gap-1 rounded-md border border-success/25 bg-success/10 px-1.5 py-1 text-[10px] font-medium text-success lg:px-2 lg:text-[11px]"
					>
						<i class="fa-solid fa-check text-[9px]" aria-hidden="true"></i>
						<span class="hidden sm:inline">{{ t('agent.settings.safety.allowedBadge') }}</span>
					</span>
				</div>
				<p v-if="!filteredConnections.length" class="py-6 text-center text-xs text-text-secondary">
					{{ t('agent.settings.safety.noSearchResults', { query: searchQuery }) }}
				</p>
			</div>

			<div
				v-if="orphanIds.length > 0"
				class="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex min-w-0 items-center gap-2">
						<i
							class="fa-solid fa-triangle-exclamation shrink-0 text-xs text-warning"
							aria-hidden="true"
						></i>
						<span>{{ t('agent.settings.safety.orphanIdsCount', { count: orphanIds.length }) }}</span>
					</div>
					<button
						type="button"
						class="cursor-pointer text-[11px] underline decoration-warning/45 underline-offset-2 hover:no-underline"
						:disabled="blocked"
						@click="orphanIds.forEach(removeOrphanId)"
					>
						{{ t('agent.settings.safety.clearOrphanIds') }}
					</button>
				</div>
				<details class="mt-2 border-t border-warning/20 pt-2">
					<summary class="cursor-pointer text-[10px] text-text-secondary">
						{{ t('agent.settings.safety.technicalDetails') }}
					</summary>
					<div class="mt-1.5 flex flex-wrap gap-1">
						<button
							v-for="id in orphanIds"
							:key="id"
							type="button"
							class="inline-flex cursor-pointer items-center gap-1 rounded border border-warning/30 bg-warning/15 px-1.5 py-0.5 font-mono text-[11px] hover:bg-warning/25"
							:title="t('agent.settings.safety.removeOrphanId')"
							@click="removeOrphanId(id)"
						>
							<span>#{{ id }}</span>
							<i class="fa-solid fa-xmark text-[8px]" aria-hidden="true"></i>
						</button>
					</div>
				</details>
			</div>

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
						<button
							v-for="preset in reasonPresets"
							:key="preset"
							type="button"
							class="cursor-pointer rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-text-secondary shadow-2xs transition-all hover:border-primary/40 hover:text-primary"
							@click="draft.reason = preset"
						>
							{{ preset }}
						</button>
					</div>
				</div>
				<div class="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
					<input
						v-model="draft.reason"
						type="text"
						maxlength="512"
						data-no-highlight
						class="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs text-foreground shadow-2xs outline-none transition-all placeholder:text-text-secondary/60 focus:border-border-hover"
						:placeholder="t('agent.settings.safety.reasonPlaceholder')"
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
