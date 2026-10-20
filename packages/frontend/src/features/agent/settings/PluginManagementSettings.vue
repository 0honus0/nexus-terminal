<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
	import { usePluginManagement } from '../composables/use-plugin-management';
	import AppScopedSettings from './AppScopedSettings.vue';
	import PluginRepositorySettings from './PluginRepositorySettings.vue';
	import PluginDataEditor from './PluginDataEditor.vue';

	const { t } = useI18n();
	const {
		publishers,
		installations,
		stages,
		versions,
		selectedStageId,
		candidate,
		candidateInstallation,
		applyCandidate,
		label,
		publicKeyPem,
		runtime,
		runtimeAppId,
		runtimeInstanceId,
		runtimeAcknowledged,
		mutationUnknown,
		acknowledged,
		uploadReservation,
		uploadAppId,
		file,
		operation,
		canWrite,
		load,
		trust,
		revoke,
		preparePackage,
		verify,
		install,
		retire,
		upgrade,
		readRuntime,
		acknowledgeRuntime,
		newIntent,
	} = usePluginManagement();
	const showPublishers = ref(false);
	const blocked = computed(() => !canWrite());

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
			<details class="space-y-2">
				<summary class="cursor-pointer text-sm text-text-secondary">
					{{ t('agent.pluginManagement.stages') }}
				</summary>
				<p v-if="uploadReservation" class="break-all text-xs">
					{{ t('agent.pluginManagement.reservation') }}: {{ uploadReservation.appId }} /
					{{ uploadReservation.id }} · v{{ uploadReservation.version }}
				</p>
				<div class="space-y-2 rounded border border-border p-3">
					<h4>{{ t('agent.pluginManagement.stages') }}</h4>
					<label class="block text-sm"
						>{{ t('agent.pluginManagement.selectedStage')
						}}<select
							v-model="selectedStageId"
							:disabled="operation.busy.value"
							class="ml-2 rounded border border-border bg-background p-2"
						>
							<option value="">—</option>
							<option
								v-for="stage in stages.filter((item) => item.status === 'verified')"
								:key="stage.id"
								:value="stage.id"
							>
								{{ stage.manifest?.displayName }} · {{ stage.manifest?.version }}
							</option>
						</select></label
					>
					<article
						v-for="stage in stages"
						:key="stage.id"
						class="space-y-1 border-t border-border py-2 text-xs"
					>
						<p class="break-all">
							{{ stage.id }} · v{{ stage.version }} · {{ stage.status }} · {{ stage.sizeBytes }} B
						</p>
						<p class="break-all">
							{{ stage.manifest?.id }} · {{ stage.manifest?.version }} · {{ stage.packageHash }}
						</p>
						<UiButton
							type="button"
							:disabled="blocked || stage.status !== 'staged'"
							@click="verify(stage)"
							>{{ t('agent.pluginManagement.verify') }}</UiButton
						>
						<UiButton
							type="button"
							:disabled="blocked || stage.status !== 'verified'"
							@click="install(stage)"
							>{{ t('agent.pluginManagement.install') }}</UiButton
						>
					</article>
				</div>
			</details>
			<div class="space-y-2 rounded border border-border p-3">
				<h4>{{ t('agent.pluginManagement.installations') }}</h4>
				<article
					v-for="installation in installations"
					:key="installation.appId"
					class="space-y-2 border-t border-border py-2 text-xs"
				>
					<p class="break-all">
						{{ installation.definitionId }} · {{ installation.version }} · {{ installation.status }}
					</p>
					<div class="flex flex-wrap gap-2">
						<UiButton
							type="button"
							:disabled="blocked || installation.status === 'removed'"
							@click="retire(installation, false)"
							>{{ t('agent.pluginManagement.remove') }}</UiButton
						>
						<UiButton
							type="button"
							:disabled="blocked || installation.status !== 'draining'"
							@click="retire(installation, true)"
							>{{ t('agent.pluginManagement.cancelRetirement') }}</UiButton
						>
						<UiButton
							type="button"
							:disabled="blocked || installation.status !== 'installed' || !selectedStageId"
							@click="upgrade(installation, true)"
							>{{ t('agent.pluginManagement.prepareUpgrade') }}</UiButton
						>
						<UiButton
							type="button"
							:disabled="blocked || installation.status !== 'draining' || !selectedStageId"
							@click="upgrade(installation, false)"
							>{{ t('agent.pluginManagement.upgrade') }}</UiButton
						>
					</div>
					<PluginDataEditor
						:key="installation.appId + ':' + installation.revision"
						:installation="installation"
						:disabled="blocked"
						@changed="load"
					/>
				</article>
			</div>
			<details>
				<summary>{{ t('agent.pluginManagement.versions') }}</summary>
				<p v-for="version in versions" :key="version.packageHash" class="break-all text-xs">
					{{ version.manifest.id }} · {{ version.manifest.version }} · {{ version.packageHash }}
				</p>
			</details>
			<details class="space-y-2 rounded border border-border p-3">
				<summary class="cursor-pointer text-sm text-text-secondary">
					{{ t('agent.pluginManagement.runtime') }}
				</summary>
				<label class="block text-sm"
					>App<select
						v-model="runtimeAppId"
						:disabled="operation.busy.value"
						class="ml-2 rounded border border-border bg-background p-2"
						@change="runtime = null"
					>
						<option value="">—</option>
						<option v-for="item in installations" :key="item.appId" :value="item.appId">
							{{ item.definitionId }} · {{ item.appId }}
						</option>
					</select></label
				>
				<label class="block text-sm"
					>{{ t('agent.pluginManagement.instanceId')
					}}<input
						v-model="runtimeInstanceId"
						:disabled="operation.busy.value"
						class="ml-2 rounded border border-border bg-background p-2"
						@input="runtime = null"
				/></label>
				<UiButton
					type="button"
					:disabled="operation.busy.value || operation.refreshRequired.value || !runtimeAppId"
					@click="readRuntime"
					>{{ t('agent.pluginManagement.readRuntime') }}</UiButton
				>
				<p v-if="runtime" class="break-all text-xs">
					{{ runtime.appId }} · {{ runtime.instanceId }} · r{{ runtime.revision }} · {{ runtime.state }}
				</p>
				<UiCheckbox v-if="runtime?.state === 'unknown'" v-model="runtimeAcknowledged">{{
					t('agent.pluginManagement.runtimeAcknowledgement')
				}}</UiCheckbox>
				<UiButton
					v-if="runtime?.state === 'unknown'"
					type="button"
					:disabled="blocked || !runtimeAcknowledged"
					@click="acknowledgeRuntime"
					>{{ t('agent.pluginManagement.acknowledgeRuntime') }}</UiButton
				>
			</details>
			<PluginRepositorySettings />
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
