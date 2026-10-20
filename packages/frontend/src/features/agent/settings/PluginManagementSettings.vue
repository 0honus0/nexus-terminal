<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
	import { usePluginManagement } from '../composables/use-plugin-management';
	import AppScopedSettings from './AppScopedSettings.vue';
	import PluginRepositorySettings from './PluginRepositorySettings.vue';
	import PluginDataEditor from './PluginDataEditor.vue';
	import type { PluginInstallation } from '../model/plugin-types';

	const { t } = useI18n();
	const props = withDefaults(defineProps<{ active?: boolean; revision?: number }>(), { active: true, revision: 0 });
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
			installation.definitionId
		);
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
				<h3 class="text-sm font-semibold text-foreground">{{ t('agent.pluginManagement.title') }}</h3>
				<span
					class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
					><i class="fa-solid fa-store text-[9px]" aria-hidden="true"></i
					>{{ t('agent.settings.plugins.ecosystemBadge') }}</span
				><UiInfoHint :text="t('agent.pluginManagement.help')" />
			</div>
			<UiButton type="button" appearance="soft" :disabled="operation.busy.value" @click="load"
				><i class="fa-solid fa-arrows-rotate text-xs" aria-hidden="true"></i
				>{{ t('agent.pluginManagement.reload') }}</UiButton
			>
		</div>
		<div class="space-y-5 p-4 sm:p-5">
			<p v-if="operation.notice.value" role="status">
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<p v-if="operation.refreshRequired.value" class="text-warning">
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
					<input
						type="file"
						:disabled="blocked"
						:aria-label="t('agent.pluginManagement.upload')"
						@change="choosePackage($event, appId)"
					/>
					<p v-if="file" class="text-xs">{{ file.name }} · {{ file.size }} B</p>
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
				<div class="mt-3 rounded-lg bg-header/25 p-3.5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-sm font-bold text-foreground">{{ candidate.manifest?.displayName }}</span
						><span
							class="rounded-md border border-border/60 bg-header/40 px-2 py-0.5 font-mono text-xs text-text-secondary"
							>v{{ candidate.manifest?.version }}</span
						>
					</div>
					<p class="mt-2 break-all font-mono text-[11px] text-text-secondary">
						{{ candidate.publisherKeyId }}
					</p>
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
				<h4 class="text-sm font-semibold">{{ t('agent.settings.plugins.installed') }}</h4>
				<p v-if="!activeInstallations.length" class="text-xs text-text-secondary">
					{{ t('agent.settings.plugins.noneInstalled') }}
				</p>
				<article
					v-for="installation in activeInstallations"
					:key="installation.appId"
					class="rounded-xl border border-border bg-header/20 p-4 shadow-2xs"
				>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="break-words text-sm font-semibold">{{ installationName(installation) }}</p>
							<p class="mt-1 break-all font-mono text-xs text-text-secondary">
								{{ installation.definitionId }} · v{{ installation.version }}
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
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
				:active="active"
				:blocked="blocked || candidate !== null"
				@prepare="prepareCatalogEntry"
				@trust="trustCatalogPublisher"
				@recommend="emit('recommend')"
			/>
			<div class="overflow-hidden rounded-xl border border-border bg-header/20 shadow-2xs">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left hover:bg-header/30"
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
					class="space-y-3 border-t border-border bg-background/60 p-4"
					@submit.prevent="trust"
				>
					<fieldset :disabled="blocked" class="space-y-2">
						<label class="block text-sm"
							>{{ t('agent.pluginManagement.label')
							}}<input v-model="label" class="ml-2 rounded border border-border bg-background p-2"
						/></label>
						<label class="block text-sm"
							>{{ t('agent.pluginManagement.publicKey')
							}}<textarea
								v-model="publicKeyPem"
								class="mt-1 w-full rounded border border-border bg-background p-2"
							/>
						</label>
						<UiButton type="submit" :disabled="!label.trim() || !publicKeyPem.trim()">{{
							t('agent.pluginManagement.trust')
						}}</UiButton>
					</fieldset>
					<div
						v-for="publisher in publishers"
						:key="publisher.keyId"
						class="space-y-1 break-all border-t border-border py-2 text-xs"
					>
						<p>{{ publisher.label }} · {{ publisher.keyId }}</p>
						<UiButton
							type="button"
							:disabled="blocked || publisher.revokedAt !== null"
							@click="revoke(publisher)"
							>{{ t('agent.pluginManagement.revoke') }}</UiButton
						>
					</div>
				</form>
			</div>
		</div>
	</section>
</template>
