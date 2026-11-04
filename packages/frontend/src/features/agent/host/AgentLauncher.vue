<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
	import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/vue';
	import { useAgentHostState } from './agent-host-state';
	import AgentTaskNotice from './AgentTaskNotice.vue';
	import type { AgentTaskActivity } from '../model/task-activity-types';

	const props = defineProps<{
		paused?: boolean;
		notice: AgentTaskActivity | null;
		queuedCount: number;
		pendingApprovalCount: number;
		noticeTime: number;
	}>();
	const emit = defineEmits<{
		layoutChange: [];
		noticeDismiss: [];
		noticeHover: [value: boolean];
		noticeFocus: [value: boolean];
	}>();
	const { windowManager: agentWindowManager } = useAgentHostState();

	const position = computed(() => agentWindowManager.state.launcherPosition);
	const dock = computed(() => agentWindowManager.state.launcherDock);

	const launcherElement = ref<HTMLElement | null>(null);
	const noticeElement = ref<HTMLElement | null>(null);
	const { floatingStyles, isPositioned } = useFloating(launcherElement, noticeElement, {
		open: computed(() => props.notice !== null),
		placement: computed(() => (dock.value === 'left' ? 'top-start' : 'top-end')),
		strategy: 'fixed',
		transform: false,
		middleware: [
			offset(12),
			flip({ padding: 12 }),
			shift({ padding: 12 }),
			size({
				padding: 12,

				apply({ availableHeight, availableWidth, elements }): void {
					elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
					elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
				},
			}),
		],
		whileElementsMounted: autoUpdate,
	});

	const DRAG_START_PX = 6;

	let pointerId: number | null = null;
	let originX = 0;
	let originY = 0;
	let startRight = 0;
	let startBottom = 0;
	let startDock: 'left' | 'right' | null = null;
	let hasMoved = false;

	const dragging = ref(false);

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

	function onNoticeFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (
			event.currentTarget instanceof HTMLElement &&
			(!(next instanceof Node) || !event.currentTarget.contains(next))
		) {
			emit('noticeFocus', false);
		}
	}

	function onNoticeFocusIn(event: FocusEvent): void {
		emit('noticeFocus', event.target instanceof HTMLElement && event.target.matches(':focus-visible'));
	}

	onMounted(() => {
		agentWindowManager.clampLauncherPosition();
		window.addEventListener('resize', handleViewportResize);
	});

	onBeforeUnmount(() => {
		window.removeEventListener('resize', handleViewportResize);
		emit('noticeHover', false);
		emit('noticeFocus', false);
	});
</script>

<template>
	<div
		ref="launcherElement"
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

			<span
				v-if="pendingApprovalCount"
				class="absolute top-0 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-background"
				:class="dock === 'right' ? 'left-1' : 'right-0'"
				role="img"
				:aria-label="$t('agent.taskNotice.pendingApprovals', { count: pendingApprovalCount })"
				data-agent-pending-approval
			></span>
		</button>
	</div>
	<Teleport to="body">
		<div
			v-if="notice"
			ref="noticeElement"
			class="agent-task-notice ui-surface ui-glass-panel"
			:style="[floatingStyles, { visibility: isPositioned ? 'visible' : 'hidden' }]"
			role="dialog"
			:aria-label="$t('agent.taskNotice.title')"
			@keydown.esc.stop.prevent="emit('noticeDismiss')"
			@pointerenter="emit('noticeHover', $event.pointerType !== 'touch')"
			@pointerleave="emit('noticeHover', false)"
			@focusin="onNoticeFocusIn"
			@focusout="onNoticeFocusOut"
		>
			<AgentTaskNotice
				:activity="notice"
				:queued-count="queuedCount"
				:now="noticeTime"
				@dismiss="emit('noticeDismiss')"
			/>
		</div>
	</Teleport>
</template>

<style scoped>
	.agent-task-notice {
		z-index: 31;
		width: min(328px, calc(100vw - 24px));
		max-height: calc(100dvh - 24px);
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--color-border);
		border-radius: 18px;
		box-shadow:
			var(--ui-glass-highlight),
			0 12px 40px rgb(0 0 0 / 16%);
		outline: none;
		animation: task-notice-enter 160ms ease-out;
	}
	@keyframes task-notice-enter {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

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
		.agent-task-notice {
			animation: none;
		}
		.agent-launcher {
			transition: none;
		}
	}
</style>
