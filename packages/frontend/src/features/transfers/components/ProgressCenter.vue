<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
	import { useDraggablePosition, useResizeHandle } from '@/foundation/interaction';
	import { UiButton, UiEmptyState, UiResizeHandle } from '@/foundation/ui';
	import type { TransferTask } from '../model/transfer-types';
	import {
		formatTransferBytes as formatBytes,
		isIndeterminateArchiveProgress as archiveIndeterminate,
	} from '../model/progress-presentation';

	interface ProgressWindowGeometry {
		width: number;
		height: number;
		x: number;
		y: number;
	}
	const progressWindowStorage = {
		namespace: 'transfers.progress-window',
		version: 1,
		codec: jsonStorageCodec<ProgressWindowGeometry>((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
			const candidate = value as Record<string, unknown>;
			return [candidate.width, candidate.height, candidate.x, candidate.y].every(
				(entry) => typeof entry === 'number' && Number.isFinite(entry),
			)
				? {
						width: candidate.width as number,
						height: candidate.height as number,
						x: candidate.x as number,
						y: candidate.y as number,
					}
				: undefined;
		}),
		legacyKeys: ['nexus.transfer-progress-window'],
	} as const;
	const MIN_WIDTH = 280;
	const MIN_HEIGHT = 130;

	const props = withDefaults(defineProps<{ tasks: TransferTask[]; sourceLabel?: string; teleport?: boolean }>(), {
		teleport: true,
	});
	const emit = defineEmits<{ cancel: [id: string]; cancelAll: []; remove: [id: string]; hide: [] }>();
	const { t } = useI18n();
	const panel = ref<HTMLElement | null>(null);
	const width = ref(360);
	const height = ref(190);
	const position = ref({ x: 16, y: 16 });
	const initialized = ref(false);
	const aggregateSpeed = ref(0);
	let speedTimer: number | undefined;
	let lastSpeedSampleAt = 0;
	let lastBytesWritten = 0;

	const availableWidth = (): number => Math.max(1, window.innerWidth - 16);

	const availableHeight = (): number => Math.max(1, window.innerHeight - 16);

	const responsiveMinWidth = (): number => Math.min(MIN_WIDTH, availableWidth());

	const responsiveMinHeight = (): number => Math.min(MIN_HEIGHT, availableHeight());

	const sorted = computed(() => [...props.tasks].sort((a, b) => b.createdAt - a.createdAt));

	const done = (status: string) =>
		['completed', 'cancelled', 'skipped', 'partial', 'unknown', 'error'].includes(status);

	const activeTasks = computed(() => sorted.value.filter((task) => !done(task.status)));

	const isTransferTask = (task: TransferTask): boolean => ['copy', 'move', 'transfer'].includes(task.kind);

	const presentationMode = computed<'upload' | 'archive' | 'transfer' | 'mixed'>(() => {
		if (sorted.value.length && sorted.value.every((task) => task.kind === 'upload')) return 'upload';
		if (sorted.value.length && sorted.value.every((task) => task.kind === 'compress' || task.kind === 'decompress'))
			return 'archive';
		if (sorted.value.length && sorted.value.every(isTransferTask)) return 'transfer';
		return 'mixed';
	});

	const currentFilename = (task: TransferTask): string => {
		const value = task.currentFile || task.label;
		return value.split(/[\/]/).filter(Boolean).at(-1) || value;
	};

	const archiveLabel = (task: TransferTask): string => t(`progressCenter.kind.${task.kind}`);

	const totalBytesWritten = () => props.tasks.reduce((sum, task) => sum + Math.max(0, task.bytesWritten), 0);

	const sampleAggregateSpeed = (): void => {
		const now = performance.now();
		const bytes = totalBytesWritten();
		if (!lastSpeedSampleAt) {
			lastSpeedSampleAt = now;
			lastBytesWritten = bytes;
			aggregateSpeed.value = 0;
			return;
		}
		const elapsedSeconds = (now - lastSpeedSampleAt) / 1000;
		const deltaBytes = bytes - lastBytesWritten;
		aggregateSpeed.value = elapsedSeconds > 0 && deltaBytes >= 0 ? deltaBytes / elapsedSeconds : 0;
		lastSpeedSampleAt = now;
		lastBytesWritten = bytes;
	};

	const formatSpeed = (bytesPerSecond: number): string => {
		if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
		if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
		return `${Math.round(bytesPerSecond)} B/s`;
	};

	const clampWindow = (): void => {
		width.value = Math.min(Math.max(responsiveMinWidth(), width.value), availableWidth());
		height.value = Math.min(Math.max(responsiveMinHeight(), height.value), availableHeight());
		position.value = {
			x: Math.max(8, Math.min(position.value.x, window.innerWidth - width.value - 8)),
			y: Math.max(8, Math.min(position.value.y, window.innerHeight - height.value - 8)),
		};
	};

	const clampRenderedWindow = (): void => {
		const element = panel.value;
		if (!element) return;
		const viewportWidth = document.documentElement.clientWidth;
		const viewportHeight = document.documentElement.clientHeight;
		const rect = element.getBoundingClientRect();
		const maxWidth = Math.max(1, viewportWidth - 16);
		const maxHeight = Math.max(1, viewportHeight - 16);
		if (rect.width > maxWidth + 0.5) width.value = maxWidth;
		if (rect.height > maxHeight + 0.5) height.value = maxHeight;
		const renderedWidth = Math.min(rect.width, maxWidth);
		const renderedHeight = Math.min(rect.height, maxHeight);
		position.value = {
			x: Math.max(8, Math.min(position.value.x, viewportWidth - renderedWidth - 8)),
			y: Math.max(8, Math.min(position.value.y, viewportHeight - renderedHeight - 8)),
		};
	};

	const clampAfterRender = (): void => {
		clampWindow();
		void nextTick(clampRenderedWindow);
	};

	const saveWindow = (): void => {
		writeStoredValue(progressWindowStorage, {
			width: width.value,
			height: height.value,
			x: position.value.x,
			y: position.value.y,
		});
	};

	const restoreWindow = (): void => {
		let restored = false;
		const saved = readStoredValue(progressWindowStorage);
		if (saved) {
			width.value = saved.width;
			height.value = saved.height;
			position.value = { x: saved.x, y: saved.y };
			restored = true;
		}

		if (!restored) {
			width.value = Math.min(360, availableWidth());
			height.value = Math.min(190, availableHeight());
			position.value = {
				x: Math.max(8, window.innerWidth - width.value - 16),
				y: Math.max(8, window.innerHeight - height.value - 16),
			};
		}
		clampWindow();
		initialized.value = true;
	};

	const drag = useDraggablePosition({
		position,

		getElement: () => panel.value,

		canStart: (event) => !(event.target as HTMLElement).closest('button'),

		constrain: (candidate, element) => ({
			x: Math.max(8, Math.min(candidate.x, window.innerWidth - element.offsetWidth - 8)),
			y: Math.max(8, Math.min(candidate.y, window.innerHeight - element.offsetHeight - 8)),
		}),

		onEnd: saveWindow,
	});

	const resize = useResizeHandle({
		width,
		height,
		minWidth: responsiveMinWidth,
		minHeight: responsiveMinHeight,
		maxWidth: availableWidth,
		maxHeight: availableHeight,
		onMove: clampWindow,
		onEnd: saveWindow,
	});

	onMounted(() => {
		restoreWindow();
		void nextTick(clampRenderedWindow);
		sampleAggregateSpeed();
		speedTimer = window.setInterval(sampleAggregateSpeed, 500);
		window.addEventListener('resize', clampAfterRender);
	});
	onBeforeUnmount(() => {
		if (speedTimer !== undefined) window.clearInterval(speedTimer);
		window.removeEventListener('resize', clampAfterRender);
	});
	watch(
		() => [props.tasks.length, activeTasks.value.length, presentationMode.value],
		() => void nextTick(clampRenderedWindow),
	);
</script>

<template>
	<Teleport to="body" :disabled="!props.teleport">
		<div
			v-show="initialized"
			ref="panel"
			data-ui-gen="2"
			class="transfer-progress-window ui-surface ui-surface--raised ui-radius--panel fixed z-[60] flex min-h-0 flex-col overflow-hidden text-sm"
			:class="[
				`transfer-progress-window--${presentationMode}`,
				drag.dragging.value ? 'dragging select-none' : '',
				resize.isResizing.value ? 'resizing select-none' : '',
			]"
			:style="{ left: `${position.x}px`, top: `${position.y}px`, width: `${width}px`, height: `${height}px` }"
		>
			<header class="transfer-progress-header ui-glass-chrome shrink-0" @pointerdown="drag.startDragging">
				<template v-if="presentationMode === 'upload'">
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<h4 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
							<span v-if="sourceLabel">{{ sourceLabel }} · </span>{{ t('fileManager.uploadTasks') }}
						</h4>
						<span
							v-if="activeTasks.length"
							class="shrink-0 whitespace-nowrap rounded-md bg-black/5 px-2 py-1 text-xs tabular-nums text-text-secondary dark:bg-white/5"
						>
							{{ t('fileManager.uploadSpeed') }} {{ formatSpeed(aggregateSpeed) }}
						</span>
						<div class="ml-auto flex shrink-0 items-center gap-2">
							<UiButton
								v-if="activeTasks.length > 1"
								appearance="ghost"
								tone="danger"
								density="compact"
								class="shrink-0 text-xs font-medium"
								@click="emit('cancelAll')"
							>
								{{ t('fileManager.actions.cancelAll') }} ({{ activeTasks.length }})
							</UiButton>
							<UiButton
								appearance="ghost"
								density="compact"
								icon-only
								class="progress-icon-button h-7 w-7"
								:title="t('progressCenter.hide')"
								:aria-label="t('progressCenter.hide')"
								@click="emit('hide')"
							>
								<i class="fas fa-minus" aria-hidden="true"></i>
							</UiButton>
						</div>
					</div>
				</template>

				<template v-else-if="presentationMode === 'archive'">
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<span class="archive-icon"><i class="fas fa-box-archive" aria-hidden="true"></i></span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-semibold">
								<span v-if="sourceLabel">{{ sourceLabel }} · </span
								>{{
									sorted[0]
										? `${archiveLabel(sorted[0])} ${sorted[0].label}`
										: t('progressCenter.title')
								}}
							</div>
							<div class="text-[11px] text-text-secondary">{{ t('progressCenter.running') }}</div>
						</div>
						<span v-if="sorted[0]" class="archive-percent">{{ Math.round(sorted[0].progress) }}%</span>
						<UiButton
							appearance="ghost"
							density="compact"
							icon-only
							class="progress-icon-button h-7 w-7"
							:title="t('progressCenter.hide')"
							:aria-label="t('progressCenter.hide')"
							@click="emit('hide')"
						>
							<i class="fas fa-minus" aria-hidden="true"></i>
						</UiButton>
					</div>
				</template>

				<template v-else>
					<h4 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
						<span v-if="sourceLabel">{{ sourceLabel }} · </span
						>{{
							presentationMode === 'transfer' ? t('fileManager.transferTasks') : t('progressCenter.title')
						}}
					</h4>
					<div class="flex items-center gap-2">
						<span
							v-if="activeTasks.length"
							class="whitespace-nowrap text-xs tabular-nums text-text-secondary"
						>
							{{ t('fileManager.transferSpeed') }} {{ formatSpeed(aggregateSpeed) }}
						</span>
						<UiButton
							v-if="activeTasks.length > 1"
							appearance="ghost"
							tone="danger"
							density="compact"
							class="text-xs"
							@click="emit('cancelAll')"
						>
							{{ t('progressCenter.cancelAll') }}
						</UiButton>
						<UiButton
							appearance="ghost"
							density="compact"
							icon-only
							class="progress-icon-button h-6 w-6"
							:title="t('progressCenter.hide')"
							:aria-label="t('progressCenter.hide')"
							@click="emit('hide')"
						>
							<i class="fas fa-minus" aria-hidden="true"></i>
						</UiButton>
					</div>
				</template>
			</header>

			<UiEmptyState
				v-if="!sorted.length"
				compact
				:bordered="false"
				icon="fa-solid fa-arrow-right-arrow-left"
				:title="t('progressCenter.empty')"
			/>

			<ul
				v-else-if="presentationMode === 'upload'"
				class="progress-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto p-3"
			>
				<li
					v-for="task in sorted"
					:key="task.id"
					:data-task-id="task.id"
					:data-task-kind="task.kind"
					:data-task-status="task.status"
					class="upload-task-row mb-1.5 text-xs last:mb-0"
				>
					<div class="min-w-0">
						<div class="truncate font-medium" :title="task.label">{{ currentFilename(task) }}</div>
						<div class="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-secondary">
							<span>{{ t(`progressCenter.status.${task.status}`) }}</span>
							<span class="tabular-nums"
								>{{ formatBytes(task.bytesWritten)
								}}<template v-if="task.totalBytes > 0">
									/ {{ formatBytes(task.totalBytes) }}</template
								></span
							>
						</div>
						<div
							v-if="!done(task.status)"
							class="transfer-progress-track mt-2"
							role="progressbar"
							aria-valuemin="0"
							aria-valuemax="100"
							:aria-valuenow="Math.round(task.progress)"
						>
							<span
								class="transfer-progress-value"
								:style="{
									transform: `scaleX(${Math.max(0, Math.min(100, task.progress)) / 100})`,
								}"
							></span>
						</div>
					</div>
					<span
						v-if="!done(task.status)"
						class="w-11 shrink-0 text-right text-xs tabular-nums text-text-secondary"
					>
						{{ Math.round(task.progress) }}%
					</span>
					<span v-else aria-hidden="true"></span>
					<UiButton
						v-if="!done(task.status)"
						appearance="ghost"
						tone="danger"
						density="compact"
						class="justify-self-end text-xs"
						@click="emit('cancel', task.id)"
					>
						{{ t('common.cancel') }}
					</UiButton>
					<UiButton
						v-else
						appearance="ghost"
						density="compact"
						icon-only
						class="justify-self-end"
						:aria-label="t('common.remove')"
						@click="emit('remove', task.id)"
					>
						<i class="fas fa-times" aria-hidden="true"></i>
					</UiButton>
				</li>
			</ul>

			<ul
				v-else-if="presentationMode === 'archive'"
				class="progress-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto"
			>
				<li
					v-for="task in sorted"
					:key="task.id"
					:data-task-id="task.id"
					:data-task-kind="task.kind"
					:data-task-status="task.status"
					class="archive-progress-body"
				>
					<div class="flex min-w-0 items-center gap-2">
						<span class="min-w-0 flex-1 truncate text-xs font-semibold" :title="task.label">
							{{ archiveLabel(task) }} {{ task.label }}
						</span>
						<UiButton
							v-if="!done(task.status)"
							appearance="ghost"
							tone="danger"
							density="compact"
							class="shrink-0"
							:disabled="task.status === 'cancelling'"
							@click="emit('cancel', task.id)"
						>
							<i class="fas fa-stop" aria-hidden="true"></i
							>{{ task.status === 'cancelling' ? t('progressCenter.cancelling') : t('common.cancel') }}
						</UiButton>
						<UiButton
							v-else
							appearance="ghost"
							density="compact"
							class="shrink-0"
							@click="emit('remove', task.id)"
						>
							<i class="fas fa-times" aria-hidden="true"></i>{{ t('common.remove') }}
						</UiButton>
					</div>
					<div class="space-y-1.5">
						<div class="flex items-center justify-between gap-4 text-xs">
							<span>{{
								t('fileManager.archiveProgress.filesProcessed', { count: task.completedFiles })
							}}</span>
							<span v-if="task.bytesWritten > 0" class="font-mono text-text-secondary">{{
								formatBytes(task.bytesWritten)
							}}</span>
							<span v-if="task.totalFiles !== null" class="font-mono text-text-secondary"
								>{{ task.completedFiles }}/{{ task.totalFiles }}</span
							>
						</div>
						<div
							class="archive-progress-track"
							role="progressbar"
							aria-valuemin="0"
							aria-valuemax="100"
							:aria-valuenow="archiveIndeterminate(task) ? undefined : Math.round(task.progress)"
						>
							<div
								class="archive-progress-value"
								:class="archiveIndeterminate(task) ? 'animate-pulse' : ''"
								:style="{
									transform: archiveIndeterminate(task)
										? 'scaleX(1)'
										: `scaleX(${Math.max(0, Math.min(100, task.progress)) / 100})`,
								}"
							></div>
						</div>
					</div>
					<div v-if="task.currentFile" class="archive-current-file" :title="task.currentFile">
						<i class="far fa-file-lines" aria-hidden="true"></i
						><span class="truncate">{{ currentFilename(task) }}</span>
					</div>
				</li>
			</ul>

			<ul v-else class="progress-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto p-3">
				<li
					v-for="task in sorted"
					:key="task.id"
					:data-task-id="task.id"
					:data-task-kind="task.kind"
					:data-task-status="task.status"
					class="transfer-mixed-row mb-2 last:mb-0"
				>
					<div class="mb-1 flex min-w-0 items-center gap-2 text-xs">
						<span
							class="min-w-0 flex-1 truncate"
							:title="isTransferTask(task) ? task.label : task.currentFile || task.label"
							>{{ t(`progressCenter.kind.${task.kind}`) }} ·
							{{ isTransferTask(task) ? task.label : currentFilename(task) }}</span
						>
						<span v-if="task.transferMethodUsed" class="shrink-0 text-text-secondary" data-transfer-method>
							{{ task.transferMethodUsed }}
						</span>
						<span class="shrink-0 tabular-nums">
							<template v-if="isTransferTask(task)">{{ t('progressCenter.overallProgress') }} </template>
							{{ Math.round(task.progress * 10) / 10 }}%
						</span>
						<UiButton
							v-if="!done(task.status)"
							appearance="ghost"
							tone="danger"
							density="compact"
							class="shrink-0 text-xs"
							@click="emit('cancel', task.id)"
						>
							{{ t('common.cancel') }}
						</UiButton>
					</div>
					<div
						v-if="isTransferTask(task) && task.currentFile"
						class="mb-1 truncate text-[11px] text-text-secondary"
						:title="task.currentFile"
					>
						{{ t('progressCenter.currentFile', { file: currentFilename(task) }) }}
					</div>
					<div
						class="transfer-progress-track"
						role="progressbar"
						:aria-label="isTransferTask(task) ? t('progressCenter.overallProgress') : undefined"
						aria-valuemin="0"
						aria-valuemax="100"
						:aria-valuenow="Math.round(task.progress)"
					>
						<span
							class="transfer-progress-value"
							:style="{
								transform: `scaleX(${Math.max(0, Math.min(100, task.progress)) / 100})`,
							}"
						></span>
					</div>
					<div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-secondary">
						<span :class="task.status === 'error' ? 'text-error' : ''">{{
							t(`progressCenter.status.${task.status}`)
						}}</span>
						<span class="min-w-0 text-right tabular-nums">
							<span v-if="isTransferTask(task) && task.totalFiles !== null" class="block">
								{{
									t('progressCenter.completedItems', {
										completed: task.completedFiles,
										total: task.totalFiles,
									})
								}}
							</span>
							<template v-if="task.totalBytes > 0"
								>{{ formatBytes(task.bytesWritten) }} / {{ formatBytes(task.totalBytes) }}</template
							>
							<template v-else-if="!isTransferTask(task) && task.totalFiles !== null"
								>{{ task.completedFiles }} / {{ task.totalFiles }}</template
							>
							<template v-else-if="task.bytesWritten > 0 || task.totalFiles === null">{{
								formatBytes(task.bytesWritten)
							}}</template>
						</span>
					</div>
				</li>
			</ul>

			<UiResizeHandle
				class="absolute bottom-0 right-0 z-10"
				:title="t('progressCenter.resize')"
				:aria-label="t('progressCenter.resize')"
				@pointerdown.stop="resize.startResize"
			/>
		</div>
	</Teleport>
</template>

<style scoped>
	.transfer-progress-window {
		box-sizing: border-box;
		min-width: min(280px, calc(100vw - 16px));
		min-height: min(130px, calc(100vh - 16px));
		max-width: calc(100vw - 16px);
		max-height: calc(100vh - 16px);
		border-radius: 18px;
	}
	.transfer-progress-window--archive {
		border-color: var(--ui-hairline);
	}
	.transfer-progress-header {
		display: flex;
		min-height: 46px;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		border-bottom: 1px solid var(--ui-hairline);
		padding: 9px 11px;
		cursor: grab;
	}
	.dragging .transfer-progress-header {
		cursor: grabbing;
	}
	.progress-icon-button {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid transparent;
		border-radius: 7px;
		color: var(--text-color-secondary);
		transition: 150ms ease;
	}
	.progress-icon-button:hover {
		border-color: var(--border-color);
		background: color-mix(in srgb, var(--border-color) 55%, transparent);
		color: var(--text-color);
	}
	.upload-task-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		column-gap: 0.5rem;
		row-gap: 0.25rem;
		padding: 9px 10px;
		border: 1px solid var(--ui-hairline);
		border-radius: 13px;
		background: color-mix(in srgb, var(--card-bg-color) 44%, transparent);
		box-shadow: var(--ui-glass-highlight);
	}
	.transfer-progress-track {
		position: relative;
		width: 100%;
		height: 6px;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border-color) 58%, transparent);
		box-shadow: inset 0 1px 1px rgb(0 0 0 / 8%);
	}
	.transfer-progress-value {
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
	.transfer-mixed-row {
		padding: 9px 10px;
		border: 1px solid var(--ui-hairline);
		border-radius: 13px;
		background: color-mix(in srgb, var(--card-bg-color) 44%, transparent);
		box-shadow: var(--ui-glass-highlight);
	}
	.archive-icon {
		display: grid;
		width: 30px;
		height: 30px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 9px;
		background: color-mix(in srgb, var(--link-active-color, #007bff) 20%, transparent);
		color: var(--link-active-color, #007bff);
	}
	.archive-percent {
		border-radius: 999px;
		padding: 2px 7px;
		background: color-mix(in srgb, var(--link-active-color, #007bff) 17%, transparent);
		color: var(--link-active-color, #007bff);
		font: 600 11px var(--font-family-monospace);
	}
	.archive-progress-body {
		display: grid;
		gap: 10px;
		margin: 6px 10px;
		padding: 11px 12px 12px;
		border: 1px solid var(--ui-hairline);
		border-radius: 13px;
		background: color-mix(in srgb, var(--card-bg-color) 44%, transparent);
		box-shadow: var(--ui-glass-highlight);
	}
	.archive-progress-body + .archive-progress-body {
		border-top: 1px solid var(--ui-hairline);
	}
	.archive-progress-track {
		height: 7px;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border-color) 58%, transparent);
		box-shadow: inset 0 1px 1px rgb(0 0 0 / 8%);
	}
	.archive-progress-value {
		width: 100%;
		height: 100%;
		border-radius: inherit;
		transform-origin: left center;
		background-image: linear-gradient(
			90deg,
			var(--link-active-color, #007bff),
			color-mix(in srgb, var(--link-active-color, #007bff) 55%, white)
		);
		transition: transform 180ms ease;
	}
	.archive-current-file {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 7px;
		border-radius: 7px;
		background: color-mix(in srgb, var(--border-color) 40%, transparent);
		padding: 7px 9px;
		font-size: 12px;
		color: var(--text-color-secondary);
	}
	.progress-scrollbar::-webkit-scrollbar {
		width: 6px;
	}
	.progress-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.progress-scrollbar::-webkit-scrollbar-thumb {
		border-radius: 10px;
		background-color: rgba(128, 128, 128, 0.3);
	}
	.progress-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
	}
	@media (max-width: 520px) {
		.upload-task-row {
			grid-template-columns: minmax(0, 1fr) auto auto;
			column-gap: 0.35rem;
			padding-inline: 9px;
		}
	}
</style>
