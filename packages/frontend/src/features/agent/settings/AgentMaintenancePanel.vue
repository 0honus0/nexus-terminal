<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import { usePluginManagement } from '../composables/use-plugin-management';
	import PluginDataEditor from './PluginDataEditor.vue';
	const props = defineProps<{ active: boolean }>();
	const { t } = useI18n();
	const {
		stages,
		versions,
		selectedStageId,
		uploadReservation,
		operation,
		canWrite,
		verify,
		install,
		runtime,
		runtimeAppId,
		runtimeInstanceId,
		runtimeAcknowledged,
		readRuntime,
		acknowledgeRuntime,
		installations,
		load,
		mutationUnknown,
		acknowledged,
		newIntent,
	} = usePluginManagement(() => props.active);
	const blocked = computed(() => !props.active || !canWrite());
</script>
<template>
	<section class="mt-4 space-y-4">
		<h3 class="font-semibold">{{ t('agent.settings.tab') }}</h3>
		<UiButton type="button" :disabled="!active || operation.busy.value" @click="load">{{
			t('common.refresh')
		}}</UiButton>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<template v-if="mutationUnknown">
			<p class="text-sm text-warning">{{ t('agent.pluginManagement.unknown') }}</p>
			<UiCheckbox v-model="acknowledged">{{ t('agent.pluginManagement.acknowledge') }}</UiCheckbox>
			<UiButton
				type="button"
				:disabled="!active || operation.busy.value || operation.refreshRequired.value || !acknowledged"
				@click="newIntent"
				>{{ t('agent.pluginManagement.newIntent') }}</UiButton
			>
		</template>
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
					<UiButton
						type="button"
						:disabled="blocked || stage.status !== 'verified'"
						@click="install(stage)"
						>{{ t('agent.pluginManagement.install') }}</UiButton
					>
				</article>
			</div>
		</details>
		<section class="space-y-3 rounded border border-border p-3">
			<h4>{{ t('agent.pluginManagement.data') }}</h4>
			<article
				v-for="installation in installations"
				:key="installation.appId"
				class="border-t border-border py-2 text-xs"
			>
				<p class="break-all">{{ installation.definitionId }} · {{ installation.version }}</p>
				<PluginDataEditor
					:key="installation.appId + ':' + installation.revision"
					:installation="installation"
					:active="active"
					:disabled="blocked"
					@changed="load"
				/>
			</article>
		</section>
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
	</section>
</template>
