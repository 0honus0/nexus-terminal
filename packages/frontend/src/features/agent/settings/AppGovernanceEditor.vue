<script setup lang="ts">
	import { computed, toRaw } from 'vue';
	import { structurallyEqual } from '@/foundation/data';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
	import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
	import type { ManagedApp } from '../model/app-management-types';
	import { useAppGovernance } from '../composables/use-app-governance';

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

	const props = defineProps<{ app: ManagedApp; active: boolean }>();
	const { t } = useI18n();
	const { grants, grantDraft, grantOperation, loadGrants, saveGrants } = useAppGovernance(
		props.app.id,
		'grants',
		() => props.active,
	);
	const grantChanged = computed(
		() =>
			!structurallyEqual(
				grantDraft.value,
				grants.value?.grants.map((grant) => ({ capability: grant.capability, scope: grant.scope })) ?? [],
			),
	);
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
			for (const definition of definitions.value) setGrant(definition.id, false);
			return;
		}
		for (const definition of definitions.value) setGrant(definition.id, true);
	}
</script>
<template>
	<div class="space-y-4">
		<section class="overflow-hidden rounded-xl bg-header/20">
			<header
				class="flex flex-col gap-3 border-b border-border/50 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between"
			>
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					<span
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
					>
						<i class="fa-solid fa-shield-halved text-[11px]" aria-hidden="true"></i>
					</span>
					<h4 class="text-xs font-bold text-foreground">
						{{ t('agent.settings.apps.capabilitiesHeader') }}
					</h4>
					<span class="rounded-full bg-background/60 px-2 py-0.5 font-mono text-[10px] text-text-secondary"
						>{{ grantedCount }} / {{ definitions.length }}</span
					>
					<UiInfoHint :text="t('agent.settings.apps.capabilitiesSubtitle')" />
				</div>
				<div class="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:shrink-0 md:items-center">
					<UiButton
						v-if="grantOperation.refreshRequired.value || grantOperation.notice.value === 'failed'"
						type="button"
						class="col-span-2 justify-center md:col-auto"
						:disabled="grantOperation.busy.value"
						@click="loadGrants"
						>{{ t('agent.settings.appManagement.readGrants') }}</UiButton
					>
					<UiButton
						v-if="definitions.length"
						appearance="soft"
						tone="neutral"
						type="button"
						class="justify-center"
						:disabled="grantBlocked"
						@click="setAllGrants(grantedCount !== definitions.length)"
					>
						<span
							class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current text-[9px]"
							aria-hidden="true"
						>
							<i v-if="grantedCount === definitions.length" class="fa-solid fa-check"></i>
							<i v-else-if="grantedCount" class="fa-solid fa-minus"></i>
						</span>
						{{
							t(
								grantedCount === definitions.length
									? 'agent.settings.apps.disableCapabilities'
									: 'agent.settings.apps.enableCapabilities',
							)
						}}
					</UiButton>
					<UiButton
						type="button"
						appearance="solid"
						tone="primary"
						class="justify-center"
						:disabled="grantBlocked || !grantChanged"
						@click="saveGrants"
					>
						<i
							:class="
								grantOperation.busy.value ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-check'
							"
							aria-hidden="true"
						></i>
						{{
							t(
								grantOperation.busy.value
									? 'agent.settings.apps.savingPermissions'
									: 'agent.settings.apps.savePermissions',
							)
						}}
					</UiButton>
				</div>
			</header>
			<div v-if="unavailableGrants.length" class="space-y-2 border-b border-border/50 px-4 py-3.5 sm:px-5">
				<div
					v-for="grant in unavailableGrants"
					:key="grant.capability"
					class="flex flex-wrap items-center gap-2 rounded-lg bg-warning/8 px-3 py-2 text-[11px] text-warning"
				>
					<span class="min-w-0 flex-1">
						{{
							t('agent.settings.appManagement.unavailableGrant', {
								capability: capabilityName(grant.capability),
							})
						}}
					</span>
					<UiButton
						density="compact"
						appearance="ghost"
						type="button"
						@click="grantDraft = grantDraft.filter((item) => item.capability !== grant.capability)"
					>
						{{ t('common.delete') }}
					</UiButton>
				</div>
			</div>
			<fieldset :disabled="grantBlocked" class="divide-y divide-border/45">
				<section v-for="group in groupedDefinitions" :key="group.id" class="px-4 py-4 sm:px-5">
					<div class="mb-3 flex items-center gap-2.5 text-[11px] font-semibold text-foreground">
						<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/8">
							<i :class="group.icon" class="text-[9px] text-primary" aria-hidden="true"></i>
						</span>
						<span>{{ t(group.label) }}</span>
						<span
							class="ml-auto rounded-full bg-background/60 px-2.5 py-1 font-mono text-[10px] font-normal text-text-secondary"
							>{{ group.definitions.filter((definition) => grantFor(definition.id)).length }} /
							{{ group.definitions.length }}</span
						>
					</div>
					<div class="grid gap-2.5 md:grid-cols-2">
						<article
							v-for="definition in group.definitions"
							:key="definition.id"
							class="rounded-xl px-3.5 py-3.5 ring-1 ring-inset transition-colors sm:px-4"
							:class="
								grantFor(definition.id)
									? 'bg-primary/8 ring-primary/25'
									: 'bg-background/25 ring-border/20 hover:bg-header/35 hover:ring-border/40'
							"
						>
							<div class="flex items-start gap-3">
								<UiCheckbox
									density="comfortable"
									class="mt-0.5 shrink-0"
									:model-value="grantFor(definition.id) !== undefined"
									:aria-label="capabilityName(definition.id)"
									@update:model-value="(checked) => setGrant(definition.id, checked)"
								/>
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<i
											:class="capabilityIcon(definition.id)"
											class="w-3.5 shrink-0 text-center text-[11px] text-text-secondary"
											aria-hidden="true"
										></i>
										<span class="text-xs font-semibold text-foreground">
											{{ capabilityName(definition.id) }}
										</span>
										<code
											class="rounded bg-header/60 px-1.5 py-0.5 font-mono text-[9px] leading-none text-text-secondary/70"
											>{{ definition.id }}</code
										>
									</div>
									<p class="mt-1.5 text-[11px] leading-[1.6] text-text-secondary">
										{{ capabilityDescription(definition.id) }}
									</p>
								</div>
							</div>
						</article>
					</div>
				</section>
				<p v-if="definitions.length === 0" class="px-3.5 py-8 text-center text-xs text-text-secondary">
					{{ t('agent.settings.apps.noCapabilities') }}
				</p>
			</fieldset>
		</section>
	</div>
</template>
