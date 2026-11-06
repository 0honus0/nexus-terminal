import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useDraggablePosition } from '@/foundation/interaction';
import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';

/** Own the progress restore control's persisted position, drag and viewport listeners. */
export function useProgressRestorePosition(options: {
	active(): boolean | undefined;
	mobile(): boolean | undefined;
	visible(): boolean;
	restore(): void;
}) {
	interface ProgressRestorePosition {
		x: number;
		y: number;
	}
	const progressRestorePositionStorage = {
		namespace: 'workspace.progress-restore-position',
		version: 1,
		codec: jsonStorageCodec<ProgressRestorePosition>((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
			const candidate = value as Record<string, unknown>;
			return typeof candidate.x === 'number' &&
				Number.isFinite(candidate.x) &&
				typeof candidate.y === 'number' &&
				Number.isFinite(candidate.y)
				? { x: candidate.x, y: candidate.y }
				: undefined;
		}),
		legacyKeys: ['nexus.transfer-progress-restore-position'],
	} as const;
	const PROGRESS_RESTORE_MARGIN = 8;
	const progressRestoreButton = ref<HTMLElement | null>(null);
	const progressRestorePosition = ref({ x: 0, y: 0 });
	const progressRestorePositionInitialized = ref(false);

	const clampProgressRestorePosition = (candidate: { x: number; y: number }, element: HTMLElement) => ({
		x: Math.max(
			PROGRESS_RESTORE_MARGIN,
			Math.min(
				candidate.x,
				Math.max(PROGRESS_RESTORE_MARGIN, window.innerWidth - element.offsetWidth - PROGRESS_RESTORE_MARGIN),
			),
		),
		y: Math.max(
			PROGRESS_RESTORE_MARGIN,
			Math.min(
				candidate.y,
				Math.max(PROGRESS_RESTORE_MARGIN, window.innerHeight - element.offsetHeight - PROGRESS_RESTORE_MARGIN),
			),
		),
	});

	const saveProgressRestorePosition = (): void => {
		if (options.mobile() || !progressRestorePositionInitialized.value) return;
		writeStoredValue(progressRestorePositionStorage, progressRestorePosition.value);
	};

	const initializeProgressRestorePosition = async (): Promise<void> => {
		if (options.mobile()) return;
		await nextTick();
		if (options.active() === false || !options.visible()) return;
		const element = progressRestoreButton.value;
		if (!element) return;
		if (progressRestorePositionInitialized.value) {
			progressRestorePosition.value = clampProgressRestorePosition(progressRestorePosition.value, element);
			return;
		}

		const rect = element.getBoundingClientRect();
		let next = { x: rect.left, y: rect.top };
		const saved = readStoredValue(progressRestorePositionStorage);
		if (saved) next = saved;
		progressRestorePosition.value = clampProgressRestorePosition(next, element);
		progressRestorePositionInitialized.value = true;
	};

	const clampProgressRestoreToViewport = (): void => {
		progressRestoreDrag.cancelDragging();
		if (options.active() === false || !options.visible()) return;
		const element = progressRestoreButton.value;
		if (!element || !progressRestorePositionInitialized.value) return;
		progressRestorePosition.value = clampProgressRestorePosition(progressRestorePosition.value, element);
	};

	const progressRestoreDrag = useDraggablePosition({
		position: progressRestorePosition,

		getElement: () => progressRestoreButton.value,

		canStart: (event) => options.active() !== false && options.visible() && !options.mobile() && event.button === 0,

		constrain: (candidate, element) => clampProgressRestorePosition(candidate, element),

		onEnd: saveProgressRestorePosition,
	});
	const progressRestoreButtonStyle = computed(() =>
		progressRestorePositionInitialized.value
			? {
					position: 'fixed' as const,
					left: `${progressRestorePosition.value.x}px`,
					top: `${progressRestorePosition.value.y}px`,
				}
			: {
					position: 'absolute' as const,
					right: '3rem',
					bottom: '0.75rem',
				},
	);

	const restoreHiddenProgress = (event: MouseEvent): void => {
		const dragged = progressRestoreDrag.didDrag.value;
		progressRestoreDrag.didDrag.value = false;
		if (dragged && event.detail > 0) return;
		options.restore();
	};

	watch(
		() => [options.active(), options.mobile(), options.visible()] as const,
		([active, mobile, visible]) => {
			if (active === false || mobile || !visible) progressRestoreDrag.cancelDragging();
			else void initializeProgressRestorePosition();
		},
		{ flush: 'sync' },
	);
	onDeactivated(() => progressRestoreDrag.cancelDragging());
	onMounted(() => window.addEventListener('resize', clampProgressRestoreToViewport));
	onBeforeUnmount(() => {
		progressRestoreDrag.cancelDragging();
		window.removeEventListener('resize', clampProgressRestoreToViewport);
	});

	return { progressRestoreButton, progressRestoreDrag, progressRestoreButtonStyle, restoreHiddenProgress };
}
