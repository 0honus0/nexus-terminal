<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
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
	const blocked = computed(() => !canWrite());

	function choosePackage(event: Event): void {
		if (event.target instanceof HTMLInputElement) {
			file.value = event.target.files?.[0] ?? null;
			event.target.value = '';
		}
	}
</script>
<template>
	<section class="space-y-4 rounded-xl border border-border bg-card p-4">
		<h3>{{ t('agent.pluginManagement.title') }}</h3>
		<p class="text-sm text-text-secondary">{{ t('agent.pluginManagement.help') }}</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="operation.refreshRequired.value" class="text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<UiButton type="button" :disabled="operation.busy.value" @click="load">{{
			t('agent.pluginManagement.reload')
		}}</UiButton>
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
		<form class="space-y-2 rounded border border-border p-3" @submit.prevent="trust">
			<h4>{{ t('agent.pluginManagement.publishers') }}</h4>
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
				<p>{{ publisher.label }} · {{ publisher.keyId }} · v{{ publisher.version }}</p>
				<UiButton
					type="button"
					:disabled="blocked || publisher.revokedAt !== null"
					@click="revoke(publisher)"
					>{{ t('agent.pluginManagement.revoke') }}</UiButton
				>
			</div>
		</form>
		<AppScopedSettings :title="t('agent.pluginManagement.upload')">
			<template #default="{ appId }">
				<p class="text-sm">{{ t('agent.pluginManagement.uploadHelp') }}</p>
				<input
					type="file"
					:disabled="blocked"
					:aria-label="t('agent.pluginManagement.upload')"
					@change="choosePackage"
				/>
				<p v-if="file" class="text-xs">{{ file.name }} · {{ file.size }} B</p>
				<UiButton
					type="button"
					:disabled="blocked || !file"
					@click="
						uploadAppId = appId;
						preparePackage();
					"
					>{{ t('agent.pluginManagement.stage') }}</UiButton
				>
			</template>
		</AppScopedSettings>
		<p v-if="uploadReservation" class="break-all text-xs">
			{{ t('agent.pluginManagement.reservation') }}: {{ uploadReservation.appId }} / {{ uploadReservation.id }} ·
			v{{ uploadReservation.version }}
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
						{{ stage.manifest?.displayName }} · {{ stage.manifest?.version }} · {{ stage.id }}
					</option>
				</select></label
			>
			<article v-for="stage in stages" :key="stage.id" class="space-y-1 border-t border-border py-2 text-xs">
				<p class="break-all">
					{{ stage.id }} · v{{ stage.version }} · {{ stage.status }} · {{ stage.sizeBytes }} B
				</p>
				<p class="break-all">
					{{ stage.manifest?.id }} · {{ stage.manifest?.version }} · {{ stage.packageHash }}
				</p>
				<UiButton type="button" :disabled="blocked || stage.status !== 'staged'" @click="verify(stage)">{{
					t('agent.pluginManagement.verify')
				}}</UiButton>
				<UiButton type="button" :disabled="blocked || stage.status !== 'verified'" @click="install(stage)">{{
					t('agent.pluginManagement.install')
				}}</UiButton>
			</article>
		</div>
		<div class="space-y-2 rounded border border-border p-3">
			<h4>{{ t('agent.pluginManagement.installations') }}</h4>
			<p class="text-sm text-text-secondary">{{ t('agent.pluginManagement.retirementHelp') }}</p>
			<article
				v-for="installation in installations"
				:key="installation.appId"
				class="space-y-2 border-t border-border py-2 text-xs"
			>
				<p class="break-all">
					{{ installation.appId }} · {{ installation.definitionId }} · {{ installation.version }} · r{{
						installation.revision
					}}
					· {{ installation.status }}
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
		<div class="space-y-2 rounded border border-border p-3">
			<h4>{{ t('agent.pluginManagement.runtime') }}</h4>
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
		</div>
		<PluginRepositorySettings />
	</section>
</template>
