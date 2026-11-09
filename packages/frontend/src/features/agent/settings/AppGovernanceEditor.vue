<script setup lang="ts">
	import { computed, toRaw } from 'vue';
	import { structurallyEqual } from '@/foundation/data';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiInfoHint, UiInlineNotice } from '@/foundation/ui';
	import PluginCapabilities from '../plugins/components/PluginCapabilities.vue';
	import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
	import type { ManagedApp } from '../model/app-management-types';
	import { useAppGovernance } from '../composables/use-app-governance';

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
	const definitions = computed(() =>
		(grants.value?.definitions ?? []).filter((definition) => props.app.capabilities.includes(definition.id)),
	);
	const grantedCount = computed(
		() => definitions.value.filter((definition) => grantFor(definition.id) !== undefined).length,
	);
	const unavailableGrants = computed(() =>
		grantDraft.value.filter((grant) => !definitions.value.some((definition) => definition.id === grant.capability)),
	);
	const grantBlocked = computed(
		() => grantOperation.busy.value || grantOperation.refreshRequired.value || grants.value === null,
	);

	function capabilityName(capability: AgentCapability): string {
		return t(`agent.settings.apps.capabilities.${capability}.name`);
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
					<UiBadge appearance="ghost" density="compact" class="font-mono"
						>{{ grantedCount }} / {{ definitions.length }}</UiBadge
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
						:loading="grantOperation.busy.value"
						:disabled="grantBlocked || !grantChanged"
						@click="saveGrants"
					>
						<i class="fa-solid fa-check" aria-hidden="true"></i>
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
				<UiInlineNotice v-for="grant in unavailableGrants" :key="grant.capability" tone="warning" compact>
					<span class="min-w-0 flex-1">
						{{
							t('agent.settings.appManagement.unavailableGrant', {
								capability: capabilityName(grant.capability),
							})
						}}
					</span>
					<template #actions>
						<UiButton
							density="compact"
							appearance="ghost"
							tone="warning"
							type="button"
							:disabled="grantBlocked"
							@click="grantDraft = grantDraft.filter((item) => item.capability !== grant.capability)"
						>
							{{ t('common.delete') }}
						</UiButton>
					</template>
				</UiInlineNotice>
			</div>
			<PluginCapabilities
				:capabilities="definitions.map((definition) => definition.id)"
				:granted="grantDraft.map((grant) => grant.capability)"
				:disabled="grantBlocked"
				:show-summary="false"
				editable
				@change="setGrant"
			/>
		</section>
	</div>
</template>
