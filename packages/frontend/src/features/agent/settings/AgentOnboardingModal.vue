<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiModal, UiInlineNotice } from '@/foundation/ui';
	import type { PluginEnablePlan } from '../plugins/model/plugin-onboarding-types';
	import PluginCapabilities from '../plugins/components/PluginCapabilities.vue';

	const props = defineProps<{
		visible: boolean;
		plan: PluginEnablePlan | null;
		busy: boolean;
		confirmDisabled: boolean;
		notice: string;
		needsRead: boolean;
	}>();
	const emit = defineEmits<{ close: []; confirm: []; read: [] }>();
	const { t } = useI18n();
	const packages = computed(
		() =>
			props.plan?.packages.map((item) => ({
				manifest: item.kind === 'plan' ? item.plan.target.stage.manifest : item.manifest,
				installed: item.kind === 'installed',
				dependencies:
					item.kind === 'plan'
						? item.plan.dependencies.map((dependency) =>
								dependency.kind === 'installed' ? dependency.manifest : dependency.stage.manifest,
							)
						: [],
			})) ?? [],
	);
	const capabilities = computed(() => [
		...new Set(
			packages.value.flatMap((item) =>
				[item.manifest, ...item.dependencies].flatMap((manifest) => manifest.capabilities),
			),
		),
	]);
</script>
<template>
	<UiModal
		:visible="visible"
		:title="t('agent.settings.onboarding.title')"
		:aria-label="t('agent.settings.onboarding.title')"
		:close-on-backdrop="!busy"
		:close-on-escape="!busy"
		:focus-on-open="true"
		:restore-focus="true"
		panel-class="max-w-xl p-4 sm:p-6 rounded-2xl"
		@close="emit('close')"
	>
		<div class="space-y-4">
			<p class="text-sm leading-relaxed text-text-secondary">{{ t('agent.settings.onboarding.description') }}</p>
			<div v-if="packages.length" class="divide-y divide-border/40 overflow-hidden rounded-xl bg-header/20">
				<div v-for="item in packages" :key="item.manifest.id" class="flex items-center gap-3 p-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
						><i
							:class="
								item.manifest.appContribution
									? 'fa-solid fa-robot'
									: item.manifest.contributionKinds.includes('ui')
										? 'fa-solid fa-comments'
										: 'fa-solid fa-puzzle-piece'
							"
							aria-hidden="true"
						></i
					></span>
					<div class="min-w-0 flex-1">
						<p class="break-words text-sm font-medium text-foreground">{{ item.manifest.displayName }}</p>
						<p class="mt-0.5 text-xs text-text-secondary">v{{ item.manifest.version }}</p>
					</div>
					<UiBadge :tone="item.installed ? 'success' : 'primary'" density="compact" class="shrink-0">{{
						t(item.installed ? 'agent.settings.onboarding.ready' : 'agent.settings.onboarding.required')
					}}</UiBadge>
				</div>
			</div>
			<div v-if="capabilities.length" class="overflow-hidden rounded-xl bg-header/20">
				<PluginCapabilities :capabilities="capabilities" />
			</div>
			<p v-if="plan" class="text-xs leading-relaxed text-text-secondary">
				{{ t('agent.settings.onboarding.subtitle') }}
			</p>
			<UiInlineNotice v-if="notice" tone="warning">{{
				t('agent.settings.appManagement.' + notice)
			}}</UiInlineNotice>
			<UiButton v-if="needsRead" type="button" :disabled="busy" @click="emit('read')">{{
				t('agent.settings.plugins.reverifyPackage')
			}}</UiButton>
		</div>
		<template #footer>
			<div class="agent-onboarding__actions">
				<UiButton
					appearance="solid"
					tone="primary"
					type="button"
					class="agent-onboarding__confirm"
					:loading="busy"
					:disabled="busy || confirmDisabled"
					@click="emit('confirm')"
					><i v-if="!busy" class="fa-solid fa-download shrink-0 text-xs" aria-hidden="true"></i
					><span>{{
						t(busy ? 'agent.settings.onboarding.installing' : 'agent.settings.onboarding.installAndEnable')
					}}</span></UiButton
				>
				<UiButton
					appearance="soft"
					tone="neutral"
					type="button"
					class="agent-onboarding__cancel"
					:disabled="busy"
					@click="emit('close')"
					>{{ t('agent.settings.onboarding.cancel') }}</UiButton
				>
			</div>
		</template>
	</UiModal>
</template>
<style scoped>
	.agent-onboarding__actions {
		display: flex;
		align-items: stretch;
		justify-content: flex-end;
		gap: 10px;
	}
	.agent-onboarding__confirm,
	.agent-onboarding__cancel {
		min-height: 44px;
		height: auto;
		padding-block: 10px;
		line-height: 1.4;
	}
	.agent-onboarding__confirm {
		min-width: 0;
	}
	.agent-onboarding__cancel {
		flex-shrink: 0;
	}
	@media (max-width: 639px) {
		.agent-onboarding__actions {
			flex-direction: column;
		}
	}
</style>
