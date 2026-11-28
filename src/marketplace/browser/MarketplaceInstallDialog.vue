<script setup lang="ts">
	import { Check, Package, X } from '@lucide/vue';
	import { useTimeoutFn } from '@vueuse/core';
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { PluginManifest } from '../../plugin/plugin-manifest-types.js';
	import type { PluginReadiness, PluginRuntimeInfo } from '../../plugin/plugin-state-types.js';
	import { resolvePluginIcon } from '../../plugin/plugin-api.browser.js';
	import type { UiProgressState } from '../../ui/browser/ui-component-types.js';
	import {
		UiBadge,
		UiButton,
		UiDialog,
		UiList,
		UiListItem,
		UiProgressRow,
		UiScrollArea,
		UiSection,
	} from '../../ui/browser/ui-components-api.js';
	import type { MarketplaceInstallPlan, MarketplaceRepositorySource } from '../marketplace-install-types.js';
	import type { MarketplaceOperation, MarketplacePlugin } from '../marketplace-types.js';
	import {
		marketplaceInstalledStatus,
		marketplaceLabel,
		marketplacePackageName,
		marketplacePluginRuntime,
		marketplaceStatusTones,
	} from './marketplace-presentation.js';

	const props = defineProps<{
		target: MarketplaceRepositorySource;
		targetPackage?: PluginManifest;
		plan?: MarketplaceInstallPlan;
		planning: boolean;
		operation?: MarketplaceOperation;
		submitting: boolean;
		busy: boolean;
		installed?: readonly MarketplacePlugin[];
		loadingInstalled: boolean;
		pluginRuntime?: ReadonlyMap<string, PluginRuntimeInfo>;
		applications: readonly { key: string; id: string; pluginId: string; readiness: PluginReadiness }[];
	}>();
	const open = defineModel<boolean>('open', { required: true });
	const emit = defineEmits<{ confirm: []; retry: []; configure: [key: string]; finish: [] }>();
	const { t, locale } = useI18n({ useScope: 'global' });
	const targetPackage = computed(
		() =>
			props.targetPackage ??
			props.plan?.steps.find(({ package: item }) => item.name === props.target.pluginId)?.package,
	);
	const targetName = computed(() =>
		targetPackage.value
			? marketplacePackageName(targetPackage.value, locale.value)
			: marketplaceLabel(props.target.pluginId),
	);
	const targetIcon = computed(() => resolvePluginIcon(targetPackage.value?.nexus.icon));
	const stages = ['resolve', 'install', 'configure'] as const;
	const failed = computed(() => props.operation?.state === 'failed');
	const succeeded = computed(() => props.operation?.state === 'succeeded');
	const installing = computed(
		() => props.submitting || props.operation?.state === 'queued' || props.operation?.state === 'running',
	);
	// 快速完成时跳过进度页，已展开的进度至少保留到可以看清。
	const progressVisible = ref(false);
	const {
		isPending: holdingProgress,
		start: holdProgress,
		stop: stopHoldingProgress,
	} = useTimeoutFn(() => {}, 320, { immediate: false });
	const { start: revealProgress, stop: stopRevealingProgress } = useTimeoutFn(
		() => {
			progressVisible.value = true;
			holdProgress();
		},
		350,
		{ immediate: false },
	);
	watch([open, installing, succeeded, failed], ([isOpen, running, complete, hasFailed]) => {
		stopRevealingProgress();
		if (!isOpen || hasFailed || (!running && !complete)) {
			progressVisible.value = false;
			stopHoldingProgress();
		} else if (running && !complete && !progressVisible.value) {
			revealProgress();
		}
	});
	const stage = computed(() => {
		if (succeeded.value) return holdingProgress.value ? 'install' : 'configure';
		return failed.value || progressVisible.value ? 'install' : 'resolve';
	});
	const awaitingProgress = computed(() => stage.value === 'resolve' && installing.value);
	const stageBody = ref<HTMLElement>();
	watch(stage, () => stageBody.value?.scrollTo({ top: 0 }), { flush: 'post' });
	const canConfirm = computed(() => !!props.plan?.steps.length && !props.plan.blockers.length);
	const checking = computed(() => !props.installed || props.loadingInstalled);

	const installationRows = computed(() =>
		(props.plan?.steps ?? []).map<{ id: string; name: string; state: UiProgressState }>(({ package: pack }) => {
			const { operation } = props;
			const completed = succeeded.value || operation?.completedPackages?.includes(pack.name);
			const step = operation?.step;
			const current = step?.pluginId === pack.name && (step.phase === 'download' || step.phase === 'register');
			const state = completed ? 'succeeded' : current ? (failed.value ? 'failed' : 'running') : 'pending';
			return { id: pack.name, name: marketplacePackageName(pack, locale.value), state };
		}),
	);

	const configurationRows = computed(() =>
		(props.plan?.steps ?? []).map(({ package: pack }) => {
			const item = props.installed?.find(
				({ pluginId, version }) => pluginId === pack.name && version === pack.version,
			);
			const runtime = item ? marketplacePluginRuntime(item, props.pluginRuntime?.get(pack.name)) : null;
			const installedStatus = item
				? marketplaceInstalledStatus({ ...item, runtime })
				: checking.value
					? 'starting'
					: 'unavailable';
			const entries = props.applications.filter(({ pluginId }) => pluginId === pack.name);
			const frontend = entries[0]?.readiness;
			const reason =
				(runtime?.readiness.state === 'pending' ? runtime.readiness.reason : undefined) ??
				(frontend?.state === 'pending' ? frontend.reason : undefined);
			const status = installedStatus === 'available' && reason ? 'configuration' : installedStatus;
			const application = !reason
				? undefined
				: reason.applicationId
					? entries.find(({ id }) => id === reason.applicationId)
					: entries.length === 1
						? entries[0]
						: undefined;
			return {
				id: pack.name,
				name: marketplacePackageName(pack, locale.value),
				version: pack.version,
				status,
				application,
			};
		}),
	);
	const configured = computed(() =>
		configurationRows.value.every(({ status }) => status === 'available' || status === 'disabled'),
	);
	const stageSteps = computed(() => {
		const current = stages.indexOf(stage.value);
		const blocked = stage.value === 'resolve' && !props.planning && !canConfirm.value;
		const currentState = failed.value || blocked ? 'failed' : 'current';
		return stages.map((id, index) => {
			const complete =
				index < current ||
				(id === 'install' && succeeded.value) ||
				(id === 'configure' && stage.value === id && configured.value);
			return {
				id,
				current: index === current,
				state: complete ? 'complete' : index > current ? 'pending' : currentState,
			};
		});
	});
</script>

<template>
	<UiDialog
		v-model:open="open"
		class="marketplace-install-dialog"
		:title="t('marketplace.installFlow.title')"
		:close-label="t('closeApplication')"
	>
		<template #body>
			<div class="install-body">
				<UiScrollArea class="install-overview-frame" gutter="symmetric" overflow="hidden">
					<div class="install-overview">
						<div class="install-target">
							<span class="install-target__icon" aria-hidden="true">
								<component :is="targetIcon ?? Package" :size="20" />
							</span>
							<strong :title="targetName">{{ targetName }}</strong>
							<UiBadge class="install-target__version">v{{ target.version }}</UiBadge>
						</div>
						<ol class="install-stages" role="list" :aria-label="t('marketplace.installFlow.title')">
							<li
								v-for="(step, index) in stageSteps"
								:key="step.id"
								:aria-current="step.current ? 'step' : undefined"
								:data-state="step.state"
							>
								<span class="install-stages__marker" aria-hidden="true">
									<Check v-if="step.state === 'complete'" :size="15" />
									<X v-else-if="step.state === 'failed'" :size="15" />
									<template v-else>{{ index + 1 }}</template>
								</span>
								<span class="install-stages__label">{{ t('marketplace.installFlow.' + step.id) }}</span>
							</li>
						</ol>
					</div>
				</UiScrollArea>
				<UiScrollArea as-child gutter="symmetric">
					<div
						ref="stageBody"
						class="install-stage-body"
						role="region"
						:aria-label="t('marketplace.installFlow.' + stage)"
						:aria-busy="planning || awaitingProgress"
						tabindex="0"
					>
						<h3>{{ t('marketplace.installFlow.' + stage) }}</h3>
						<template v-if="stage === 'resolve'">
							<UiProgressRow
								v-if="planning"
								class="install-progress"
								:label="t('marketplace.installFlow.resolving')"
								state="running"
								status-label=""
								:show-progress="false"
							/>
							<p v-else-if="!plan" class="install-error" role="status">
								{{ t('notices.MARKETPLACE_INSTALL_PLAN_FAILED') }}
							</p>
							<template v-else>
								<UiSection v-if="plan.blockers.length" :title="t('marketplace.blockers')">
									<UiList>
										<UiListItem
											v-for="(issue, index) in plan.blockers"
											:key="index"
											:title="issue.pluginId"
											:description="t('marketplace.blocker.' + issue.code)"
										/>
									</UiList>
								</UiSection>
								<UiSection v-if="plan.affected?.length" :title="t('marketplace.affected')">
									<UiList>
										<UiListItem v-for="id in plan.affected" :key="id" :title="id" />
									</UiList>
								</UiSection>
								<UiList v-if="plan.steps.length">
									<UiListItem
										v-for="step in plan.steps"
										:key="step.package.name"
										:title="marketplacePackageName(step.package, locale)"
										:description="
											[step.package.version, step.repository?.label, step.package.name]
												.filter(Boolean)
												.join(' · ')
										"
									>
										<template #actions>
											<UiBadge tone="neutral">{{
												t('marketplace.planAction.' + step.action)
											}}</UiBadge>
										</template>
									</UiListItem>
								</UiList>
							</template>
						</template>
						<template v-else-if="stage === 'install'">
							<p v-if="failed" class="install-error" role="status">
								{{ t('notices.' + (operation?.error ?? 'MARKETPLACE_OPERATION_FAILED')) }}
							</p>
							<UiList class="install-progress">
								<li v-for="row in installationRows" :key="row.id">
									<UiProgressRow
										:label="row.name"
										:state="row.state"
										:status-label="t('marketplace.installFlow.progress.' + row.state)"
										:show-progress="false"
										status-display="label"
									/>
								</li>
								<li v-if="operation?.step?.phase === 'activate' && !failed && !succeeded">
									<UiProgressRow
										:label="t('marketplace.installFlow.activating')"
										state="running"
										status-label=""
										:show-progress="false"
									/>
								</li>
							</UiList>
						</template>
						<template v-else>
							<p role="status">
								{{
									t(
										configured
											? 'marketplace.installFlow.ready'
											: 'marketplace.installFlow.checkHint',
									)
								}}
							</p>
							<UiList>
								<UiListItem
									v-for="row in configurationRows"
									:key="row.id"
									:title="row.name"
									:description="row.version"
								>
									<template #actions>
										<UiBadge :tone="marketplaceStatusTones[row.status]" dot>
											{{ t('marketplace.status.' + row.status) }}
										</UiBadge>
										<UiButton
											v-if="row.application"
											@click="emit('configure', row.application.key)"
										>
											{{ t('marketplace.installFlow.openConfiguration') }}
										</UiButton>
									</template>
								</UiListItem>
							</UiList>
						</template>
					</div>
				</UiScrollArea>
			</div>
		</template>
		<template #footer>
			<UiButton
				v-if="stage === 'resolve'"
				class="install-cancel"
				:disabled="awaitingProgress"
				@click="open = false"
			>
				{{ t('marketplace.cancel') }}
			</UiButton>
			<UiButton
				v-if="stage === 'resolve' && canConfirm"
				tone="primary"
				appearance="solid"
				:disabled="busy"
				:loading="awaitingProgress"
				@click="emit('confirm')"
			>
				{{
					t(
						plan?.steps.some(({ action }) => action === 'update')
							? 'marketplace.confirmUpdate'
							: 'marketplace.confirmInstall',
					)
				}}
			</UiButton>
			<UiButton v-else-if="failed || (stage === 'resolve' && !planning && !canConfirm)" @click="emit('retry')">
				{{ t('marketplace.retryInstallation') }}
			</UiButton>
			<UiButton
				v-else-if="stage === 'configure'"
				:tone="configured ? 'primary' : 'neutral'"
				:appearance="configured ? 'solid' : 'soft'"
				@click="emit('finish')"
			>
				{{ t(configured ? 'marketplace.installFlow.done' : 'marketplace.installFlow.later') }}
			</UiButton>
		</template>
	</UiDialog>
</template>

<style scoped>
	.install-cancel {
		--ui-button-border: color-mix(in srgb, var(--ui-text) 28%, var(--ui-border));
		--ui-button-hover-border: color-mix(in srgb, var(--ui-text) 44%, var(--ui-border));
	}

	:global(.marketplace-install-dialog) {
		--ui-dialog-footer-min-content-height: var(--ui-dialog-action-height, 40px);
		block-size: 460px;
	}

	.install-body {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-block-size: 0;
	}

	.install-overview-frame {
		flex: none;
		padding: 0 var(--ui-dialog-padding, 26px) 14px;
	}

	.install-overview {
		overflow: hidden;
		border: 1px solid var(--ui-border);
		border-radius: 12px;
	}

	.install-target {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		padding: 8px 12px;
		border-bottom: 1px solid var(--ui-border);
		background: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-surface));
	}

	.install-target strong {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 14px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.install-target__icon {
		display: grid;
		flex: none;
		width: 32px;
		height: 32px;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
		color: var(--ui-primary);
	}

	.install-target__version {
		flex: none;
		max-inline-size: 48%;
		overflow: hidden;
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
	}

	.install-stages {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 0;
		padding: 12px 0;
		list-style: none;
	}

	.install-stages li {
		--step-size: 28px;
		position: relative;
		display: grid;
		grid-template-rows: var(--step-size) auto;
		justify-items: center;
		align-content: start;
		gap: 5px;
		min-width: 0;
		padding-inline: 4px;
		color: var(--ui-muted);
	}

	.install-stages li:not(:last-child)::after {
		position: absolute;
		inset-block-start: calc((var(--step-size) - 2px) / 2);
		inset-inline-start: 50%;
		inline-size: 100%;
		block-size: 2px;
		background: var(--ui-border);
		content: '';
	}

	.install-stages li[data-state='complete']::after {
		background: var(--ui-primary);
	}

	.install-stages__marker {
		z-index: 1;
		display: grid;
		place-items: center;
		inline-size: var(--step-size);
		block-size: var(--step-size);
		border: 1px solid var(--ui-border);
		border-radius: 50%;
		background: var(--ui-surface);
		font-size: 12px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.install-stages li:is([data-state='current'], [data-state='complete']) {
		color: var(--ui-primary);
	}

	.install-stages li[data-state='current'] .install-stages__marker {
		border-color: transparent;
		background: var(--ui-primary);
		color: var(--ui-primary-text, #fff);
	}

	.install-stages li[data-state='failed'] {
		color: var(--ui-danger);
	}

	.install-stages li:is([data-state='complete'], [data-state='failed']) .install-stages__marker {
		border-color: currentColor;
	}

	.install-stages__label {
		font-size: 12px;
		font-weight: 600;
		line-height: 1.35;
		text-align: center;
		overflow-wrap: anywhere;
	}

	.install-stage-body {
		display: grid;
		flex: 1 1 auto;
		align-content: start;
		gap: 8px;
		min-block-size: 0;
		padding: 0 var(--ui-dialog-padding, 26px) 10px;
	}

	.install-stage-body h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 650;
	}

	.install-stage-body p {
		margin: 0;
		font-size: 13px;
		color: var(--ui-muted);
	}

	.install-stage-body :deep(.ui-list-item) {
		--ui-list-item-padding: 9px 12px;
		min-block-size: 52px;
	}

	.install-progress:not(ul),
	.install-progress > li {
		padding: 9px 12px;
	}

	.install-progress:not(ul) {
		border: 1px solid var(--ui-border);
		border-radius: 14px;
	}

	.install-progress > li + li {
		border-top: 1px solid var(--ui-border);
	}

	.install-progress > li {
		min-block-size: 52px;
	}

	.install-progress :deep(.ui-progress-row__label) {
		font-weight: 600;
	}

	.install-progress :deep(.ui-progress-row__status:not(:empty)) {
		justify-self: end;
		max-inline-size: 100%;
		padding: 4px 8px;
		border-radius: 7px;
		background: color-mix(in srgb, currentColor 10%, transparent);
		font-size: 11px;
		font-weight: 600;
	}

	.install-progress :deep([data-state='pending'] .ui-progress-row__status) {
		color: var(--ui-muted);
	}

	.install-progress :deep([data-state='running'] .ui-progress-row__status) {
		color: var(--ui-primary);
	}

	.install-stage-body .install-error {
		padding: 8px 12px;
		border: 1px solid color-mix(in srgb, var(--ui-danger) 25%, var(--ui-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--ui-danger) 6%, var(--ui-surface));
		color: var(--ui-danger);
	}
</style>
