<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiCheckbox, UiInfoHint, UiInlineNotice, UiInput, UiTextarea } from '@/foundation/ui';
	import type { usePluginManagement } from '../composables/use-plugin-management';
	import PluginRepositorySettings from './PluginRepositorySettings.vue';
	import PluginDataEditor from './PluginDataEditor.vue';
	import type { PluginInstallation } from '../model/plugin-types';
	import type { ManagedApp } from '../model/app-management-types';
	import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

	const { t, te } = useI18n();
	const props = withDefaults(
		defineProps<{
			model: ReturnType<typeof usePluginManagement>;
			active?: boolean;
			revision?: number;
			apps?: ManagedApp[];
			embedded?: boolean;
		}>(),
		{
			active: true,
			revision: 0,

			apps: () => [],

			embedded: false,
		},
	);

	const emit = defineEmits<{ recommend: [] }>();
	const {
		officialPublisherIds,
		publishers,
		installations,
		versions,
		candidate,
		candidateInstallation,
		applyCandidate,
		label,
		publicKeyPem,
		mutationUnknown,
		acknowledged,
		operation,
		canWrite,
		load,
		trust,
		revoke,
		prepareCatalogEntry,
		trustCatalogPublisher,
		newIntent,
	} = props.model;
	const showPublishers = ref(false);
	const blocked = computed(() => !props.active || !canWrite());
	watch(
		() => [props.active, props.revision] as const,
		([active, revision], previous) => {
			if (active && (!previous || !previous[0] || previous[1] !== revision)) void load();
		},
		{ immediate: true },
	);
	const removedInstallations = computed(() => installations.value.filter((item) => item.status === 'removed'));

	function installationName(installation: PluginInstallation): string {
		return (
			versions.value.find((item) => item.packageHash === installation.packageHash)?.manifest.displayName ??
			t('agent.settings.plugins.unknownPlugin')
		);
	}

	function pluginCapabilityName(capability: AgentCapability): string {
		const key = `agent.settings.apps.capabilities.${capability}.name`;
		return te(key) ? t(key) : t('agent.settings.apps.capabilityUnknownName');
	}
</script>
<template>
	<section
		:class="embedded ? 'min-w-0' : 'ui-glass-panel overflow-hidden rounded-2xl'"
		:aria-label="t('agent.pluginManagement.title')"
	>
		<div
			v-if="!embedded"
			class="agent-settings-head ui-glass-chrome flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5 sm:py-4"
		>
			<div class="flex items-center gap-2">
				<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.plugins.title') }}</h3>
				<UiBadge tone="primary" density="compact"
					><i class="fa-solid fa-store text-[9px]" aria-hidden="true"></i
					>{{ t('agent.settings.plugins.ecosystemBadge') }}</UiBadge
				><UiInfoHint :text="t('agent.settings.plugins.remoteRepositoriesHint')" />
			</div>
		</div>
		<div :class="embedded ? 'space-y-4' : 'space-y-5 p-4 sm:p-5'">
			<UiInlineNotice v-if="operation.refreshRequired.value" tone="warning" compact>
				{{ t('agent.settings.appManagement.refreshRequired') }}
				<template #actions>
					<UiButton type="button" density="compact" :disabled="operation.busy.value" @click="load">{{
						t('agent.pluginManagement.reload')
					}}</UiButton>
				</template>
			</UiInlineNotice>

			<UiInlineNotice v-if="mutationUnknown" tone="warning">
				<p>{{ t('agent.pluginManagement.unknown') }}</p>
				<UiCheckbox v-model="acknowledged">{{ t('agent.pluginManagement.acknowledge') }}</UiCheckbox>
				<UiButton
					type="button"
					:disabled="operation.busy.value || operation.refreshRequired.value || !acknowledged"
					@click="newIntent"
					>{{ t('agent.pluginManagement.newIntent') }}</UiButton
				>
			</UiInlineNotice>

			<div
				v-if="candidate"
				class="rounded-xl border border-primary/50 bg-primary/5 p-4 shadow-xs ring-1 ring-primary/20"
			>
				<div class="flex items-center justify-between gap-2 border-b border-border pb-2.5">
					<div class="flex items-center gap-2 text-xs font-semibold text-foreground">
						<div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary">
							<i class="fa-solid fa-box-open text-xs" aria-hidden="true"></i>
						</div>
						{{ t('agent.settings.plugins.package') }}
					</div>
					<UiBadge tone="success" density="compact">{{
						t('agent.settings.plugins.signatureVerified')
					}}</UiBadge>
				</div>
				<p class="mt-2 text-xs leading-relaxed text-text-secondary">
					{{ t('agent.settings.plugins.packageHint') }}
				</p>
				<div class="mt-3 rounded-lg bg-header/25 p-3.5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-sm font-bold text-foreground">{{ candidate.manifest?.displayName }}</span
						><span
							class="rounded-md border border-border/60 bg-header/40 px-2 py-0.5 font-mono text-xs text-text-secondary"
							>v{{ candidate.manifest?.version }}</span
						>
					</div>
					<div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
						<span
							v-for="capability in candidate.manifest?.capabilities ?? []"
							:key="capability"
							class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-2 py-1 text-text-secondary"
						>
							<i class="fa-solid fa-key text-[9px] text-primary/70" aria-hidden="true"></i>
							{{ pluginCapabilityName(capability) }}
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-2 py-1 text-text-secondary"
						>
							<i class="fa-solid fa-right-left text-[9px] text-primary/70" aria-hidden="true"></i>
							{{
								t('agent.settings.plugins.intentCount', {
									count: candidate.manifest?.intents.length ?? 0,
								})
							}}
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-2 py-1 text-text-secondary"
						>
							<i class="fa-solid fa-desktop text-[9px]" aria-hidden="true"></i>
							UI:
							{{
								candidate.manifest?.frontendEntry
									? t('agent.settings.plugins.present')
									: t('agent.settings.plugins.absent')
							}}
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-2 py-1 text-text-secondary"
						>
							<i class="fa-solid fa-server text-[9px]" aria-hidden="true"></i>
							Backend:
							{{
								candidate.manifest?.backendEntry
									? t('agent.settings.plugins.present')
									: t('agent.settings.plugins.absent')
							}}
						</span>
					</div>
					<details class="mt-2 text-[10px] text-text-secondary">
						<summary class="cursor-pointer">{{ t('agent.pluginManagement.technicalDetails') }}</summary>
						<dl class="mt-1.5 space-y-1 break-all font-mono">
							<div>publisher: {{ candidate.publisherKeyId }}</div>
							<div>package: {{ candidate.packageHash }}</div>
							<div>stage: {{ candidate.id }}</div>
							<div>size: {{ candidate.sizeBytes }} B</div>
						</dl>
					</details>
					<div class="mt-3.5 flex justify-end gap-2 border-t border-border pt-3">
						<UiButton
							type="button"
							appearance="ghost"
							:disabled="operation.busy.value"
							@click="candidate = null"
							>{{ t('common.cancel') }}</UiButton
						><UiButton
							type="button"
							appearance="solid"
							tone="primary"
							:disabled="blocked"
							@click="applyCandidate"
							><i class="fa-solid fa-download text-xs" aria-hidden="true"></i
							>{{
								t(
									candidateInstallation
										? candidateInstallation.status === 'draining'
											? 'agent.pluginManagement.upgrade'
											: 'agent.pluginManagement.prepareUpgrade'
										: 'agent.pluginManagement.install',
								)
							}}</UiButton
						>
					</div>
				</div>
			</div>

			<PluginRepositorySettings
				:publishers="publishers"
				:installations="installations"
				:apps="apps"
				:active="active"
				:blocked="blocked || candidate !== null"
				@prepare="prepareCatalogEntry"
				@trust="trustCatalogPublisher"
				@recommend="emit('recommend')"
				@official-publishers="officialPublisherIds = $event"
			/>
			<UiInlineNotice v-if="removedInstallations.length" tone="danger">
				<strong class="text-xs font-semibold">{{ t('agent.settings.plugins.retainedData') }}</strong>
				<p class="mt-1 text-[11px] text-text-secondary">{{ t('agent.settings.plugins.retainedDataHint') }}</p>
				<div class="mt-3 space-y-2">
					<div
						v-for="installation in removedInstallations"
						:key="installation.appId"
						class="rounded-lg bg-header/25 p-3"
					>
						<p class="break-words text-xs">{{ installationName(installation) }}</p>
						<PluginDataEditor
							retained-only
							:key="installation.appId + ':' + installation.revision"
							:installation="installation"
							:disabled="blocked"
							:active="active"
							@changed="load"
						/>
					</div>
				</div>
			</UiInlineNotice>

			<div class="overflow-hidden rounded-xl bg-header/25">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left select-none hover:bg-header/30"
					:aria-expanded="showPublishers"
					@click="showPublishers = !showPublishers"
				>
					<span class="flex items-center gap-2 text-xs font-medium text-foreground"
						><i class="fa-solid fa-key text-xs text-primary" aria-hidden="true"></i
						>{{ t('agent.pluginManagement.publishers')
						}}<UiBadge class="font-mono" appearance="ghost" density="compact">{{
							publishers.length
						}}</UiBadge></span
					><i
						:class="showPublishers ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'"
						class="text-[11px] text-text-secondary"
						aria-hidden="true"
					></i>
				</button>

				<form
					v-if="showPublishers"
					class="space-y-4 border-t border-border bg-background/60 p-4"
					@submit.prevent="trust"
				>
					<p class="text-[11px] leading-relaxed text-text-secondary">
						{{ t('agent.settings.plugins.publisherHint') }}
					</p>
					<fieldset :disabled="blocked" class="space-y-2.5">
						<UiInput
							v-model="label"
							:placeholder="t('agent.settings.plugins.publisherLabel')"
							:aria-label="t('agent.settings.plugins.publisherLabel')"
						/>
						<UiTextarea
							v-model="publicKeyPem"
							:placeholder="t('agent.settings.plugins.publisherPem')"
							:aria-label="t('agent.settings.plugins.publisherPem')"
							:min-rows="4"
							class="font-mono"
						/>
						<div class="flex justify-end">
							<UiButton
								type="submit"
								appearance="solid"
								tone="primary"
								:disabled="!label.trim() || !publicKeyPem.trim()"
								>{{ t('agent.pluginManagement.trust') }}</UiButton
							>
						</div>
					</fieldset>
					<div class="space-y-2 border-t border-border pt-3">
						<div v-for="publisher in publishers" :key="publisher.keyId" class="rounded-lg bg-header/25 p-3">
							<div class="flex items-center justify-between gap-2">
								<span class="min-w-0 truncate text-xs font-semibold text-foreground">{{
									publisher.label
								}}</span>
								<UiButton
									v-if="publisher.revokedAt === null"
									type="button"
									appearance="soft"
									tone="danger"
									:disabled="blocked"
									@click="revoke(publisher)"
									>{{ t('agent.pluginManagement.revoke') }}</UiButton
								>
							</div>
							<p class="mt-1 break-all font-mono text-[11px] text-text-secondary">
								{{ publisher.keyId }}
							</p>
							<p v-if="publisher.revokedAt !== null" class="mt-1 text-[11px] text-error">
								{{ t('agent.settings.plugins.revoked') }}
							</p>
						</div>
					</div>
				</form>
			</div>
		</div>
	</section>
</template>
