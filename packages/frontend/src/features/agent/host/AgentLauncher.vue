<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
	import type { AgentHostSummaryDto } from '../api/agent-api';
	import { useAgentHostState } from './agent-host-state';

	const props = defineProps<{ summary: AgentHostSummaryDto | null; paused?: boolean }>();
	const emit = defineEmits<{ layoutChange: [] }>();
	const { windowManager: agentWindowManager } = useAgentHostState();

	const position = computed(() => agentWindowManager.state.launcherPosition);
	const dock = computed(() => agentWindowManager.state.launcherDock);

	const DRAG_START_PX = 6;

	let pointerId: number | null = null;
	let originX = 0;
	let originY = 0;
	let startRight = 0;
	let startBottom = 0;
	let startDock: 'left' | 'right' | null = null;
	let hasMoved = false;

	const dragging = ref(false);

	const badge = computed(() => {
		const summary = props.summary;
		if (!summary) return 0;
		return summary.totalRunningRuns + summary.totalPendingApprovals + summary.totalPendingBudgetRequests;
	});

	const clamp = (right: number, bottom: number) => ({
		right: Math.max(0, Math.min(right, Math.max(0, window.innerWidth - 44))),
		bottom: Math.max(12, Math.min(bottom, Math.max(12, window.innerHeight - 72))),
	});

	const pointerDown = (event: PointerEvent) => {
		if (props.paused || event.button !== 0 || pointerId !== null) return;
		pointerId = event.pointerId;
		originX = event.clientX;
		originY = event.clientY;
		startRight = window.innerWidth - (event.currentTarget as HTMLElement).getBoundingClientRect().right;
		startBottom = position.value.bottom;
		startDock = dock.value;
		hasMoved = false;
		dragging.value = false;
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {
			// ignore
		}
	};

	const pointerMove = (event: PointerEvent) => {
		if (pointerId !== event.pointerId) return;
		const dx = event.clientX - originX;
		const dy = event.clientY - originY;
		if (!dragging.value && Math.hypot(dx, dy) < DRAG_START_PX) return;
		dragging.value = true;
		hasMoved = true;
		agentWindowManager.setLauncherPosition(clamp(startRight - dx, startBottom - dy));
	};

	const finish = (event: PointerEvent) => {
		if (pointerId !== event.pointerId) return;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) {
			try {
				target.releasePointerCapture(event.pointerId);
			} catch {
				// pointer capture already released
			}
		}
		pointerId = null;
		const wasDragging = dragging.value;
		dragging.value = false;

		if (wasDragging) {
			const right = position.value.right;
			const left = window.innerWidth - right - 44;
			if (Math.min(right, left) <= 28) agentWindowManager.dockLauncher(right <= left ? 'right' : 'left');
			if (hasMoved) emit('layoutChange');
			return;
		}
		if (hasMoved || props.paused) return;
		agentWindowManager.openHub({ restoreRecent: true });
	};

	const cancel = (event: PointerEvent) => {
		if (pointerId !== event.pointerId) return;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) {
			try {
				target.releasePointerCapture(event.pointerId);
			} catch {
				// pointer capture already released
			}
		}
		const wasDragging = dragging.value;
		pointerId = null;
		dragging.value = false;
		if (wasDragging && hasMoved) {
			agentWindowManager.setLauncherPosition(clamp(startRight, startBottom));
			if (startDock) agentWindowManager.dockLauncher(startDock);
		}
		hasMoved = true;
	};

	const onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		agentWindowManager.resetLauncherPosition();
		emit('layoutChange');
	};

	const keydown = (event: KeyboardEvent) => {
		if (props.paused || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault();
		agentWindowManager.openHub({ restoreRecent: true });
	};

	const handleViewportResize = (): void => {
		agentWindowManager.clampLauncherPosition();
	};

	onMounted(() => {
		agentWindowManager.clampLauncherPosition();
		window.addEventListener('resize', handleViewportResize);
	});

	onBeforeUnmount(() => {
		window.removeEventListener('resize', handleViewportResize);
	});
</script>

<template>
	<div
		class="fixed z-30 h-11 w-11"
		:class="{ 'overflow-hidden': dock !== null }"
		:style="{
			left: dock === 'left' ? '0px' : dock === 'right' ? 'calc(100vw - 44px)' : undefined,
			right: dock ? undefined : `${position.right}px`,
			bottom: `${position.bottom}px`,
		}"
	>
		<button
			type="button"
			data-agent-launcher-trigger
			class="agent-launcher touch-none select-none"
			:class="{ 'is-dragging': dragging }"
			:data-dock="dock"
			:aria-label="$t('agent.launcher.open')"
			:title="`${$t('agent.launcher.open')} · ${$t('agent.launcher.dragHint')}`"
			:disabled="paused"
			@pointerdown="pointerDown"
			@pointermove="pointerMove"
			@pointerup="finish"
			@pointercancel="cancel"
			@contextmenu="onContextMenu"
			@keydown="keydown"
		>
			<div class="flex items-center justify-center pointer-events-none">
				<svg
					class="h-6 w-6"
					viewBox="0 0 24 24"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<path
						d="M6 4h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7l-5 3v-3a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linejoin="round"
					/>
					<path
						d="m7 9 3 2.5L7 14m6 0h4"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</div>

			<!-- 状态与任务数字指示徽标 -->
			<span
				v-if="badge > 0"
				class="absolute -right-0.5 -top-0.5 sm:-right-1 sm:-top-1 flex h-4 min-w-4 sm:h-4.5 sm:min-w-4.5 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold leading-none text-white shadow-xs ring-2 ring-background"
			>
				{{ badge > 99 ? '99+' : badge }}
			</span>
		</button>
	</div>
</template>

<style scoped>
	.agent-launcher {
		position: relative;
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		border: 1px solid var(--color-primary);
		border-radius: 50%;
		background: var(--color-primary);
		color: var(--color-primary-foreground, #fff);
		box-shadow:
			var(--ui-glass-highlight),
			0 4px 16px rgb(0 0 0 / 14%);
		cursor: pointer;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			transform 150ms ease;
	}
	.agent-launcher:hover {
		border-color: var(--link-active-color);
		background: var(--color-primary);
	}
	.agent-launcher:focus-visible {
		outline: 2px solid var(--link-active-color);
		outline-offset: 3px;
	}
	.agent-launcher.is-dragging {
		cursor: grabbing;
		border-color: var(--link-active-color);
	}
	.agent-launcher[data-dock='right'] {
		transform: translateX(50%);
	}
	.agent-launcher[data-dock='left'] {
		transform: translateX(-50%);
	}
	.agent-launcher[data-dock]:focus-visible,
	.agent-launcher.is-dragging {
		transform: none;
	}
	@media (hover: hover) {
		.agent-launcher[data-dock]:hover {
			transform: none;
		}
	}
	.agent-launcher:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	@media (prefers-reduced-motion: reduce) {
		.agent-launcher {
			transition: none;
		}
	}
</style>
