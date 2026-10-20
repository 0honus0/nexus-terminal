<script setup lang="ts">
	import { computed, onActivated, onMounted, toRaw } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import { useConnections } from '@/features/connections/public';
	import {
		AGENT_EXECUTION_COMPACTION_MODES,
		AGENT_EXECUTION_CONTEXT_PROFILES,
		AGENT_EXECUTION_INTEGER_KEYS,
		AGENT_GRANT_MAX_TARGET_IDS,
		type AgentCapability,
	} from '@nexus-terminal/shared/agent/governance/values';
	import type { ManagedApp } from '../model/app-management-types';
	import { useAppGovernance } from '../composables/use-app-governance';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import AgentTargetPicker from './AgentTargetPicker.vue';

	const props = defineProps<{ app: ManagedApp }>();
	const { t } = useI18n();
	const {
		grants,
		grantDraft,
		policy,
		policyDraft,
		grantOperation,
		policyOperation,
		loadGrants,
		loadPolicy,
		saveGrants,
		savePolicy,
	} = useAppGovernance(props.app.id);
	const connections = useConnections();
	const directoryOperation = useAgentManagementOperation();
	const targets = computed(() => connections.connections.value.filter((item) => item.type === 'SSH'));
	const definitions = computed(() => grants.value?.definitions ?? []);
	const unavailableGrants = computed(() =>
		grantDraft.value.filter((grant) => !definitions.value.some((definition) => definition.id === grant.capability)),
	);
	const grantBlocked = computed(
		() => grantOperation.busy.value || grantOperation.refreshRequired.value || grants.value === null,
	);
	const policyBlocked = computed(
		() => policyOperation.busy.value || policyOperation.refreshRequired.value || policy.value === null,
	);

	async function loadTargets(): Promise<void> {
		await directoryOperation.execute(
			() => connections.load(),
			() => {},
			{ write: false },
		);
	}

	function initialTargets(): void {
		if (directoryOperation.refreshRequired.value) {
			void loadTargets();
		}
	}

	onMounted(initialTargets);
	onActivated(initialTargets);

	function grantFor(capability: AgentCapability) {
		return grantDraft.value.find((grant) => grant.capability === capability);
	}

	function toggleGrant(capability: AgentCapability): void {
		if (grantBlocked.value) {
			return;
		}
		const existing = grantFor(capability);
		if (existing) {
			grantDraft.value = grantDraft.value.filter((grant) => grant.capability !== capability);
			return;
		}
		const definition = definitions.value.find((item) => item.id === capability);
		if (definition) {
			grantDraft.value.push({ capability, scope: structuredClone(toRaw(definition.defaultScope)) });
		}
	}

	function modeFor(capability: AgentCapability): string {
		const scope = grantFor(capability)?.scope;
		return scope?.kind === 'targets' ? (scope.ssh?.mode ?? 'none') : 'none';
	}

	function selectMode(capability: AgentCapability, event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) {
			return;
		}
		const grant = grantFor(capability);
		if (!grant || grant.scope.kind !== 'targets') {
			return;
		}
		const value = event.target.value;
		if (value === 'none') {
			grant.scope.ssh = null;
		} else if (value === 'all') {
			grant.scope.ssh = { mode: 'all' };
		} else if (value === 'ids') {
			grant.scope.ssh = { mode: 'ids', ids: [] };
		}
	}

	function idsFor(capability: AgentCapability): string[] {
		const scope = grantFor(capability)?.scope;
		return scope?.kind === 'targets' && scope.ssh?.mode === 'ids' ? scope.ssh.ids : [];
	}

	function setIds(capability: AgentCapability, ids: string[]): void {
		const grant = grantFor(capability);
		if (grant?.scope.kind === 'targets' && grant.scope.ssh?.mode === 'ids') {
			grant.scope.ssh.ids = ids;
		}
	}

	function toggleOverride(key: (typeof AGENT_EXECUTION_INTEGER_KEYS)[number], event: Event): void {
		if (!(event.target instanceof HTMLInputElement) || !policy.value) {
			return;
		}
		if (event.target.checked) {
			policyDraft.value[key] = policy.value.effective[key];
		} else {
			delete policyDraft.value[key];
		}
	}

	function selectProfile(event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) {
			return;
		}
		const selected = event.target.value;
		policyDraft.value.contextProfile = AGENT_EXECUTION_CONTEXT_PROFILES.find((value) => value === selected);
	}

	function selectCompaction(event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) {
			return;
		}
		const selected = event.target.value;
		policyDraft.value.contextCompactionMode = AGENT_EXECUTION_COMPACTION_MODES.find((value) => value === selected);
	}
</script>
<template>
	<div class="space-y-4">
		<section class="space-y-3 rounded border border-border p-3">
			<h4 class="font-medium">
				{{ t('agent.settings.appManagement.grants') }}
			</h4>
			<p class="text-xs text-text-secondary">{{ t('agent.settings.appManagement.grantHelp') }}</p>
			<p v-if="grantOperation.notice.value" role="status">
				{{ t('agent.settings.appManagement.' + grantOperation.notice.value) }}
			</p>
			<p v-if="grantOperation.refreshRequired.value" class="text-sm text-warning">
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>
			<UiButton
				v-if="grantOperation.refreshRequired.value || grantOperation.notice.value === 'failed'"
				type="button"
				:disabled="grantOperation.busy.value"
				@click="loadGrants"
				>{{ t('agent.settings.appManagement.readGrants') }}</UiButton
			>
			<fieldset :disabled="grantBlocked" class="space-y-3">
				<div v-for="grant in unavailableGrants" :key="grant.capability" class="space-y-2 text-warning">
					<p>{{ t('agent.settings.appManagement.unavailableGrant', { capability: grant.capability }) }}</p>
					<UiButton
						type="button"
						@click="grantDraft = grantDraft.filter((item) => item.capability !== grant.capability)"
						>{{ t('common.delete') }}</UiButton
					>
				</div>
				<div
					v-for="definition in definitions"
					:key="definition.id"
					class="space-y-2 rounded border border-border p-3"
				>
					<label class="flex items-center gap-2 text-sm"
						><input
							type="checkbox"
							:checked="grantFor(definition.id) !== undefined"
							@change="toggleGrant(definition.id)"
						/>{{ definition.id }}</label
					>
					<template v-if="grantFor(definition.id) && definition.scopeKind === 'targets'">
						<label class="block text-sm"
							>{{ t('agent.settings.appManagement.sshScope') }}
							<select
								:value="modeFor(definition.id)"
								class="ml-2 rounded border border-border bg-background p-2"
								@change="selectMode(definition.id, $event)"
							>
								<option value="none">{{ t('agent.settings.appManagement.noTargets') }}</option>
								<option value="all">{{ t('agent.settings.appManagement.allSsh') }}</option>
								<option value="ids">{{ t('agent.settings.appManagement.selectedSsh') }}</option>
							</select>
						</label>
						<AgentTargetPicker
							v-if="modeFor(definition.id) === 'ids'"
							:items="targets"
							:model-value="idsFor(definition.id)"
							:max="AGENT_GRANT_MAX_TARGET_IDS"
							@update:model-value="(ids) => setIds(definition.id, ids)"
						/>
					</template>
				</div>
				<UiButton type="button" @click="saveGrants">{{
					t('agent.settings.appManagement.saveGrants')
				}}</UiButton>
			</fieldset>
		</section>
		<section class="space-y-3 rounded border border-border p-3">
			<h4 class="font-medium">
				{{ t('agent.settings.appManagement.policy') }}
			</h4>
			<p class="text-xs text-text-secondary">{{ t('agent.settings.appManagement.policyHelp') }}</p>
			<p v-if="policyOperation.notice.value" role="status">
				{{ t('agent.settings.appManagement.' + policyOperation.notice.value) }}
			</p>
			<p v-if="policyOperation.refreshRequired.value" class="text-sm text-warning">
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>
			<UiButton
				v-if="policyOperation.refreshRequired.value || policyOperation.notice.value === 'failed'"
				type="button"
				:disabled="policyOperation.busy.value"
				@click="loadPolicy"
				>{{ t('agent.settings.appManagement.readPolicy') }}</UiButton
			>
			<fieldset v-if="policy" :disabled="policyBlocked" class="space-y-3">
				<div v-for="key in AGENT_EXECUTION_INTEGER_KEYS" :key="key" class="space-y-1 text-sm">
					<label class="flex items-center gap-2"
						><input
							type="checkbox"
							:checked="policyDraft[key] !== undefined"
							@change="toggleOverride(key, $event)"
						/>{{ t('agent.settings.executionPolicy.fields.' + key) }}</label
					>
					<input
						v-if="policyDraft[key] !== undefined"
						v-model.number="policyDraft[key]"
						type="number"
						min="1"
						step="1"
						:aria-label="t('agent.settings.executionPolicy.fields.' + key)"
						class="w-full rounded border border-border bg-background p-2"
					/>
					<p class="text-xs text-text-secondary">
						{{ t('agent.settings.appManagement.effective', { value: policy.effective[key] }) }}
					</p>
				</div>
				<label class="block text-sm"
					>{{ t('agent.settings.executionPolicy.fields.contextProfile') }}
					<select
						:value="policyDraft.contextProfile ?? ''"
						class="ml-2 rounded border border-border bg-background p-2"
						@change="selectProfile"
					>
						<option value="">
							{{ t('agent.settings.appManagement.inherit', { value: policy.effective.contextProfile }) }}
						</option>
						<option v-for="value in AGENT_EXECUTION_CONTEXT_PROFILES" :key="value" :value="value">
							{{ t('agent.settings.executionPolicy.profile.' + value) }}
						</option>
					</select>
				</label>
				<label class="block text-sm"
					>{{ t('agent.settings.executionPolicy.fields.contextCompactionMode') }}
					<select
						:value="policyDraft.contextCompactionMode ?? ''"
						class="ml-2 rounded border border-border bg-background p-2"
						@change="selectCompaction"
					>
						<option value="">
							{{
								t('agent.settings.appManagement.inherit', {
									value: policy.effective.contextCompactionMode,
								})
							}}
						</option>
						<option v-for="value in AGENT_EXECUTION_COMPACTION_MODES" :key="value" :value="value">
							{{ t('agent.settings.executionPolicy.compaction.' + value) }}
						</option>
					</select>
				</label>
				<UiButton type="button" @click="savePolicy">{{ t('common.save') }}</UiButton>
			</fieldset>
		</section>
		<p v-if="directoryOperation.notice.value" role="alert">{{ t('agent.settings.appManagement.targetsFailed') }}</p>
		<UiButton type="button" :disabled="directoryOperation.busy.value" @click="loadTargets">{{
			t('agent.settings.appManagement.readTargets')
		}}</UiButton>
	</div>
</template>
