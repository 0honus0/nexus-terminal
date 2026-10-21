<script setup lang="ts">
	import { computed, onActivated, onMounted, toRaw } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
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

	type CapabilityCategory = 'files' | 'execution' | 'machine' | 'browser' | 'integration' | 'data';

	const CATEGORY_GROUPS: readonly {
		id: CapabilityCategory;
		label: string;
		icon: string;
	}[] = [
		{ id: 'files', label: 'agent.settings.apps.categoryFiles', icon: 'fa-solid fa-folder-tree' },
		{ id: 'execution', label: 'agent.settings.apps.categoryExecution', icon: 'fa-solid fa-terminal' },
		{ id: 'machine', label: 'agent.settings.apps.categoryMachine', icon: 'fa-solid fa-server' },
		{ id: 'browser', label: 'agent.settings.apps.categoryBrowser', icon: 'fa-solid fa-globe' },
		{ id: 'integration', label: 'agent.settings.apps.categoryIntegration', icon: 'fa-solid fa-plug' },
		{ id: 'data', label: 'agent.settings.apps.categoryData', icon: 'fa-solid fa-box-archive' },
	];

	const CAPABILITY_CATEGORIES: Partial<Record<AgentCapability, CapabilityCategory>> = {
		'file.read': 'files',
		'file.write': 'files',
		'file.delete': 'files',
		'machine.inspect': 'machine',
		'host.inspect': 'machine',
		'shell.execute': 'execution',
		'machine.docker.manage': 'machine',
		'browser.read': 'browser',
		'browser.interact': 'browser',
		'integration.mcp.read': 'integration',
		'integration.mcp.invoke': 'integration',
		'integration.acp.invoke': 'integration',
		'artifacts.read': 'data',
		'artifacts.write': 'data',
		'context.read': 'data',
		'context.compact': 'data',
		'memory.read': 'data',
		'memory.propose': 'data',
		'app.intents.exchange': 'data',
	};

	const CAPABILITY_ICONS: Partial<Record<AgentCapability, string>> = {
		'file.read': 'fa-solid fa-file-lines',
		'file.write': 'fa-solid fa-file-pen',
		'file.delete': 'fa-solid fa-trash-can',
		'machine.inspect': 'fa-solid fa-chart-line',
		'host.inspect': 'fa-solid fa-server',
		'shell.execute': 'fa-solid fa-terminal',
		'machine.docker.manage': 'fa-brands fa-docker',
		'browser.read': 'fa-solid fa-globe',
		'browser.interact': 'fa-solid fa-arrow-pointer',
		'integration.mcp.read': 'fa-solid fa-book-open',
		'integration.mcp.invoke': 'fa-solid fa-network-wired',
		'integration.acp.invoke': 'fa-solid fa-satellite-dish',
		'artifacts.read': 'fa-solid fa-box-archive',
		'artifacts.write': 'fa-solid fa-boxes-packing',
		'context.read': 'fa-solid fa-book',
		'context.compact': 'fa-solid fa-compress',
		'memory.read': 'fa-solid fa-brain',
		'memory.propose': 'fa-solid fa-lightbulb',
		'app.intents.exchange': 'fa-solid fa-right-left',
	};

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
	const grantedCount = computed(
		() => definitions.value.filter((definition) => grantFor(definition.id) !== undefined).length,
	);
	const groupedDefinitions = computed(() =>
		CATEGORY_GROUPS.map((group) => ({
			...group,
			definitions: definitions.value.filter(
				(definition) => (CAPABILITY_CATEGORIES[definition.id] ?? 'data') === group.id,
			),
		})).filter((group) => group.definitions.length > 0),
	);
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

	function capabilityName(capability: AgentCapability): string {
		return CAPABILITY_CATEGORIES[capability]
			? t(`agent.settings.apps.capabilities.${capability}.name`)
			: t('agent.settings.apps.capabilityUnknownName');
	}

	function capabilityDescription(capability: AgentCapability): string {
		return CAPABILITY_CATEGORIES[capability]
			? t(`agent.settings.apps.capabilities.${capability}.desc`)
			: t('agent.settings.apps.capabilityUnknownDesc');
	}

	function capabilityIcon(capability: AgentCapability): string {
		return CAPABILITY_ICONS[capability] ?? 'fa-solid fa-key';
	}

	function grantFor(capability: AgentCapability) {
		return grantDraft.value.find((grant) => grant.capability === capability);
	}

	function setGrant(capability: AgentCapability, enabled: boolean): void {
		if (grantBlocked.value) return;
		if (!enabled) {
			grantDraft.value = grantDraft.value.filter((grant) => grant.capability !== capability);
			return;
		}
		if (grantFor(capability)) return;
		const definition = definitions.value.find((item) => item.id === capability);
		if (definition) {
			grantDraft.value.push({ capability, scope: structuredClone(toRaw(definition.defaultScope)) });
		}
	}

	function setAllGrants(enabled: boolean): void {
		if (grantBlocked.value) return;
		if (!enabled) {
			grantDraft.value = grantDraft.value.filter((grant) =>
				definitions.value.some((definition) => definition.id === grant.capability),
			);
			for (const definition of definitions.value) setGrant(definition.id, false);
			return;
		}
		for (const definition of definitions.value) setGrant(definition.id, true);
	}

	function modeFor(capability: AgentCapability): string {
		const scope = grantFor(capability)?.scope;
		return scope?.kind === 'targets' ? (scope.ssh?.mode ?? 'none') : 'none';
	}

	function selectMode(capability: AgentCapability, event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) return;
		const grant = grantFor(capability);
		if (!grant || grant.scope.kind !== 'targets') return;
		const value = event.target.value;
		if (value === 'none') grant.scope.ssh = null;
		else if (value === 'all') grant.scope.ssh = { mode: 'all' };
		else if (value === 'ids') grant.scope.ssh = { mode: 'ids', ids: [] };
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

	function toggleOverride(key: (typeof AGENT_EXECUTION_INTEGER_KEYS)[number], enabled: boolean): void {
		if (policyBlocked.value || !policy.value) return;
		if (enabled) policyDraft.value[key] = policy.value.effective[key];
		else delete policyDraft.value[key];
	}

	function selectProfile(event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) return;
		const selected = event.target.value;
		policyDraft.value.contextProfile = AGENT_EXECUTION_CONTEXT_PROFILES.find((value) => value === selected);
	}

	function selectCompaction(event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) return;
		const selected = event.target.value;
		policyDraft.value.contextCompactionMode = AGENT_EXECUTION_COMPACTION_MODES.find((value) => value === selected);
	}

	function profileLabel(value: (typeof AGENT_EXECUTION_CONTEXT_PROFILES)[number]): string {
		return t('agent.settings.executionPolicy.profile.' + value);
	}

	function compactionLabel(value: (typeof AGENT_EXECUTION_COMPACTION_MODES)[number]): string {
		return t('agent.settings.executionPolicy.compaction.' + value);
	}
</script>
<template>
	<div class="space-y-4">
		<section class="space-y-3 rounded-xl border border-border/70 bg-background/40 p-3.5">
			<header class="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div class="flex items-center gap-2">
						<i class="fa-solid fa-shield-halved text-[11px] text-primary" aria-hidden="true"></i>
						<h4 class="text-xs font-semibold text-foreground">
							{{ t('agent.settings.appManagement.grants') }}
						</h4>
					</div>
					<p class="mt-1 max-w-2xl text-[11px] leading-4 text-text-secondary">
						{{ t('agent.settings.appManagement.grantHelp') }}
					</p>
				</div>
				<span class="rounded-full bg-header px-2.5 py-1 text-[10px] font-medium text-text-secondary">
					{{ t('agent.settings.apps.grantedCount', { granted: grantedCount, total: definitions.length }) }}
				</span>
			</header>
			<p v-if="grantOperation.notice.value" role="status" class="text-xs">
				{{ t('agent.settings.appManagement.' + grantOperation.notice.value) }}
			</p>
			<p v-if="grantOperation.refreshRequired.value" class="text-xs text-warning">
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>
			<div class="flex flex-wrap items-center gap-1.5">
				<UiButton
					v-if="grantOperation.refreshRequired.value || grantOperation.notice.value === 'failed'"
					density="compact"
					type="button"
					:disabled="grantOperation.busy.value"
					@click="loadGrants"
				>
					{{ t('agent.settings.appManagement.readGrants') }}
				</UiButton>
				<UiButton density="compact" appearance="ghost" :disabled="grantBlocked" @click="setAllGrants(true)">
					{{ t('agent.settings.apps.enableAllCapabilities') }}
				</UiButton>
				<UiButton density="compact" appearance="ghost" :disabled="grantBlocked" @click="setAllGrants(false)">
					{{ t('agent.settings.apps.disableAllCapabilities') }}
				</UiButton>
			</div>
			<div
				v-for="grant in unavailableGrants"
				:key="grant.capability"
				class="space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-[11px] text-warning"
			>
				<p>
					{{
						t('agent.settings.appManagement.unavailableGrant', {
							capability: capabilityName(grant.capability),
						})
					}}
				</p>
				<UiButton
					density="compact"
					appearance="ghost"
					type="button"
					@click="grantDraft = grantDraft.filter((item) => item.capability !== grant.capability)"
				>
					{{ t('common.delete') }}
				</UiButton>
			</div>
			<fieldset :disabled="grantBlocked" class="space-y-3">
				<section v-for="group in groupedDefinitions" :key="group.id" class="space-y-2">
					<div
						class="flex items-center gap-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary"
					>
						<i :class="group.icon" class="text-[9px] text-primary" aria-hidden="true"></i>
						<span>{{ t(group.label) }}</span>
					</div>
					<div class="grid gap-2 md:grid-cols-2">
						<article
							v-for="definition in group.definitions"
							:key="definition.id"
							class="rounded-xl border p-3 transition-colors"
							:class="
								grantFor(definition.id)
									? 'border-primary/30 bg-primary/[0.035]'
									: 'border-border/60 bg-card/65'
							"
						>
							<div class="flex items-start gap-2.5">
								<UiCheckbox
									density="compact"
									:model-value="grantFor(definition.id) !== undefined"
									:aria-label="capabilityName(definition.id)"
									@update:model-value="(checked) => setGrant(definition.id, checked)"
								/>
								<span
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-header text-text-secondary"
								>
									<i
										:class="capabilityIcon(definition.id)"
										class="text-[10px]"
										aria-hidden="true"
									></i>
								</span>
								<div class="min-w-0">
									<div class="text-xs font-semibold text-foreground">
										{{ capabilityName(definition.id) }}
									</div>
									<p class="mt-1 text-[11px] leading-4 text-text-secondary">
										{{ capabilityDescription(definition.id) }}
									</p>
								</div>
							</div>
							<div
								v-if="grantFor(definition.id) && definition.scopeKind === 'targets'"
								class="mt-2.5 border-t border-border/45 pt-2.5"
							>
								<label class="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
									<span>{{ t('agent.settings.appManagement.sshScope') }}</span>
									<select
										:value="modeFor(definition.id)"
										class="h-8 rounded-lg border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary/45"
										@change="selectMode(definition.id, $event)"
									>
										<option value="none">{{ t('agent.settings.appManagement.noTargets') }}</option>
										<option value="all">{{ t('agent.settings.appManagement.allSsh') }}</option>
										<option value="ids">{{ t('agent.settings.appManagement.selectedSsh') }}</option>
									</select>
								</label>
								<AgentTargetPicker
									v-if="modeFor(definition.id) === 'ids'"
									class="mt-2"
									:items="targets"
									:model-value="idsFor(definition.id)"
									:max="AGENT_GRANT_MAX_TARGET_IDS"
									@update:model-value="(ids) => setIds(definition.id, ids)"
								/>
							</div>
						</article>
					</div>
				</section>
				<p
					v-if="definitions.length === 0"
					class="rounded-lg bg-background/55 px-3 py-6 text-center text-xs text-text-secondary"
				>
					{{ t('agent.settings.apps.noCapabilities') }}
				</p>
				<UiButton type="button" appearance="solid" tone="primary" :disabled="grantBlocked" @click="saveGrants">
					{{ t('agent.settings.appManagement.saveGrants') }}
				</UiButton>
			</fieldset>
		</section>
		<section class="space-y-3 rounded-xl border border-border/70 bg-background/40 p-3.5">
			<header>
				<div class="flex items-center gap-2">
					<i class="fa-solid fa-sliders text-[11px] text-primary" aria-hidden="true"></i>
					<h4 class="text-xs font-semibold text-foreground">
						{{ t('agent.settings.appManagement.policy') }}
					</h4>
				</div>
				<p class="mt-1 text-[11px] leading-4 text-text-secondary">
					{{ t('agent.settings.appManagement.policyHelp') }}
				</p>
			</header>
			<p v-if="policyOperation.notice.value" role="status" class="text-xs">
				{{ t('agent.settings.appManagement.' + policyOperation.notice.value) }}
			</p>
			<p v-if="policyOperation.refreshRequired.value" class="text-xs text-warning">
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>
			<UiButton
				v-if="policyOperation.refreshRequired.value || policyOperation.notice.value === 'failed'"
				density="compact"
				type="button"
				:disabled="policyOperation.busy.value"
				@click="loadPolicy"
			>
				{{ t('agent.settings.appManagement.readPolicy') }}
			</UiButton>
			<fieldset v-if="policy" :disabled="policyBlocked" class="space-y-3">
				<div class="grid gap-2 sm:grid-cols-2">
					<div
						v-for="key in AGENT_EXECUTION_INTEGER_KEYS"
						:key="key"
						class="space-y-1.5 rounded-lg border border-border/55 bg-card/65 p-2.5"
					>
						<label class="flex items-center gap-2 text-[11px] font-medium text-foreground">
							<UiCheckbox
								density="compact"
								:model-value="policyDraft[key] !== undefined"
								@update:model-value="(checked) => toggleOverride(key, checked)"
							/>
							{{ t('agent.settings.executionPolicy.fields.' + key) }}
						</label>
						<input
							v-if="policyDraft[key] !== undefined"
							v-model.number="policyDraft[key]"
							type="number"
							min="1"
							step="1"
							:aria-label="t('agent.settings.executionPolicy.fields.' + key)"
							class="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
						/>
						<p class="text-[10px] text-text-secondary">
							{{ t('agent.settings.appManagement.effective', { value: policy.effective[key] }) }}
						</p>
					</div>
				</div>
				<label class="block space-y-1.5 text-[11px] font-medium text-foreground">
					<span>{{ t('agent.settings.executionPolicy.fields.contextProfile') }}</span>
					<select
						:value="policyDraft.contextProfile ?? ''"
						class="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
						@change="selectProfile"
					>
						<option value="">
							{{
								t('agent.settings.appManagement.inherit', {
									value: profileLabel(policy.effective.contextProfile),
								})
							}}
						</option>
						<option v-for="value in AGENT_EXECUTION_CONTEXT_PROFILES" :key="value" :value="value">
							{{ profileLabel(value) }}
						</option>
					</select>
				</label>
				<label class="block space-y-1.5 text-[11px] font-medium text-foreground">
					<span>{{ t('agent.settings.executionPolicy.fields.contextCompactionMode') }}</span>
					<select
						:value="policyDraft.contextCompactionMode ?? ''"
						class="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/45"
						@change="selectCompaction"
					>
						<option value="">
							{{
								t('agent.settings.appManagement.inherit', {
									value: compactionLabel(policy.effective.contextCompactionMode),
								})
							}}
						</option>
						<option v-for="value in AGENT_EXECUTION_COMPACTION_MODES" :key="value" :value="value">
							{{ compactionLabel(value) }}
						</option>
					</select>
				</label>
				<UiButton type="button" appearance="solid" tone="primary" :disabled="policyBlocked" @click="savePolicy">
					{{ t('common.save') }}
				</UiButton>
			</fieldset>
		</section>
		<p v-if="directoryOperation.notice.value" role="alert" class="text-xs text-warning">
			{{ t('agent.settings.appManagement.targetsFailed') }}
		</p>
		<UiButton type="button" density="compact" :disabled="directoryOperation.busy.value" @click="loadTargets">
			{{ t('agent.settings.appManagement.readTargets') }}
		</UiButton>
	</div>
</template>
