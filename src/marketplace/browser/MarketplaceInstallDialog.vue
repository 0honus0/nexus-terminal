<script setup lang="ts">
	import { Check } from '@lucide/vue';
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { PluginReadiness, PluginRuntimeInfo } from '../../plugin/plugin-state-types.js';
	import type { UiProgressState } from '../../ui/browser/ui-component-types.js';
	import {
		UiBadge,
		UiButton,
		UiDialog,
		UiList,
		UiListItem,
		UiProgressRow,
		UiSection,
	} from '../../ui/browser/ui-components-api.js';
	import type { MarketplaceInstallPlan } from '../marketplace-install-types.js';
	import type { MarketplaceOperation, MarketplacePlugin } from '../marketplace-types.js';
	import {
		marketplaceInstalledStatus,
		marketplacePackageName,
		marketplacePluginRuntime,
		marketplaceStatusTones,
	} from './marketplace-presentation.js';

	const props = defineProps<{
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
	const stages = ['resolve', 'install', 'configure'] as const;
	const stage = computed(() =>
		props.operation?.state === 'succeeded'
			? 'configure'
			: props.operation || props.submitting
				? 'install'
				: 'resolve',
	);
	const failed = computed(() => props.operation?.state === 'failed');
	const canConfirm = computed(() => !!props.plan?.steps.length && !props.plan.blockers.length);
	const checking = computed(() => !props.installed || props.loadingInstalled);

	const installationRows = computed(() =>
		(props.plan?.steps ?? []).map<{ id: string; name: string; state: UiProgressState }>(({ package: pack }) => {
			const { operation } = props;
			const completed = operation?.completedPackages?.includes(pack.name);
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
			return { id: pack.name, name: marketplacePackageName(pack, locale.value), status, application };
		}),
	);
	const configured = computed(() =>
		configurationRows.value.every(({ status }) => status === 'available' || status === 'disabled'),
	);
</script>

<template>
	<UiDialog v-model:open="open" :title="t('marketplace.installFlow.title')" :close-label="t('closeApplication')">
		<ol class="install-stages" :aria-label="t('marketplace.installFlow.title')">
			<li
				v-for="(step, index) in stages"
				:key="step"
				:aria-current="step === stage ? 'step' : undefined"
				:data-complete="index < stages.indexOf(stage) || (step === 'configure' && stage === step && configured)"
			>
				<span class="install-stages__marker" aria-hidden="true">
					<Check
						v-if="index < stages.indexOf(stage) || (step === 'configure' && stage === step && configured)"
						:size="14"
					/>
					<template v-else>{{ index + 1 }}</template>
				</span>
				{{ t('marketplace.installFlow.' + step) }}
			</li>
		</ol>
		<div class="install-stage-body" :aria-busy="planning || submitting">
			<template v-if="stage === 'resolve'">
				<UiProgressRow
					v-if="planning"
					:label="t('marketplace.installFlow.resolve')"
					state="running"
					status-label=""
					:show-progress="false"
				/>
				<p v-else-if="!plan" role="status">{{ t('notices.MARKETPLACE_INSTALL_PLAN_FAILED') }}</p>
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
								[step.package.name, step.package.version, step.repository?.label]
									.filter(Boolean)
									.join(' · ')
							"
						>
							<template #actions>
								<UiBadge tone="neutral">{{ t('marketplace.planAction.' + step.action) }}</UiBadge>
							</template>
						</UiListItem>
					</UiList>
				</template>
			</template>
			<template v-else-if="stage === 'install'">
				<p v-if="failed" role="status">
					{{ t('notices.' + (operation?.error ?? 'MARKETPLACE_OPERATION_FAILED')) }}
				</p>
				<UiProgressRow
					v-for="row in installationRows"
					:key="row.id"
					:label="row.name"
					:state="row.state"
					:status-label="t('marketplace.installFlow.progress.' + row.state)"
					:show-progress="false"
					status-display="label"
				/>
				<UiProgressRow
					v-if="operation?.step?.phase === 'activate' && !failed"
					:label="t('marketplace.installFlow.activating')"
					state="running"
					status-label=""
					:show-progress="false"
				/>
			</template>
			<template v-else>
				<p role="status">
					{{ t(configured ? 'marketplace.installFlow.ready' : 'marketplace.installFlow.checkHint') }}
				</p>
				<UiList>
					<UiListItem v-for="row in configurationRows" :key="row.id" :title="row.name" :description="row.id">
						<template #actions>
							<UiBadge :tone="marketplaceStatusTones[row.status]" dot>
								{{ t('marketplace.status.' + row.status) }}
							</UiBadge>
							<UiButton v-if="row.application" @click="emit('configure', row.application.key)">
								{{ t('marketplace.installFlow.openConfiguration') }}
							</UiButton>
						</template>
					</UiListItem>
				</UiList>
			</template>
		</div>
		<template #footer>
			<UiButton v-if="stage === 'resolve' && canConfirm" tone="primary" :disabled="busy" @click="emit('confirm')">
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
				@click="configured ? emit('finish') : (open = false)"
			>
				{{ t(configured ? 'marketplace.installFlow.done' : 'marketplace.installFlow.later') }}
			</UiButton>
		</template>
	</UiDialog>
</template>

<style scoped>
	.install-stages {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		margin: 0 0 16px;
		padding: 0;
		list-style: none;
	}

	.install-stages li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 0;
		border-bottom: 2px solid var(--ui-border);
		color: var(--ui-muted);
		font-size: 12px;
	}

	.install-stages li[aria-current] {
		border-color: var(--ui-primary);
		color: var(--ui-text);
	}

	.install-stages li[data-complete='true'] {
		border-color: var(--ui-success);
		color: var(--ui-success);
	}

	.install-stages__marker {
		display: grid;
		place-items: center;
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	.install-stage-body {
		display: grid;
		align-content: start;
		gap: 12px;
		min-height: 112px;
	}

	.install-stage-body p {
		margin: 0;
		font-size: 13px;
		color: var(--ui-muted);
	}
</style>
