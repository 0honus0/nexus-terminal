<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiCheckbox,
		UiConfirmationPanel,
		UiEmptyState,
		UiInlineNotice,
		UiPopover,
	} from '@/foundation/ui';
	import type { usePluginManagement } from '../composables/use-plugin-management';
	import type { PluginPackageInstallation } from '../model/plugin-types';
	import InstalledPluginRow from './InstalledPluginRow.vue';
	import { installedPluginRequirements, isPluginPackageReferenced } from '../model/plugin-package-rules';
	const props = defineProps<{ model: ReturnType<typeof usePluginManagement>; active: boolean }>();
	const emit = defineEmits<{ settings: [installation: PluginPackageInstallation] }>();
	const { t } = useI18n();
	const {
		packageInstallations,
		installations,
		versions,
		operation,
		load,
		retirePackage,
		cancelPackageUpdate,
		mutationUnknown,
		acknowledged,
		newIntent,
	} = props.model;
	const clearing = operation.busy;
	const locked = computed(() => !props.active || !props.model.canWrite());
	const packageRemoval = ref<{ packageId: string; revision: number } | null>(null);
	const clearPackageData = ref(false);
	const appRequirements = computed(() => installedPluginRequirements(packageInstallations.value, versions.value));
	const installedPackages = computed(() => {
		const packageVersions = new Map(versions.value.map((version) => [version.packageHash, version]));
		const appPackages = new Set(
			installations.value.filter((item) => item.status !== 'removed').map((item) => item.definitionId),
		);
		return packageInstallations.value
			.filter((item) => item.status !== 'removed')
			.flatMap((installation) => {
				const version = packageVersions.get(installation.packageHash);
				const exact =
					version?.manifest.id === installation.packageId &&
					version.manifest.version === installation.version &&
					version.publisherKeyId === installation.publisherKeyId;
				if (appPackages.has(installation.packageId) || (exact && version.manifest.appContribution !== null))
					return [];
				return [
					{
						installation,
						name: exact ? version.manifest.displayName : installation.packageId,
						settings: exact && version.manifest.settings !== null,
					},
				];
			});
	});
	const removalPackage = computed(
		() =>
			installedPackages.value.find(
				(item) =>
					item.installation.packageId === packageRemoval.value?.packageId &&
					item.installation.revision === packageRemoval.value?.revision,
			)?.installation,
	);

	function packageReferenced(installation: PluginPackageInstallation): boolean {
		return isPluginPackageReferenced(installation, installations.value, appRequirements.value);
	}

	function requestPackageRemoval(installation: PluginPackageInstallation): void {
		if (locked.value || packageReferenced(installation)) return;
		packageRemoval.value = { packageId: installation.packageId, revision: installation.revision };
		clearPackageData.value = false;
	}

	function confirmPackageRemoval(): void {
		if (!locked.value && removalPackage.value && !packageReferenced(removalPackage.value))
			void retirePackage(removalPackage.value, clearPackageData.value);
	}

	watch(
		() => props.active,
		(active) => {
			if (!active) packageRemoval.value = null;
		},
	);
</script>
<template>
	<section class="installed-plugins min-w-0 space-y-3" :aria-label="t('agent.settings.plugins.installedPlugins')">
		<h3 class="flex items-center gap-2 text-sm font-semibold text-foreground">
			<i class="fa-solid fa-puzzle-piece text-xs text-primary" aria-hidden="true"></i
			>{{ t('agent.settings.plugins.installedPlugins') }}
		</h3>
		<UiInlineNotice v-if="operation.recoveryRequired.value" tone="warning" compact>
			{{ t('agent.settings.appManagement.refreshRequired') }}
			<template #actions
				><UiButton :disabled="clearing" @click="load">{{
					t('agent.pluginManagement.reload')
				}}</UiButton></template
			>
		</UiInlineNotice>
		<UiInlineNotice v-if="mutationUnknown" tone="warning" compact>
			<p>{{ t('agent.pluginManagement.unknown') }}</p>
			<label class="flex min-w-0 items-start gap-2"
				><UiCheckbox v-model="acknowledged" :aria-label="t('agent.pluginManagement.acknowledge')" /><span>{{
					t('agent.pluginManagement.acknowledge')
				}}</span></label
			>
			<UiButton :disabled="clearing || operation.refreshRequired.value || !acknowledged" @click="newIntent">{{
				t('agent.pluginManagement.newIntent')
			}}</UiButton>
		</UiInlineNotice>
		<div class="installed-plugins__list">
			<InstalledPluginRow
				v-for="item in installedPackages"
				:key="item.installation.packageId"
				:data-package-id="item.installation.packageId"
				:name="item.name"
				:version="item.installation.version"
				:status-label="
					item.installation.status === 'installed'
						? ''
						: t(`agent.settings.plugins.packageStates.${item.installation.status}`)
				"
				status-tone="warning"
			>
				<template #actions>
					<UiPopover
						v-if="active && packageReferenced(item.installation)"
						:ariaLabel="t('agent.settings.plugins.packageReferenced')"
						:title="t('agent.settings.plugins.packageReferenced')"
						trigger-appearance="ghost"
						density="compact"
						icon-only
						align="end"
					>
						<template #trigger
							><i class="fa-solid fa-link text-[11px] text-text-secondary" aria-hidden="true"></i
						></template>
						<template #panel>
							<p class="max-w-64 text-xs leading-relaxed text-text-secondary">
								{{ t('agent.settings.plugins.packageReferenced') }}
							</p>
						</template>
					</UiPopover>
					<UiButton
						v-if="item.settings"
						type="button"
						appearance="ghost"
						density="compact"
						:title="t('agent.settings.plugins.settings.open')"
						:aria-label="t('agent.settings.plugins.settings.open')"
						:disabled="!active || locked || item.installation.status !== 'installed'"
						@click="emit('settings', item.installation)"
					>
						<i class="fa-solid fa-sliders text-[11px]" aria-hidden="true"></i
						><span data-installed-action-label>{{ t('agent.settings.plugins.settings.open') }}</span>
					</UiButton>
					<UiButton
						v-if="item.installation.status === 'draining'"
						type="button"
						appearance="ghost"
						density="compact"
						:title="t('agent.settings.plugins.cancelUpgrade')"
						:aria-label="t('agent.settings.plugins.cancelUpgrade')"
						:disabled="locked"
						@click="cancelPackageUpdate(item.installation)"
					>
						<i class="fa-solid fa-rotate-left text-[11px]" aria-hidden="true"></i
						><span data-installed-action-label>{{ t('agent.settings.plugins.cancelUpgrade') }}</span>
					</UiButton>
					<UiButton
						type="button"
						appearance="ghost"
						tone="danger"
						density="compact"
						:title="t('agent.settings.plugins.uninstallPackage')"
						:aria-label="t('agent.settings.plugins.uninstallPackage')"
						:disabled="locked || packageReferenced(item.installation)"
						@click="requestPackageRemoval(item.installation)"
					>
						<i class="fa-regular fa-trash-can text-[11px]" aria-hidden="true"></i
						><span data-installed-action-label>{{ t('agent.settings.plugins.uninstallPackage') }}</span>
					</UiButton>
				</template>
			</InstalledPluginRow>
		</div>
		<UiEmptyState
			v-if="!installedPackages.length && !operation.busy.value && !operation.refreshRequired.value"
			compact
			icon="fa-solid fa-puzzle-piece"
			:title="t('agent.settings.plugins.installedPluginsEmpty')"
		/>

		<UiConfirmationPanel
			:visible="active && Boolean(removalPackage)"
			:title="t('agent.settings.plugins.uninstallPackage')"
			:description="removalPackage?.packageId"
			tone="danger"
			:close-on-backdrop="!clearing"
			:close-on-escape="!clearing"
			@close="packageRemoval = null"
		>
			<label class="inline-flex min-w-0 items-start gap-2 text-sm text-foreground">
				<UiCheckbox
					v-model="clearPackageData"
					class="shrink-0"
					:aria-label="t('agent.settings.plugins.clearPackageData')"
					:disabled="clearing"
				/>
				<span class="min-w-0">{{ t('agent.settings.plugins.clearPackageData') }}</span>
			</label>
			<p class="text-sm leading-relaxed text-text-secondary">
				{{ t('agent.settings.plugins.packageDataScope') }}
			</p>
			<template #actions>
				<UiButton type="button" :disabled="clearing" @click="packageRemoval = null">{{
					t('common.cancel')
				}}</UiButton>
				<UiButton
					type="button"
					appearance="solid"
					tone="danger"
					:loading="clearing"
					:disabled="locked || !removalPackage || packageReferenced(removalPackage)"
					@click="confirmPackageRemoval"
					>{{ t('agent.settings.plugins.uninstallPackage') }}</UiButton
				>
			</template>
		</UiConfirmationPanel>
	</section>
</template>
<style scoped>
	.installed-plugins__list {
		display: grid;
		gap: 0.5rem;
	}
</style>
