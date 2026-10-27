<script setup lang="ts">
	import type {
		ServerTransferItemStatus,
		ServerTransferTaskStatus,
	} from '@nexus-terminal/shared/remote/transfers/server-values';
	import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
	import { useDraggablePosition } from '@/foundation/interaction';
	import { UiButton, UiEmptyState, UiLoadingState, UiInlineNotice, UiOverlayPanel, UiSpinner } from '@/foundation/ui';
	import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
	import type { ProgressSource, TransferTask } from '../model/transfer-types';
	import { transferTaskErrorDescriptor, transferTaskWarningDescriptor } from '../presentation-transfer-message';
	import type { ServerTransferTask } from '../model/server-transfer-types';

	const props = withDefaults(
		defineProps<{
			visible: boolean;
			sources: readonly ProgressSource[];
			serverTransfers?: readonly ServerTransferTask[];
			serverTransfersLoading?: boolean;
			serverTransfersError?: string;
			mobile?: boolean;
		}>(),
		{
			serverTransfers: () => [],

			serverTransfersLoading: false,
			serverTransfersError: '',
			mobile: false,
		},
	);
	const emit = defineEmits<{
		close: [];
		restore: [sourceId: string];
		cancel: [sourceId: string, taskId: string];
		cancelAll: [sourceId: string];
		remove: [sourceId: string, taskId: string];
	}>();
	const { t, locale } = useI18n();
	const connections = useRuntimeFeatureCapabilities().connections;
	interface ProgressDisplayPosition {
		x: number;
		y: number;
	}
	const progressDisplayPositionStorage = {
		namespace: 'transfers.progress-display-position',
		version: 1,
		codec: jsonStorageCodec<ProgressDisplayPosition>((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
			const candidate = value as Record<string, unknown>;
			return typeof candidate.x === 'number' &&
				Number.isFinite(candidate.x) &&
				typeof candidate.y === 'number' &&
				Number.isFinite(candidate.y)
				? { x: candidate.x, y: candidate.y }
				: undefined;
		}),
		legacyKeys: ['nexus.progress-display-position'],
	} as const;
	const VIEWPORT_MARGIN = 8;
	const panelContent = ref<HTMLElement | null>(null);
	const position = ref({ x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN });
	const positionInitialized = ref(false);

	const panelElement = (): HTMLElement | null => panelContent.value?.parentElement ?? null;

	const clampPosition = (candidate: { x: number; y: number }, element: HTMLElement) => ({
		x: Math.max(VIEWPORT_MARGIN, Math.min(candidate.x, window.innerWidth - element.offsetWidth - VIEWPORT_MARGIN)),
		y: Math.max(
			VIEWPORT_MARGIN,
			Math.min(candidate.y, window.innerHeight - element.offsetHeight - VIEWPORT_MARGIN),
		),
	});

	const savePosition = (): void => {
		if (props.mobile || !positionInitialized.value) return;
		writeStoredValue(progressDisplayPositionStorage, position.value);
	};

	const restorePosition = async (): Promise<void> => {
		if (props.mobile) return;
		await nextTick();
		const element = panelElement();
		if (!element) return;

		let next = { x: element.getBoundingClientRect().left, y: element.getBoundingClientRect().top };
		const saved = readStoredValue(progressDisplayPositionStorage);
		if (saved) next = saved;
		position.value = clampPosition(next, element);
		positionInitialized.value = true;
	};

	const clampRestoredPosition = (): void => {
		if (props.mobile || !positionInitialized.value) return;
		const element = panelElement();
		if (!element) return;
		position.value = clampPosition(position.value, element);
		savePosition();
	};

	const drag = useDraggablePosition({
		position,
		getElement: panelElement,

		canStart: (event) =>
			!props.mobile &&
			event.button === 0 &&
			!(event.target as HTMLElement).closest('button, a, input, select, textarea'),

		constrain: (candidate, element) => clampPosition(candidate, element),

		onEnd: savePosition,
	});
	const panelStyle = computed(() => {
		if (props.mobile) return undefined;
		const base = {
			width: 'min(46rem, calc(100vw - 1rem))',
			margin: '0',
		};
		if (!positionInitialized.value) return base;
		return {
			...base,
			position: 'fixed' as const,
			left: `${position.value.x}px`,
			top: `${position.value.y}px`,
		};
	});

	onMounted(() => {
		void restorePosition();
		window.addEventListener('resize', clampRestoredPosition);
	});
	onBeforeUnmount(() => window.removeEventListener('resize', clampRestoredPosition));

	const done = (status: TransferTask['status']) =>
		['completed', 'cancelled', 'skipped', 'partial', 'unknown', 'error'].includes(status);

	const activeCount = (source: ProgressSource) => source.tasks.filter((task) => !done(task.status)).length;

	const normalizedProgress = (task: TransferTask) => Math.max(0, Math.min(100, task.progress));

	const localizedTransferMessage = (descriptor: ReturnType<typeof transferTaskErrorDescriptor>): string =>
		descriptor ? t(descriptor.key, descriptor.params ?? {}) : '';

	const taskError = (task: TransferTask): string => localizedTransferMessage(transferTaskErrorDescriptor(task));

	const taskWarning = (task: TransferTask): string => localizedTransferMessage(transferTaskWarningDescriptor(task));

	const sourceTitle = (source: ProgressSource): string => {
		const kinds = new Set(source.tasks.map((task) => task.kind));
		let taskLabel = '';
		if (kinds.size === 1 && kinds.has('upload')) taskLabel = t('fileManager.uploadTasks');
		else if (kinds.size > 0 && [...kinds].every((kind) => ['copy', 'move', 'transfer'].includes(kind)))
			taskLabel = t('fileManager.transferTasks');
		else if (kinds.size === 1) taskLabel = t(`progressCenter.kind.${source.tasks[0]!.kind}`);
		return taskLabel ? `${source.label} · ${taskLabel}` : source.label;
	};

	const displayedServerTransfers = computed(() =>
		[...props.serverTransfers].sort((left, right) => right.createdAt - left.createdAt),
	);

	const serverTaskFinal = (status: ServerTransferTaskStatus): boolean =>
		['completed', 'failed', 'partially-completed', 'cancelled'].includes(status);

	const serverTaskCancellable = (status: ServerTransferTaskStatus): boolean =>
		['queued', 'in-progress'].includes(status);

	const connectionName = (connectionId?: number): string => {
		if (!connectionId) return t('transferProgressModal.unknownSourceServer');
		const connection = connections.items.value.find((item) => item.id === connectionId);
		return (
			connection?.name?.trim() ||
			connection?.host ||
			t('transferProgressModal.connectionIdFallback', { connectionId })
		);
	};

	const serverTaskTitle = (task: ServerTransferTask): string => {
		const sourceConnectionId = task.payload.sourceConnectionId;
		const fileName =
			task.payload.sourceItems[0]?.name ||
			task.subTasks[0]?.sourceItemName ||
			t('transferProgressModal.unknownFileName');
		const targetPath = task.payload.remoteTargetPath || t('transferProgressModal.unknownTargetPath');
		return `${connectionName(sourceConnectionId)} (${fileName} -> ${targetPath})`;
	};

	const statusLabel = (status: ServerTransferTaskStatus | ServerTransferItemStatus): string => {
		const keys: Record<ServerTransferTaskStatus | ServerTransferItemStatus, string> = {
			queued: 'transferProgressModal.status.queued',
			'in-progress': 'transferProgressModal.status.inProgress',
			completed: 'transferProgressModal.status.completed',
			failed: 'transferProgressModal.status.failed',
			'partially-completed': 'transferProgressModal.status.partiallyCompleted',
			connecting: 'transferProgressModal.status.connecting',
			transferring: 'transferProgressModal.status.transferring',
			cancelling: 'transferProgressModal.status.cancelling',
			cancelled: 'transferProgressModal.status.cancelled',
			unknown: 'progressCenter.status.unknown',
		};
		return t(keys[status]);
	};

	const statusClasses = (status: ServerTransferTaskStatus | ServerTransferItemStatus) => ({
		'server-status--success': status === 'completed',
		'server-status--danger': status === 'failed',
		'server-status--warning': status === 'partially-completed' || status === 'queued' || status === 'cancelling',
		'server-status--active': status === 'in-progress' || status === 'connecting' || status === 'transferring',
		'server-status--muted': status === 'cancelled',
	});

	const formatDate = (value: number): string => {
		const date = new Date(value);
		if (!Number.isFinite(date.getTime())) return '';
		return date.toLocaleString(locale.value, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	};
</script>

<template>
	<UiOverlayPanel
		:visible="visible"
		:overlay="true"
		:teleport="true"
		:z-index="1100"
		:close-on-escape="true"
		preset="standard-modal"
		panel-class="!w-[min(46rem,calc(100vw-2rem))] !max-w-none !max-h-[min(80dvh,46rem)] !p-0"
		:panel-style="panelStyle"
		role="dialog"
		:aria-modal="true"
		:aria-label="t('progressCenter.title')"
		@close="emit('close')"
	>
		<section
			v-if="visible"
			ref="panelContent"
			data-progress-display-placement="overlay"
			class="progress-display-overlay flex min-h-0 flex-col overflow-hidden text-foreground"
		>
			<div class="transfer-progress-panel mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden">
				<div
					class="transfer-progress-header ui-glass-chrome grid flex-shrink-0 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 px-4 py-3 sm:px-5"
					:class="!mobile ? (drag.dragging.value ? 'cursor-grabbing select-none' : 'cursor-move') : ''"
					@pointerdown="drag.startDragging"
				>
					<span class="h-7 w-7" aria-hidden="true"></span>
					<h3 class="m-0 min-w-0 truncate text-center text-lg font-semibold">
						{{ t('progressCenter.title') }}
					</h3>
					<UiButton
						appearance="ghost"
						density="compact"
						icon-only
						class="justify-self-end"
						:title="t('progressCenter.hide')"
						:aria-label="t('progressCenter.hide')"
						@click.stop="emit('close')"
					>
						<i class="fas fa-minus" aria-hidden="true"></i>
					</UiButton>
				</div>

				<div
					class="progress-display-content custom-scrollbar min-h-0 flex-grow space-y-5 overflow-y-auto px-4 py-4 sm:px-5"
				>
					<section class="space-y-3">
						<div class="flex items-center justify-between gap-3">
							<div>
								<h4 class="m-0 text-sm font-semibold">{{ t('progressCenter.hiddenTitle') }}</h4>
								<p v-if="sources.length" class="mb-0 mt-0.5 text-[11px] text-text-muted">
									{{ t('progressCenter.hiddenSourceHint') }}
								</p>
							</div>
							<span
								class="shrink-0 rounded-full bg-border/60 px-2 py-0.5 text-xs tabular-nums text-text-secondary"
							>
								{{ sources.length }}
							</span>
						</div>

						<UiEmptyState
							v-if="!sources.length"
							dense
							icon="fas fa-list-check"
							:title="t('progressCenter.empty')"
						/>

						<div v-else class="hidden-progress-source-grid">
							<article v-for="source in sources" :key="source.id" class="hidden-progress-source-card">
								<div class="hidden-progress-source-header">
									<div class="min-w-0 flex-1">
										<div class="flex min-w-0 items-center gap-2">
											<strong
												class="min-w-0 flex-1 truncate text-sm"
												:title="sourceTitle(source)"
												>{{ sourceTitle(source) }}</strong
											>
											<span
												class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary"
											>
												{{ source.tasks.length }}
											</span>
										</div>
									</div>
									<div class="flex shrink-0 items-center gap-1.5">
										<UiButton
											v-if="source.restorable !== false"
											appearance="soft"
											density="compact"
											class="text-[11px]"
											@click="emit('restore', source.id)"
										>
											<i class="fas fa-window-restore" aria-hidden="true"></i>
											{{ t('progressCenter.restore') }}
										</UiButton>
										<UiButton
											v-if="activeCount(source) > 0"
											appearance="soft"
											tone="danger"
											density="compact"
											class="text-[11px]"
											@click="emit('cancelAll', source.id)"
										>
											{{ t('progressCenter.cancelAll') }} ({{ activeCount(source) }})
										</UiButton>
									</div>
								</div>

								<div class="hidden-progress-source-list custom-scrollbar">
									<div v-for="task in source.tasks" :key="task.id" class="hidden-progress-task-row">
										<div class="flex min-w-0 items-center gap-2">
											<span
												class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] font-medium"
											>
												{{ t(`progressCenter.kind.${task.kind}`) }}
											</span>
											<span
												class="min-w-0 flex-1 truncate text-xs font-medium"
												:title="task.label"
												>{{ task.label }}</span
											>
											<span class="shrink-0 text-[11px] text-text-secondary">{{
												t(`progressCenter.status.${task.status}`)
											}}</span>
											<UiButton
												v-if="!done(task.status)"
												appearance="soft"
												tone="danger"
												density="compact"
												class="shrink-0 text-[11px]"
												:disabled="task.status === 'cancelling'"
												@click="emit('cancel', source.id, task.id)"
											>
												{{
													task.status === 'cancelling'
														? t('progressCenter.cancelling')
														: t('common.cancel')
												}}
											</UiButton>
											<UiButton
												v-else
												appearance="ghost"
												density="compact"
												icon-only
												class="shrink-0"
												:aria-label="t('common.remove')"
												@click="emit('remove', source.id, task.id)"
											>
												<i class="fas fa-times" aria-hidden="true"></i>
											</UiButton>
										</div>

										<div class="mt-1.5 flex items-center gap-2">
											<div
												class="server-progress-track h-1.5 min-w-0 flex-1"
												role="progressbar"
												aria-valuemin="0"
												aria-valuemax="100"
												:aria-valuenow="Math.round(normalizedProgress(task))"
											>
												<span
													class="server-progress-value"
													:style="{ transform: `scaleX(${normalizedProgress(task) / 100})` }"
												></span>
											</div>
											<span
												class="w-11 shrink-0 text-right text-[11px] tabular-nums text-text-secondary"
											>
												{{ normalizedProgress(task).toFixed(1) }}%
											</span>
										</div>
										<p
											v-if="task.warning || task.warningKind"
											class="mb-0 mt-1 text-[11px] text-warning"
										>
											{{ taskWarning(task) }}
										</p>
										<p v-if="task.error || task.errorKind" class="mb-0 mt-1 text-[11px] text-error">
											{{ taskError(task) }}
										</p>
									</div>
								</div>
							</article>
						</div>
					</section>

					<section class="space-y-3 border-t border-[var(--ui-hairline)] pt-5">
						<h4 class="progress-section-title mb-3 mt-0 text-sm font-semibold">
							{{ t('progressCenter.serverTransfers') }}
						</h4>

						<UiLoadingState
							v-if="serverTransfersLoading && !serverTransfers.length"
							class="py-8"
							compact
							:bordered="false"
							:title="t('transferProgressModal.loading')"
						/>
						<UiInlineNotice v-else-if="serverTransfersError" tone="danger">
							<strong>{{ t('transferProgressModal.errorLoadingTitle') }}</strong>
							<p class="m-0">
								{{ t('transferProgressModal.errorLoading', { error: t(serverTransfersError) }) }}
							</p>
						</UiInlineNotice>
						<UiEmptyState
							v-else-if="!serverTransfers.length"
							dense
							icon="far fa-file-lines"
							:title="t('transferProgressModal.noTasks')"
						/>
						<div v-else class="space-y-3">
							<article
								v-for="task in displayedServerTransfers"
								:key="task.taskId"
								class="server-transfer-card"
							>
								<div class="mb-2 flex items-start justify-between gap-3">
									<div class="min-w-0">
										<span class="block break-words text-base font-semibold">
											{{ t('transferProgressModal.task.idLabel') }}: {{ serverTaskTitle(task) }}
										</span>
										<span class="text-xs text-text-secondary">
											{{ t('transferProgressModal.task.createdAt') }}:
											{{ formatDate(task.createdAt) }}
										</span>
									</div>
									<div class="flex shrink-0 items-center gap-2">
										<span :class="['server-status', statusClasses(task.status)]">
											{{ statusLabel(task.status) }}
										</span>
										<UiButton
											v-if="
												serverTaskCancellable(task.status) ||
												serverTaskFinal(task.status) ||
												task.status === 'cancelling'
											"
											:disabled="task.status === 'cancelling'"
											:appearance="serverTaskFinal(task.status) ? 'soft' : 'solid'"
											:tone="serverTaskFinal(task.status) ? 'neutral' : 'danger'"
											density="compact"
											class="text-xs"
											:title="
												serverTaskFinal(task.status)
													? t('transferProgressModal.removeTaskTooltip')
													: t('transferProgressModal.cancelTaskTooltip')
											"
											@click="
												serverTaskFinal(task.status)
													? emit('remove', 'server-transfers', task.taskId)
													: emit('cancel', 'server-transfers', task.taskId)
											"
										>
											<UiSpinner
												v-if="task.status === 'cancelling'"
												class="mr-1"
												density="compact"
											/>
											{{
												task.status === 'cancelling'
													? t('transferProgressModal.cancellingButton')
													: serverTaskFinal(task.status)
														? t('transferProgressModal.removeButton')
														: t('transferProgressModal.cancelButton')
											}}
										</UiButton>
									</div>
								</div>

								<div v-if="task.overallProgress !== undefined" class="mb-2">
									<div class="mb-0.5 flex justify-between text-xs text-text-secondary">
										<span>{{ t('transferProgressModal.task.overallProgress') }}</span>
										<span>{{ task.overallProgress }}%</span>
									</div>
									<div
										class="server-progress-track"
										role="progressbar"
										aria-valuemin="0"
										aria-valuemax="100"
										:aria-valuenow="Math.round(task.overallProgress)"
									>
										<span
											class="server-progress-value"
											:style="{
												transform: `scaleX(${Math.max(0, Math.min(100, task.overallProgress)) / 100})`,
											}"
										></span>
									</div>
								</div>

								<details v-if="task.subTasks.length" class="group mt-2">
									<summary
										class="cursor-pointer list-none text-xs font-medium text-primary hover:underline"
									>
										{{
											t('transferProgressModal.subTasks.titleToggle', {
												count: task.subTasks.length,
											})
										}}
										<span class="group-open:hidden">+</span
										><span class="hidden group-open:inline">-</span>
									</summary>
									<ul class="ml-1 mt-2 space-y-1.5 border-l border-border pl-3">
										<li
											v-for="subTask in task.subTasks"
											:key="subTask.subTaskId"
											class="server-subtask-row text-xs"
										>
											<p>
												<strong>{{ t('transferProgressModal.subTask.source') }}:</strong>
												{{ subTask.sourceItemName }}
											</p>
											<p>
												<strong>{{ t('transferProgressModal.subTask.connectionId') }}:</strong>
												{{ connectionName(subTask.connectionId) }}
											</p>
											<div class="flex flex-wrap items-center gap-1">
												<strong>{{ t('transferProgressModal.subTask.status') }}:</strong>
												<span :class="['server-status', statusClasses(subTask.status)]">
													{{ statusLabel(subTask.status) }}
												</span>
												<span
													v-if="subTask.progress !== undefined"
													class="text-xs text-text-secondary"
												>
													({{ subTask.progress }}%)
												</span>
											</div>
											<p v-if="subTask.transferMethodUsed">
												<strong>{{ t('transferProgressModal.subTask.method') }}:</strong>
												{{ subTask.transferMethodUsed }}
											</p>
											<p
												v-if="
													(subTask.status === 'failed' || subTask.status === 'unknown') &&
													subTask.error
												"
												class="text-error"
											>
												<strong>{{ t('transferProgressModal.subTask.error') }}:</strong>
												{{ t('serverTransferErrors.' + subTask.error) }}
											</p>
										</li>
									</ul>
								</details>
								<div v-else class="mt-2 text-xs text-text-secondary">
									{{ t('transferProgressModal.subTasks.noSubTasks') }}
								</div>
							</article>
						</div>
					</section>
				</div>

				<div
					class="mt-auto flex flex-shrink-0 items-center justify-end border-t border-border px-4 py-4 sm:px-6"
				>
					<UiButton appearance="solid" tone="primary" @click="emit('close')">
						{{ t('common.close') }}
					</UiButton>
				</div>
			</div>
		</section>
	</UiOverlayPanel>
</template>

<style scoped>
	.progress-display-overlay {
		max-height: min(80dvh, 46rem);
	}
	.transfer-progress-header {
		border-bottom: 1px solid var(--ui-hairline);
	}
	.progress-display-content {
		scrollbar-gutter: stable;
	}
	.progress-section-title {
		color: var(--text-color);
		font-size: 0.78rem;
		letter-spacing: 0.01em;
	}
	.hidden-progress-source-grid {
		display: grid;
		width: 100%;
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
	}
	.hidden-progress-source-card {
		width: 100%;
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--ui-hairline);
		border-radius: 14px;
		background: color-mix(in srgb, var(--card-bg-color) 40%, transparent);
		box-shadow: var(--ui-glass-highlight);
	}
	.hidden-progress-source-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 11px;
		border-bottom: 1px solid var(--ui-hairline);
		background: color-mix(in srgb, var(--header-bg-color) 28%, transparent);
	}
	.hidden-progress-source-list {
		width: 100%;
		max-height: 260px;
		overflow-y: auto;
		padding: 2px 11px 6px;
	}
	.hidden-progress-task-row {
		padding: 9px 0;
		border-bottom: 1px solid var(--ui-hairline);
	}
	.hidden-progress-task-row:last-child {
		border-bottom: 0;
	}
	.server-transfer-card {
		display: grid;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--ui-hairline);
		border-radius: 14px;
		background: color-mix(in srgb, var(--card-bg-color) 40%, transparent);
		box-shadow: var(--ui-glass-highlight);
	}
	.server-status {
		display: inline-flex;
		min-height: 20px;
		align-items: center;
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 0.12rem 0.48rem;
		font-size: 0.66rem;
		font-weight: 650;
		line-height: 1;
		white-space: nowrap;
	}
	.server-status--success {
		border-color: color-mix(in srgb, var(--status-success-color) 30%, transparent);
		background: color-mix(in srgb, var(--status-success-color) 12%, transparent);
		color: color-mix(in srgb, var(--status-success-color) 76%, var(--text-color));
	}
	.server-status--danger {
		border-color: color-mix(in srgb, var(--status-error-color) 30%, transparent);
		background: color-mix(in srgb, var(--status-error-color) 12%, transparent);
		color: color-mix(in srgb, var(--status-error-color) 78%, var(--text-color));
	}
	.server-status--warning {
		border-color: color-mix(in srgb, var(--status-warning-color) 32%, transparent);
		background: color-mix(in srgb, var(--status-warning-color) 13%, transparent);
		color: color-mix(in srgb, var(--status-warning-color) 72%, var(--text-color));
	}
	.server-status--active {
		border-color: color-mix(in srgb, var(--link-active-color) 30%, transparent);
		background: color-mix(in srgb, var(--link-active-color) 11%, transparent);
		color: color-mix(in srgb, var(--link-active-color) 78%, var(--text-color));
	}
	.server-status--muted {
		border-color: var(--ui-hairline);
		background: var(--ui-fill-soft);
		color: var(--text-color-secondary);
	}
	.server-progress-track {
		position: relative;
		width: 100%;
		height: 6px;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border-color) 58%, transparent);
		box-shadow: inset 0 1px 1px rgb(0 0 0 / 8%);
	}
	.server-progress-value {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		transform-origin: left center;
		background-image: linear-gradient(
			90deg,
			var(--link-active-color),
			color-mix(in srgb, var(--link-active-color) 58%, white)
		);
		transition: transform 180ms ease;
	}
	.server-subtask-row {
		border: 1px solid var(--ui-hairline);
		border-radius: 10px;
		background: var(--ui-fill-soft);
		padding: 8px 9px;
	}
	.custom-scrollbar::-webkit-scrollbar {
		width: 6px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		border: 2px solid transparent;
		border-radius: 10px;
		background-color: rgba(128, 128, 128, 0.3);
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background-color: rgba(128, 128, 128, 0.5);
	}
	.custom-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
	}
	@media (max-width: 640px) {
		.progress-display-overlay .hidden-progress-source-header {
			align-items: flex-start;
			flex-wrap: wrap;
		}
		.server-transfer-card {
			padding: 10px;
		}
	}
</style>
