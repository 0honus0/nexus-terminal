<script setup lang="ts">
	import PluginInstallPlanPreview from './PluginInstallPlanPreview.vue';
	import { computed, ref, useId, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiInfoHint,
		UiInlineNotice,
		UiInput,
		UiModal,
		UiTextarea,
	} from '@/foundation/ui';
	import type { usePluginManagement } from '../composables/use-plugin-management';
	import PluginRepositorySettings from './PluginRepositorySettings.vue';
	import PluginInstanceSettings from './PluginInstanceSettings.vue';
	import type { ManagedApp } from '../../model/app-management-types';
	import type { PluginCatalogEntry, PluginPackageInstallation } from '../model/plugin-types';
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
		packageInstallations,
		retainedPackageIds,
		retirePackage,
		cancelPackageUpdate,
		versions,
		candidate,
		candidatePlan,
		installationPlanIncomplete,
		candidateCapabilities,
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
	const addingPublisher = ref(false);
	const publisherFormId = useId();
	const activePublishers = computed(() => publishers.value.filter((publisher) => publisher.revokedAt === null));
	let publisherDialogGeneration = 0;
	const settingsPackage = ref<PluginPackageInstallation | null>(null);
	const settingsName = computed(
		() =>
			versions.value.find((version) => version.packageHash === settingsPackage.value?.packageHash)?.manifest
				.displayName ??
			settingsPackage.value?.packageId ??
			'',
	);
	const blocked = computed(() => !props.active || !canWrite());
	let candidateTrigger: HTMLElement | null = null;
	watch(
		() => [candidate.value, blocked.value, props.active] as const,
		([stage, blocked, active]) => {
			if (!active) {
				candidateTrigger = null;
				return;
			}
			if (stage || blocked) return;
			const trigger = candidateTrigger;
			candidateTrigger = null;
			if (trigger?.isConnected) trigger.focus({ preventScroll: true });
		},
		{ flush: 'post' },
	);

	watch(
		() => [props.active, props.revision] as const,
		([active, revision], previous) => {
			if (active && (!previous || !previous[0] || previous[1] !== revision)) void load();
		},
		{ immediate: true },
	);

	watch(
		() => props.active,
		(active) => {
			if (!active) resetPublisherDialog();
		},
	);

	function resetPublisherDialog(): void {
		publisherDialogGeneration += 1;
		addingPublisher.value = false;
		label.value = '';
		publicKeyPem.value = '';
	}

	function openPublisherDialog(): void {
		if (blocked.value || candidate.value) return;
		resetPublisherDialog();
		addingPublisher.value = true;
	}

	function closePublisherDialog(): void {
		if (!operation.busy.value) resetPublisherDialog();
	}

	async function submitPublisher(): Promise<void> {
		if (blocked.value || !addingPublisher.value || !label.value.trim() || !publicKeyPem.value.trim()) return;
		const generation = publisherDialogGeneration;
		const confirmed = await trust();
		if (!confirmed || !props.active || generation !== publisherDialogGeneration) return;
		resetPublisherDialog();
		showPublishers.value = true;
	}

	async function prepareCandidate(entry: PluginCatalogEntry, source: string | null): Promise<void> {
		// Preparing disables the source button before the modal can capture its focus.
		candidateTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		await prepareCatalogEntry(entry, source);
	}

	function closeCandidate(): void {
		if (operation.busy.value) return;
		candidate.value = null;
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
			<UiInlineNotice v-if="!candidate && operation.refreshRequired.value" tone="warning" compact>
				{{ t('agent.settings.appManagement.refreshRequired') }}
				<template #actions>
					<UiButton type="button" density="compact" :disabled="operation.busy.value" @click="load">{{
						t('agent.pluginManagement.reload')
					}}</UiButton>
				</template>
			</UiInlineNotice>

			<UiInlineNotice v-if="!candidate && mutationUnknown" tone="warning">
				<p>{{ t('agent.pluginManagement.unknown') }}</p>
				<label class="inline-flex min-w-0 items-start gap-2 text-sm text-foreground">
					<UiCheckbox
						v-model="acknowledged"
						class="shrink-0"
						:aria-label="t('agent.pluginManagement.acknowledge')"
					/>
					<span class="min-w-0">{{ t('agent.pluginManagement.acknowledge') }}</span>
				</label>
				<UiButton
					type="button"
					:disabled="operation.busy.value || operation.refreshRequired.value || !acknowledged"
					@click="newIntent"
					>{{ t('agent.pluginManagement.newIntent') }}</UiButton
				>
			</UiInlineNotice>

			<UiInlineNotice v-if="installationPlanIncomplete" tone="warning">{{
				t('agent.settings.plugins.installPlanIncomplete')
			}}</UiInlineNotice>

			<PluginRepositorySettings
				:publishers="publishers"
				:installations="installations"
				:package-installations="packageInstallations"
				:retained-package-ids="retainedPackageIds"
				@retire-package="retirePackage"
				@cancel-package-update="cancelPackageUpdate"
				:versions="versions"
				:retained-app-ids="model.retainedAppIds.value"
				:clearing="operation.busy.value"
				:apps="apps"
				:active="active"
				:blocked="blocked || candidate !== null"
				@prepare="prepareCandidate"
				@trust="trustCatalogPublisher"
				@recommend="emit('recommend')"
				@official-publishers="officialPublisherIds = $event"
				@clear-data="model.clearData"
				@settings="settingsPackage = $event"
			/>

			<div class="overflow-hidden rounded-xl bg-header/25">
				<div class="flex min-w-0 items-center gap-2 px-4 py-3">
					<button
						type="button"
						class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-xs font-medium text-foreground"
						:aria-expanded="showPublishers"
						@click="showPublishers = !showPublishers"
					>
						<i class="fa-solid fa-key text-xs text-primary" aria-hidden="true"></i>
						<span class="min-w-0">{{ t('agent.pluginManagement.publishers') }}</span>
						<UiBadge class="font-mono" appearance="ghost" density="compact">{{
							activePublishers.length
						}}</UiBadge>
						<i
							:class="showPublishers ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'"
							class="text-[11px] text-text-secondary"
							aria-hidden="true"
						></i>
					</button>
					<UiButton
						type="button"
						appearance="ghost"
						density="compact"
						:disabled="blocked || candidate !== null"
						@click="openPublisherDialog"
					>
						<i class="fa-solid fa-plus text-[11px]" aria-hidden="true"></i
						>{{ t('agent.pluginManagement.addPublisher') }}
					</UiButton>
				</div>
				<div v-if="showPublishers" class="space-y-2 px-4 pb-4">
					<div
						v-for="publisher in activePublishers"
						:key="publisher.keyId"
						class="plugin-publishers__entry flex min-w-0 items-center gap-3 rounded-lg bg-card/30 px-3 py-2.5"
					>
						<div class="min-w-0 flex-1 space-y-1">
							<p class="truncate text-xs font-semibold text-foreground" :title="publisher.label">
								{{ publisher.label }}
							</p>
							<p class="truncate font-mono text-[10px] text-text-secondary" :title="publisher.keyId">
								{{ publisher.keyId }}
							</p>
						</div>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							density="compact"
							icon-only
							:aria-label="t('agent.pluginManagement.revoke')"
							:title="t('agent.pluginManagement.revoke')"
							:disabled="blocked"
							@click="revoke(publisher)"
						>
							<i class="fa-solid fa-ban text-[11px]" aria-hidden="true"></i>
						</UiButton>
					</div>
					<p v-if="!activePublishers.length" class="py-3 text-center text-xs text-text-secondary">
						{{ t('agent.pluginManagement.noTrustedPublishers') }}
					</p>
				</div>
			</div>
		</div>
		<UiModal
			v-if="addingPublisher"
			:visible="active"
			:title="t('agent.pluginManagement.addPublisher')"
			:close-on-backdrop="!operation.busy.value"
			:close-on-escape="!operation.busy.value"
			:focus-on-open="true"
			:restore-focus="true"
			@close="closePublisherDialog"
		>
			<form :id="publisherFormId" class="space-y-4" @submit.prevent="submitPublisher">
				<p class="text-xs leading-relaxed text-text-secondary">
					{{ t('agent.settings.plugins.publisherHint') }}
				</p>
				<label class="block space-y-2">
					<span class="text-xs font-medium text-foreground">{{
						t('agent.settings.plugins.publisherLabel')
					}}</span>
					<UiInput
						v-model="label"
						:aria-label="t('agent.settings.plugins.publisherLabel')"
						:disabled="blocked"
					/>
				</label>
				<label class="block space-y-2">
					<span class="text-xs font-medium text-foreground">{{
						t('agent.settings.plugins.publisherPem')
					}}</span>
					<UiTextarea
						v-model="publicKeyPem"
						:aria-label="t('agent.settings.plugins.publisherPem')"
						:min-rows="4"
						class="font-mono text-xs"
						:disabled="blocked"
					/>
				</label>
				<UiInlineNotice v-if="operation.refreshRequired.value || mutationUnknown" tone="warning" compact>{{
					t('agent.settings.appManagement.refreshRequired')
				}}</UiInlineNotice>
			</form>
			<template #footer>
				<div class="flex flex-wrap items-center justify-end gap-2">
					<UiButton type="button" :disabled="operation.busy.value" @click="closePublisherDialog">{{
						t('common.cancel')
					}}</UiButton>
					<UiButton
						type="submit"
						:form="publisherFormId"
						appearance="solid"
						tone="primary"
						:loading="operation.busy.value"
						:disabled="blocked || !label.trim() || !publicKeyPem.trim()"
						>{{ t('agent.pluginManagement.trust') }}</UiButton
					>
				</div>
			</template>
		</UiModal>
		<UiModal
			v-if="candidate"
			:visible="active"
			:title="t('agent.settings.plugins.package')"
			panel-class="!w-[calc(100vw-2rem)] !max-w-xl !p-4 sm:!p-6"
			content-class="space-y-3"
			:close-on-backdrop="!operation.busy.value"
			:close-on-escape="!operation.busy.value"
			:focus-on-open="true"
			@close="closeCandidate"
		>
			<template #header>
				<div class="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
					<div class="flex items-center gap-2 text-xs font-semibold text-foreground">
						<div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary">
							<i class="fa-solid fa-box-open text-xs" aria-hidden="true"></i>
						</div>
						<h2 class="text-sm font-semibold">{{ t('agent.settings.plugins.package') }}</h2>
					</div>
					<UiBadge tone="success" density="compact">{{
						t('agent.settings.plugins.signatureVerified')
					}}</UiBadge>
				</div>
			</template>
			<template v-if="candidate">
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
					<label class="inline-flex min-w-0 items-start gap-2 text-sm text-foreground">
						<UiCheckbox
							v-model="acknowledged"
							class="shrink-0"
							:aria-label="t('agent.pluginManagement.acknowledge')"
						/>
						<span class="min-w-0">{{ t('agent.pluginManagement.acknowledge') }}</span>
					</label>
					<UiButton
						type="button"
						:disabled="operation.busy.value || operation.refreshRequired.value || !acknowledged"
						@click="newIntent"
						>{{ t('agent.pluginManagement.newIntent') }}</UiButton
					>
				</UiInlineNotice>
				<p class="mt-2 text-xs leading-relaxed text-text-secondary">
					{{ t('agent.settings.plugins.packageHint') }}
				</p>
				<div class="mt-3 rounded-lg bg-header/25 p-3.5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="min-w-0 max-w-full text-sm font-bold text-foreground [overflow-wrap:anywhere]">{{
							candidate.manifest?.displayName
						}}</span
						><span
							class="max-w-full break-all rounded-md border border-border/60 bg-header/40 px-2 py-0.5 font-mono text-xs text-text-secondary"
							>v{{ candidate.manifest?.version }}</span
						>
					</div>
					<div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
						<span
							v-for="capability in candidateCapabilities"
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
					<PluginInstallPlanPreview v-if="candidatePlan" :plan="candidatePlan" :show-capabilities="false" />
					<details class="mt-2 text-[10px] text-text-secondary">
						<summary class="cursor-pointer">{{ t('agent.pluginManagement.technicalDetails') }}</summary>
						<dl class="mt-1.5 space-y-1 break-all font-mono">
							<div>publisher: {{ candidate.publisherKeyId }}</div>
							<div>package: {{ candidate.packageHash }}</div>
							<div>stage: {{ candidate.id }}</div>
							<div>size: {{ candidate.sizeBytes }} B</div>
						</dl>
					</details>
				</div>
			</template>
			<template #footer>
				<div class="flex flex-wrap items-center justify-end gap-2">
					<UiButton
						type="button"
						appearance="soft"
						class="max-w-full whitespace-nowrap"
						:disabled="operation.busy.value"
						@click="closeCandidate"
						>{{ t('common.cancel') }}</UiButton
					><UiButton
						type="button"
						appearance="solid"
						tone="primary"
						class="max-w-full whitespace-nowrap"
						:loading="operation.busy.value"
						:disabled="blocked"
						@click="applyCandidate"
						><i v-if="!operation.busy.value" class="fa-solid fa-download text-xs" aria-hidden="true"></i
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
			</template>
		</UiModal>
		<PluginInstanceSettings
			v-if="active && settingsPackage"
			:key="settingsPackage.packageHash"
			:installation="settingsPackage"
			:name="settingsName"
			:apps="apps"
			@close="settingsPackage = null"
		/>
	</section>
</template>
