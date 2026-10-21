<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
	import { usePluginManagement } from '../composables/use-plugin-management';
	import AppScopedSettings from './AppScopedSettings.vue';
	import PluginRepositorySettings from './PluginRepositorySettings.vue';
	import PluginDataEditor from './PluginDataEditor.vue';
	import type { PluginInstallation } from '../model/plugin-types';
	import type { ManagedApp } from '../model/app-management-types';
	import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
	import { formatAgentDate } from '../locale-format';

	const { t, te, locale } = useI18n();
	const props = withDefaults(defineProps<{ active?: boolean; revision?: number; apps?: ManagedApp[] }>(), {
		active: true,
		revision: 0,

		apps: () => [],
	});

	const emit = defineEmits<{ recommend: [] }>();
	const {
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
		uploadAppId,
		file,
		operation,
		canWrite,
		load,
		trust,
		revoke,
		preparePackage,
		prepareCatalogEntry,
		trustCatalogPublisher,
		retire,
		newIntent,
	} = usePluginManagement(() => props.active);
	const showPublishers = ref(false);
	const packageInput = ref<HTMLInputElement | null>(null);
	const blocked = computed(() => !props.active || !canWrite());
	watch(
		() => props.revision,
		() => {
			if (props.active) void load();
		},
	);
	const activeInstallations = computed(() => installations.value.filter((item) => item.status !== 'removed'));
	const removedInstallations = computed(() => installations.value.filter((item) => item.status === 'removed'));

	function installationName(installation: PluginInstallation): string {
		return (
			versions.value.find((item) => item.packageHash === installation.packageHash)?.manifest.displayName ??
			t('agent.settings.plugins.unknownPlugin')
		);
	}

	function installationApp(installation: PluginInstallation): ManagedApp | undefined {
		return props.apps.find((app) => app.id === installation.appId);
	}

	function installationState(installation: PluginInstallation): string {
		if (installation.status === 'draining') return t('agent.settings.plugins.stateDraining');
		const app = installationApp(installation);
		if (app?.enabled) return t('agent.settings.plugins.stateEnabled');
		if (app) return t('agent.settings.plugins.stateDisabled');
		return t('agent.settings.plugins.stateInstalled');
	}

	function installationStateClass(installation: PluginInstallation): string {
		if (installation.status === 'draining') return 'bg-warning/10 text-warning';
		const app = installationApp(installation);
		return app?.enabled ? 'bg-success/10 text-success' : 'bg-header text-text-secondary';
	}

	function pluginCapabilityName(capability: AgentCapability): string {
		const key = `agent.settings.apps.capabilities.${capability}.name`;
		return te(key) ? t(key) : t('agent.settings.apps.capabilityUnknownName');
	}

	function installationUpdatedAt(installation: PluginInstallation): string {
		return formatAgentDate(locale.value, new Date(installation.updatedAt), { dateStyle: 'medium' });
	}

	async function choosePackage(event: Event, appId: string): Promise<void> {
		if (event.target instanceof HTMLInputElement) {
			file.value = event.target.files?.[0] ?? null;
			event.target.value = '';
			candidate.value = null;
			uploadAppId.value = appId;
			await preparePackage();
		}
	}

	function openPackagePicker(): void {
		packageInput.value?.click();
	}
</script>
<template>
	<section
		class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
		:aria-label="t('agent.pluginManagement.title')"
	>
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5 sm:py-4"
		>
			<div class="flex items-center gap-2">
				<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.plugins.title') }}</h3>
				<span
					class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
					><i class="fa-solid fa-store text-[9px]" aria-hidden="true"></i
					>{{ t('agent.settings.plugins.ecosystemBadge') }}</span
				><UiInfoHint :text="t('agent.settings.plugins.remoteRepositoriesHint')" />
			</div>
			<UiButton type="button" appearance="soft" tone="neutral" :disabled="operation.busy.value" @click="load"
				><i
					:class="
						operation.busy.value
							? 'fa-solid fa-arrows-rotate fa-spin text-primary'
							: 'fa-solid fa-arrows-rotate text-text-secondary'
					"
					class="text-xs"
					aria-hidden="true"
				></i
				>{{ t('agent.pluginManagement.reload') }}</UiButton
			>
		</div>
		<div class="space-y-5 p-4 sm:p-5">
			<p v-if="operation.notice.value" role="status" class="rounded-lg bg-header/25 px-3 py-2 text-xs">
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<p
				v-if="operation.refreshRequired.value"
				class="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning"
			>
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>

			<template v-if="mutationUnknown">
				<p class="text-sm text-warning">{{ t('agent.pluginManagement.unknown') }}</p>
				<UiCheckbox v-model="acknowledged">{{ t('agent.pluginManagement.acknowledge') }}</UiCheckbox>
				<UiButton
					type="button"
					:disabled="operation.busy.value || operation.refreshRequired.value || !acknowledged"
					@click="newIntent"
					>{{ t('agent.pluginManagement.newIntent') }}</UiButton
				>
			</template>
			<AppScopedSettings :title="t('agent.pluginManagement.upload')">
				<template #default="{ appId }">
					<p class="text-sm">{{ t('agent.pluginManagement.uploadHelp') }}</p>
					<div class="flex flex-wrap items-center gap-2">
						<UiButton
							type="button"
							appearance="soft"
							tone="neutral"
							:disabled="blocked"
							@click="openPackagePicker"
						>
							<i class="fa-solid fa-file-arrow-up text-xs text-primary" aria-hidden="true"></i>
							{{ t('agent.settings.plugins.choosePackage') }}
						</UiButton>
						<input
							ref="packageInput"
							type="file"
							class="hidden"
							accept=".tar,application/x-tar"
							:disabled="blocked"
							:aria-label="t('agent.settings.plugins.choosePackage')"
							@change="choosePackage($event, appId)"
						/>
						<span v-if="file" class="min-w-0 truncate text-xs text-text-secondary">
							{{ file.name }} · {{ file.size }} B
						</span>
					</div>
				</template>
			</AppScopedSettings>
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
					<span class="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">{{
						t('agent.settings.plugins.signatureVerified')
					}}</span>
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

			<div class="space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h4 class="flex items-center gap-2 text-sm font-semibold text-foreground">
						<i class="fa-solid fa-boxes-stacked text-[11px] text-primary" aria-hidden="true"></i>
						{{ t('agent.settings.plugins.installed') }}
						<span
							class="rounded-full border border-border/60 bg-card px-2 py-0.5 font-mono text-[10px] text-text-secondary"
							>{{ activeInstallations.length }}</span
						>
					</h4>
				</div>
				<p
					v-if="!activeInstallations.length"
					class="rounded-xl border border-dashed border-border/70 bg-header/10 py-6 text-center text-xs text-text-secondary"
				>
					{{ t('agent.settings.plugins.noneInstalled') }}
				</p>
				<article
					v-for="installation in activeInstallations"
					:key="installation.appId"
					class="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs transition-colors hover:bg-header/20"
				>
					<div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
						<div class="flex min-w-0 items-start gap-3">
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-success/20 bg-success/10 text-success"
							>
								<i
									:class="
										installation.status === 'draining'
											? 'fa-solid fa-hourglass-half'
											: 'fa-solid fa-puzzle-piece'
									"
									class="text-base"
									aria-hidden="true"
								></i>
							</div>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<p class="break-words text-sm font-semibold text-foreground">
										{{ installationName(installation) }}
									</p>
									<span
										class="rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary"
										>v{{ installation.version }}</span
									>
									<span
										class="rounded-full px-2 py-0.5 text-[10px] font-medium"
										:class="installationStateClass(installation)"
										>{{ installationState(installation) }}</span
									>
								</div>
							</div>
						</div>
						<div class="flex shrink-0 flex-wrap justify-end gap-2">
							<UiButton
								type="button"
								appearance="soft"
								tone="danger"
								:disabled="blocked"
								@click="retire(installation, false)"
								>{{
									t(
										installation.status === 'draining'
											? 'agent.settings.plugins.continueUninstall'
											: 'agent.pluginManagement.remove',
									)
								}}</UiButton
							>
							<UiButton
								v-if="installation.status === 'draining'"
								type="button"
								:disabled="blocked"
								@click="retire(installation, true)"
								>{{ t('agent.pluginManagement.cancelRetirement') }}</UiButton
							>
						</div>
					</div>
					<details class="border-t border-border/40 px-4 py-2 text-[10px] text-text-secondary">
						<summary class="cursor-pointer">{{ t('agent.pluginManagement.technicalDetails') }}</summary>
						<dl class="mt-1.5 grid gap-x-4 gap-y-1 break-all font-mono sm:grid-cols-2">
							<div>app: {{ installation.appId }}</div>
							<div>definition: {{ installation.definitionId }}</div>
							<div>package: {{ installation.packageHash }}</div>
							<div>publisher: {{ installation.publisherKeyId }}</div>
							<div>revision: {{ installation.revision }}</div>
							<div>updated: {{ installationUpdatedAt(installation) }}</div>
						</dl>
					</details>
				</article>
			</div>
			<div v-if="removedInstallations.length" class="rounded-xl border border-error/30 bg-error/5 p-4">
				<div class="flex items-center gap-2 text-xs font-semibold text-error">
					<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i
					><span>{{ t('agent.settings.plugins.retainedData') }}</span>
				</div>
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
			/>
			<div class="overflow-hidden rounded-xl border border-border bg-header/20 shadow-2xs">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left select-none hover:bg-header/30"
					:aria-expanded="showPublishers"
					@click="showPublishers = !showPublishers"
				>
					<span class="flex items-center gap-2 text-xs font-medium text-foreground"
						><i class="fa-solid fa-key text-xs text-primary" aria-hidden="true"></i
						>{{ t('agent.pluginManagement.publishers')
						}}<span
							class="rounded-md border border-border/60 bg-card px-2 py-0.5 font-mono text-[11px] text-text-secondary"
							>{{ publishers.length }}</span
						></span
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
						<input
							v-model="label"
							type="text"
							data-no-highlight
							class="h-8 w-full rounded-lg border border-border/80 bg-card px-3 text-xs text-foreground outline-none placeholder:text-text-secondary/60 focus:border-border-hover"
							:placeholder="t('agent.settings.plugins.publisherLabel')"
						/>
						<textarea
							v-model="publicKeyPem"
							data-no-highlight
							class="h-24 w-full resize-y rounded-lg border border-border/80 bg-card p-2.5 font-mono text-xs text-foreground outline-none placeholder:text-text-secondary/60 focus:border-border-hover"
							:placeholder="t('agent.settings.plugins.publisherPem')"
						></textarea>
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
