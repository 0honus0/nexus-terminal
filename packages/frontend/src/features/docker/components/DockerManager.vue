<script setup lang="ts">
	import type { DockerSessionController } from '../model/docker-types';
	import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiContextMenu,
		UiContextMenuItem,
		UiEmptyState,
		UiLoadingState,
		type UiTone,
	} from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { useDocker } from '../composables/useDocker';
	import { DockerFailure, type DockerAction, type DockerContainer } from '../model/docker-types';

	type DockerConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

	const props = withDefaults(
		defineProps<{
			session: DockerSessionController;
			intervalSeconds?: number;
			defaultExpand?: boolean;
			connectionState?: DockerConnectionState;
			connectionMessage?: string;
		}>(),
		{ intervalSeconds: 5, defaultExpand: false, connectionState: 'connected', connectionMessage: '' },
	);
	const emit = defineEmits<{ terminalCommand: [command: string] }>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const docker = useDocker(
		props.session,
		() => props.intervalSeconds,
		() => props.defaultExpand,
	);
	const connecting = computed(() => ['idle', 'connecting', 'reconnecting'].includes(props.connectionState));

	let active = false;
	let confirmation = new AbortController();

	const activate = (): void => {
		if (active) {
			return;
		}
		active = true;
		confirmation = new AbortController();
	};

	const deactivate = (): void => {
		active = false;
		actionContext.value = null;
		confirmation.abort();
	};

	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onBeforeUnmount(deactivate);
	watch(
		() => props.connectionState,
		() => {
			actionContext.value = null;
			confirmation.abort();
			confirmation = new AbortController();
		},
	);
	const actionsDisabled = computed(() => docker.commandPending.value || docker.commandBlocked.value);

	const run = async (container: DockerContainer, action: DockerAction): Promise<void> => {
		const owner = confirmation;
		if (!active || props.connectionState !== 'connected' || actionsDisabled.value) {
			return;
		}
		if (
			action === 'remove' &&
			!(await feedback.confirm({
				message: t('dockerManager.action.removeConfirm', { name: container.names[0] ?? container.id }),
				destructive: true,
				signal: owner.signal,
			}))
		) {
			return;
		}
		if (
			!active ||
			owner !== confirmation ||
			owner.signal.aborted ||
			actionsDisabled.value ||
			props.connectionState !== 'connected'
		) {
			return;
		}
		try {
			await docker.command(container.id, action);
		} catch (cause) {
			if (active && owner === confirmation && !owner.signal.aborted) {
				const code = cause instanceof DockerFailure ? cause.code : 'remote_unavailable';
				feedback.notifyError(t('dockerManager.failures.' + code));
			}
		}
	};

	const ports = (container: DockerContainer) =>
		container.ports
			.map((port) => {
				const publicSide = port.publicPort
					? `${port.ip ? `${port.ip}:` : ''}${port.publicPort}->`
					: port.ip
						? `${port.ip}:`
						: '';
				return `${publicSide}${port.privatePort}/${port.type}`;
			})
			.join(', ');

	const terminalCommand = (container: DockerContainer, kind: 'enter' | 'logs') => {
		if (!active || props.connectionState !== 'connected' || actionsDisabled.value) {
			return;
		}
		emit(
			'terminalCommand',
			kind === 'enter' ? `docker exec -it ${container.id} sh` : `docker logs --tail 1000 -f ${container.id}`,
		);
	};

	const stateTone = (state: string): UiTone => {
		if (state === 'running') return 'success';
		if (state === 'exited' || state === 'dead') return 'danger';
		if (state === 'paused') return 'warning';
		if (state === 'restarting') return 'primary';
		return 'neutral';
	};

	const actionContext = ref<{ container: DockerContainer; x: number; y: number } | null>(null);

	const openActionContext = (event: MouseEvent, container: DockerContainer) => {
		const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
		actionContext.value = {
			container,
			x: rect?.right ?? event.clientX,
			y: (rect?.bottom ?? event.clientY) + 4,
		};
	};

	const runFromActionContext = (action: 'remove' | 'enter' | 'logs') => {
		const container = actionContext.value?.container;
		actionContext.value = null;
		if (!container) return;
		if (action === 'remove') void run(container, 'remove');
		else terminalCommand(container, action);
	};
</script>

<template>
	<section class="docker-manager flex h-full min-h-0 flex-col overflow-hidden text-foreground">
		<UiLoadingState
			v-if="connecting"
			class="docker-empty"
			:bordered="false"
			:title="t('dockerManager.waitingForSsh')"
			:description="connectionMessage || undefined"
		/>
		<UiEmptyState
			v-else-if="connectionState === 'disconnected'"
			class="docker-empty"
			icon="fas fa-link-slash"
			:title="t('dockerManager.error.sshDisconnected')"
			:description="connectionMessage || undefined"
			:bordered="false"
		/>
		<UiEmptyState
			v-else-if="connectionState === 'error'"
			class="docker-empty"
			icon="fas fa-triangle-exclamation"
			:title="t('dockerManager.error.sshError')"
			:description="connectionMessage || undefined"
			:bordered="false"
		/>
		<UiLoadingState
			v-else-if="docker.loading.value && !docker.containers.value.length"
			class="docker-empty"
			:bordered="false"
			:title="t('dockerManager.loading')"
		/>
		<UiEmptyState
			v-else-if="docker.error.value"
			class="docker-empty"
			icon="fas fa-triangle-exclamation"
			:title="t('dockerManager.error.fetchFailed')"
			:description="t('dockerManager.failures.' + docker.error.value)"
			:bordered="false"
		>
			<template #action>
				<UiButton
					type="button"
					appearance="soft"
					density="compact"
					:disabled="docker.loading.value || docker.commandPending.value"
					@click="docker.reconcile()"
				>
					<i class="fas fa-rotate" aria-hidden="true"></i>
					{{ t('dockerManager.reconcile') }}
				</UiButton>
			</template>
		</UiEmptyState>
		<UiEmptyState
			v-else-if="!docker.available.value"
			class="docker-empty"
			icon="fab fa-docker"
			:title="t('dockerManager.notAvailable')"
			:description="t('dockerManager.installHintRemote')"
			:bordered="false"
		/>
		<UiEmptyState
			v-else-if="!docker.containers.value.length"
			class="docker-empty"
			icon="fas fa-cube"
			:title="t('dockerManager.noContainers')"
			:bordered="false"
		/>

		<div v-else class="docker-content-area min-h-0 flex-1 overflow-y-auto">
			<ul class="docker-list">
				<li
					v-for="container in docker.containers.value"
					:key="container.id"
					:data-docker-id="container.id"
					class="docker-container"
					:class="{ 'docker-container--expanded': docker.expandedContainerIds.value.has(container.id) }"
				>
					<div class="docker-summary">
						<button
							type="button"
							class="docker-toggle docker-touch-target"
							:aria-expanded="docker.expandedContainerIds.value.has(container.id)"
							:aria-controls="`docker-details-${container.id}`"
							:aria-label="
								docker.expandedContainerIds.value.has(container.id)
									? t('common.collapse')
									: t('common.expand')
							"
							:title="
								docker.expandedContainerIds.value.has(container.id)
									? t('common.collapse')
									: t('common.expand')
							"
							@click="docker.toggleExpand(container.id)"
						>
							<i
								:class="[
									'fas',
									docker.expandedContainerIds.value.has(container.id)
										? 'fa-chevron-down'
										: 'fa-chevron-right',
								]"
								aria-hidden="true"
							></i>
						</button>

						<div class="docker-identity">
							<span class="docker-name" :title="container.names.join(', ') || container.id">
								{{ container.names.join(', ') || container.id.slice(0, 12) }}
							</span>
							<span class="docker-image" :title="container.image">{{ container.image }}</span>
						</div>

						<UiBadge class="docker-status" :tone="stateTone(container.state)" density="compact">
							{{ container.status }}
						</UiBadge>

						<div v-if="ports(container)" class="docker-ports">
							<span class="docker-ports__label">{{ t('dockerManager.header.ports') }}</span>
							<code>{{ ports(container) }}</code>
						</div>

						<div class="docker-actions">
							<UiButton
								type="button"
								appearance="ghost"
								tone="success"
								density="compact"
								icon-only
								class="docker-action docker-touch-target"
								:disabled="actionsDisabled || container.state === 'running'"
								:title="t('dockerManager.action.start')"
								:aria-label="t('dockerManager.action.start')"
								@click="run(container, 'start')"
							>
								<i class="fas fa-play" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								tone="warning"
								density="compact"
								icon-only
								class="docker-action docker-touch-target"
								:disabled="actionsDisabled || container.state !== 'running'"
								:title="t('dockerManager.action.stop')"
								:aria-label="t('dockerManager.action.stop')"
								@click="run(container, 'stop')"
							>
								<i class="fas fa-stop" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								tone="primary"
								density="compact"
								icon-only
								class="docker-action docker-touch-target"
								:disabled="actionsDisabled || container.state !== 'running'"
								:title="t('dockerManager.action.restart')"
								:aria-label="t('dockerManager.action.restart')"
								@click="run(container, 'restart')"
							>
								<i class="fas fa-rotate-right" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								tone="danger"
								density="compact"
								icon-only
								class="docker-action docker-action--secondary docker-touch-target"
								:disabled="actionsDisabled"
								:title="t('dockerManager.action.remove')"
								:aria-label="t('dockerManager.action.remove')"
								@click="run(container, 'remove')"
							>
								<i class="fas fa-trash-alt" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								tone="primary"
								density="compact"
								icon-only
								class="docker-action docker-action--secondary docker-touch-target"
								:disabled="actionsDisabled"
								:title="t('dockerManager.action.enter')"
								:aria-label="t('dockerManager.action.enter')"
								@click="terminalCommand(container, 'enter')"
							>
								<i class="fas fa-terminal" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								density="compact"
								icon-only
								class="docker-action docker-action--secondary docker-touch-target"
								:disabled="actionsDisabled"
								:title="t('dockerManager.action.logs')"
								:aria-label="t('dockerManager.action.logs')"
								@click="terminalCommand(container, 'logs')"
							>
								<i class="fas fa-file-lines" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								density="compact"
								icon-only
								class="docker-action docker-action-more docker-touch-target"
								:disabled="actionsDisabled"
								:title="t('dockerManager.moreActions')"
								:aria-label="t('dockerManager.moreActions')"
								@click="openActionContext($event, container)"
							>
								<i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>
							</UiButton>
						</div>
					</div>

					<div
						v-if="docker.expandedContainerIds.value.has(container.id)"
						:id="`docker-details-${container.id}`"
						class="docker-details"
					>
						<dl v-if="container.stats" class="docker-stats-grid">
							<div class="docker-stat">
								<dt>{{ t('dockerManager.stats.cpu') }}</dt>
								<dd>{{ container.stats.cpuPercent }}</dd>
							</div>
							<div class="docker-stat">
								<dt>{{ t('dockerManager.stats.memory') }}</dt>
								<dd>{{ container.stats.memoryUsage }} ({{ container.stats.memoryPercent }})</dd>
							</div>
							<div class="docker-stat">
								<dt>{{ t('dockerManager.stats.netIO') }}</dt>
								<dd>{{ container.stats.networkIo }}</dd>
							</div>
							<div class="docker-stat">
								<dt>{{ t('dockerManager.stats.blockIO') }}</dt>
								<dd>{{ container.stats.blockIo }}</dd>
							</div>
							<div class="docker-stat">
								<dt>{{ t('dockerManager.stats.pids') }}</dt>
								<dd>{{ container.stats.pids }}</dd>
							</div>
						</dl>
						<p v-else class="docker-stat-empty">{{ t('dockerManager.stats.noData') }}</p>
					</div>
				</li>
			</ul>
		</div>

		<UiContextMenu
			v-if="actionContext"
			:visible="true"
			:x="actionContext.x"
			:y="actionContext.y"
			:width="190"
			@close="actionContext = null"
		>
			<UiContextMenuItem tone="danger" @click="runFromActionContext('remove')">
				<i class="fas fa-trash-alt" aria-hidden="true"></i>
				<span>{{ t('dockerManager.action.remove') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem @click="runFromActionContext('enter')">
				<i class="fas fa-terminal" aria-hidden="true"></i>
				<span>{{ t('dockerManager.action.enter') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem @click="runFromActionContext('logs')">
				<i class="fas fa-file-lines" aria-hidden="true"></i>
				<span>{{ t('dockerManager.action.logs') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>
	</section>
</template>

<style scoped>
	.docker-manager {
		container-name: docker-manager-pane;
		container-type: size;
		background: color-mix(in srgb, var(--app-bg-color) 94%, transparent);
	}

	.docker-empty {
		width: 100%;
		margin: auto;
		justify-content: center;
		padding: 0.75rem;
		background: transparent;
	}

	.docker-empty :deep(.ui-empty-state__icon) {
		width: 32px;
		height: 32px;
		border: 0;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 13px;
	}

	.docker-empty :deep(.ui-empty-state__title) {
		font-size: 0.75rem;
		font-weight: 600;
	}

	.docker-empty :deep(.ui-empty-state__description) {
		max-width: 20rem;
		color: var(--text-color-secondary);
		font-size: 0.65rem;
	}

	.docker-empty :deep(.ui-empty-state__action) {
		margin-top: 0.15rem;
	}

	.docker-content-area {
		min-height: 0;
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 0.45rem 0.5rem 0.7rem 0.6rem;
		scrollbar-gutter: stable;
	}

	.docker-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.docker-container {
		min-width: 0;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--border-color) 36%, transparent);
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--card-bg-color) 24%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
		transition:
			border-color 0.16s ease,
			background-color 0.16s ease;
	}

	.docker-container:hover,
	.docker-container--expanded {
		border-color: color-mix(in srgb, var(--link-active-color) 28%, var(--border-color));
		background: color-mix(in srgb, var(--card-bg-color) 34%, transparent);
	}

	.docker-summary {
		display: grid;
		grid-template-areas:
			'toggle identity status'
			'ports ports ports'
			'actions actions actions';
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.3rem 0.45rem;
		padding: 0.42rem 0.45rem 0.35rem 0.28rem;
	}

	.docker-toggle {
		display: grid;
		grid-area: toggle;
		width: 1.35rem;
		height: 1.6rem;
		place-items: center;
		align-self: start;
		padding: 0;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--text-color-secondary);
		font-size: 0.62rem;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}

	.docker-toggle:hover,
	.docker-toggle:focus-visible {
		background: color-mix(in srgb, var(--text-color) 7%, transparent);
		color: var(--text-color);
		outline: none;
	}

	.docker-identity {
		display: flex;
		grid-area: identity;
		min-width: 0;
		flex-direction: column;
		gap: 0.05rem;
	}

	.docker-name,
	.docker-image {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.docker-name {
		color: var(--text-color);
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.35;
	}

	.docker-image {
		color: var(--text-color-secondary);
		font-family: var(--font-family-monospace);
		font-size: 0.6rem;
		line-height: 1.3;
		opacity: 0.78;
	}

	.docker-status {
		grid-area: status;
		max-width: 7.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.docker-ports {
		display: flex;
		grid-area: ports;
		min-width: 0;
		align-items: baseline;
		gap: 0.3rem;
		color: var(--text-color-secondary);
		font-size: 0.6rem;
	}

	.docker-ports__label {
		flex: none;
		font-weight: 600;
		opacity: 0.72;
	}

	.docker-ports code {
		min-width: 0;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-family: var(--font-family-monospace);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.docker-actions {
		display: grid;
		grid-area: actions;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.12rem 0.2rem;
		padding-top: 0.25rem;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 24%, transparent);
	}

	.docker-action {
		width: 100%;
		max-width: 2.25rem;
		height: 1.72rem;
		justify-self: center;
		--ui-control-padding-inline: 0;
		font-size: 0.68rem;
	}

	.docker-action--secondary {
		display: none;
	}

	.docker-action[data-ui='button']:disabled {
		background: transparent;
		box-shadow: none;
		opacity: 0.32;
	}

	.docker-action-more {
		display: flex;
	}

	.docker-details {
		padding: 0.35rem 0.45rem 0.48rem;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 24%, transparent);
		background: color-mix(in srgb, var(--app-bg-color) 24%, transparent);
	}

	.docker-stats-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--border-color) 28%, transparent);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--border-color) 28%, transparent);
	}

	.docker-stat {
		min-width: 0;
		padding: 0.34rem 0.42rem 0.38rem;
		border-radius: 0;
		background: color-mix(in srgb, var(--app-bg-color) 82%, var(--text-color) 2.5%);
	}

	.docker-stat:last-child {
		display: flex;
		grid-column: 1 / -1;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.docker-stat:last-child dd {
		margin-top: 0;
		text-align: right;
	}

	.docker-stat dt {
		margin: 0;
		color: var(--text-color-secondary);
		font-size: 0.56rem;
		font-weight: 600;
		line-height: 1.25;
		opacity: 0.78;
	}

	.docker-stat dd {
		min-width: 0;
		margin: 0.09rem 0 0;
		overflow-wrap: anywhere;
		color: var(--text-color);
		font-family: var(--font-family-monospace);
		font-size: 0.63rem;
		font-variant-numeric: tabular-nums;
		line-height: 1.35;
	}

	.docker-stat-empty {
		margin: 0;
		padding: 0.55rem;
		color: var(--text-color-secondary);
		font-size: 0.65rem;
		text-align: center;
	}

	@container docker-manager-pane (min-width: 480px) {
		.docker-summary {
			grid-template-areas: 'toggle identity status ports actions';
			grid-template-columns: auto minmax(0, 1.35fr) auto minmax(4.5rem, 0.8fr) auto;
			gap: 0.4rem 0.7rem;
			padding: 0.45rem 0.55rem 0.45rem 0.3rem;
		}

		.docker-toggle {
			align-self: center;
		}

		.docker-actions {
			display: flex;
			align-items: center;
			gap: 0.08rem;
			padding-top: 0;
			border-top: 0;
		}

		.docker-action--secondary {
			display: flex;
		}

		.docker-action-more {
			display: none;
		}

		.docker-action {
			width: 1.75rem;
			height: 1.6rem;
			flex: 0 0 1.75rem;
		}

		.docker-stat {
			padding: 0.42rem 0.52rem 0.46rem;
		}
	}

	@container docker-manager-pane (max-width: 200px) {
		.docker-summary {
			grid-template-areas:
				'toggle identity'
				'toggle status'
				'ports ports'
				'actions actions';
			grid-template-columns: auto minmax(0, 1fr);
		}

		.docker-status {
			justify-self: start;
			max-width: 100%;
		}

		.docker-empty {
			padding: 0.4rem;
		}

		.docker-empty :deep(.ui-empty-state__icon) {
			width: 26px;
			height: 26px;
			font-size: 11px;
		}

		.docker-empty :deep(.ui-empty-state__description) {
			display: none;
		}

		.docker-ports__label {
			display: none;
		}
	}

	@container docker-manager-pane (max-height: 220px) {
		.docker-content-area {
			padding-top: 0.25rem;
		}

		.docker-empty {
			padding-block: 0.35rem;
		}

		.docker-empty :deep(.ui-empty-state__description) {
			display: none;
		}
	}

	@media (pointer: coarse) {
		.docker-touch-target {
			min-width: 38px;
			min-height: 38px;
		}
	}
</style>
