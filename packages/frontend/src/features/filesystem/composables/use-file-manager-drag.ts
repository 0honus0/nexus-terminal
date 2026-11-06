import { onBeforeUnmount, onDeactivated, onMounted, ref, type Ref } from 'vue';
import type { FilesystemChannel } from '../ports/filesystem-channel';
import type { FilesystemBrowserController } from './useFilesystemBrowser';
import type { RemoteFileEntry } from '../model/filesystem-types';
import { parentOf } from '../model/filesystem-path-rules';

/** One drag owns hover navigation, edge scrolling and global cancellation listeners. */
export function useFileManagerDrag(options: {
	browser: FilesystemBrowserController;
	listScroller: Ref<HTMLElement | null>;
	channel(): FilesystemChannel;
	mobile(): boolean;
	scope(): { capture(): AbortSignal; isCurrent(signal: AbortSignal): boolean };
	enqueueNavigation(work: () => Promise<void>): Promise<void>;
	loadPath(path: string): Promise<void>;
	cursor(path: string): void;
	cancel(): void;
	move(entries: RemoteFileEntry[], destination: string): void;
}) {
	const { browser, listScroller } = options;
	const dragging = ref(false);
	const draggedRemoteEntries = ref<RemoteFileEntry[]>([]);
	const remoteDragTarget = ref<string | null>(null);
	let remoteDragScrollTimer: number | undefined;
	let remoteDragScrollDirection = 0;
	type RemoteDragHover = {
		destination: string;
		element: HTMLElement;
		x: number;
		y: number;
		timer: number | undefined;
	};
	let remoteDragHover: RemoteDragHover | undefined;

	function stopRemoteDragScroll(): void {
		remoteDragScrollDirection = 0;
		if (remoteDragScrollTimer === undefined) return;
		window.clearInterval(remoteDragScrollTimer);
		remoteDragScrollTimer = undefined;
	}

	const updateRemoteDragScroll = (event: DragEvent) => {
		const scroller = listScroller.value;
		if (!scroller || !draggedRemoteEntries.value.length || !remoteDragTarget.value) {
			stopRemoteDragScroll();
			return;
		}
		const rect = scroller.getBoundingClientRect();
		const edge = 48;
		const direction = event.clientY < rect.top + edge ? -1 : event.clientY > rect.bottom - edge ? 1 : 0;
		if (!direction) {
			stopRemoteDragScroll();
			return;
		}
		remoteDragScrollDirection = direction;
		if (remoteDragScrollTimer !== undefined) return;
		remoteDragScrollTimer = window.setInterval(() => {
			const currentScroller = listScroller.value;
			if (!currentScroller || !draggedRemoteEntries.value.length || !remoteDragTarget.value) {
				stopRemoteDragScroll();
				return;
			}
			currentScroller.scrollTop += remoteDragScrollDirection * 12;
		}, 30);
	};

	const remoteDropAllowed = (destination: string) =>
		draggedRemoteEntries.value.length > 0 &&
		draggedRemoteEntries.value.some((entry) => {
			if (entry.path === destination || parentOf(entry.path) === destination) return false;
			return !(entry.metadata.isDirectory && destination.startsWith(`${entry.path}/`));
		});

	const remoteDragNavigationAllowed = (destination: string): boolean =>
		draggedRemoteEntries.value.length > 0 &&
		destination !== browser.path.value &&
		!draggedRemoteEntries.value.some(
			(entry) =>
				entry.path === destination || (entry.metadata.isDirectory && destination.startsWith(`${entry.path}/`)),
		);

	function cancelRemoteDragHover(): void {
		if (remoteDragHover?.timer !== undefined) window.clearTimeout(remoteDragHover.timer);
		remoteDragHover = undefined;
	}

	const scheduleRemoteDragNavigation = (event: DragEvent, destination: string): void => {
		const element = event.currentTarget;
		if (!(element instanceof HTMLElement) || !remoteDragNavigationAllowed(destination) || browser.loading.value) {
			cancelRemoteDragHover();
			return;
		}
		if (remoteDragHover?.destination === destination && remoteDragHover.element === element) {
			remoteDragHover.x = event.clientX;
			remoteDragHover.y = event.clientY;
			return;
		}
		cancelRemoteDragHover();
		const hover: RemoteDragHover = {
			destination,
			element,
			x: event.clientX,
			y: event.clientY,
			timer: undefined,
		};
		const entries = draggedRemoteEntries.value;
		const origin = browser.path.value;
		const permission = options.scope().capture();
		const channel = options.channel();
		remoteDragHover = hover;
		hover.timer = window.setTimeout(() => {
			hover.timer = undefined;
			void options.enqueueNavigation(async () => {
				if (
					remoteDragHover !== hover ||
					draggedRemoteEntries.value !== entries ||
					!options.scope().isCurrent(permission) ||
					options.channel() !== channel ||
					browser.path.value !== origin ||
					browser.loading.value ||
					!remoteDragNavigationAllowed(destination) ||
					!element.isConnected ||
					!element.contains(document.elementFromPoint(hover.x, hover.y))
				)
					return;
				clearRemoteDragTarget();
				browser.clearSearch();
				await options.loadPath(destination);
			});
		}, 600);
	};

	const startRemoteDrag = (event: DragEvent, entry: RemoteFileEntry) => {
		if (options.mobile() || !event.dataTransfer || options.scope().capture().aborted) return;
		endRemoteDrag();
		const selection = browser.visible.value.filter((entry) => browser.selected.value.has(entry.path));
		draggedRemoteEntries.value = browser.selected.value.has(entry.path) && selection.length ? selection : [entry];
		options.cursor(entry.path);
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData(
			'application/x-nexus-remote-files',
			draggedRemoteEntries.value.map((item) => item.path).join('\n'),
		);
	};

	function endRemoteDrag(): void {
		clearRemoteDragTarget();
		draggedRemoteEntries.value = [];
	}

	function cancelRemoteDrag(event: MouseEvent): boolean {
		if (!draggedRemoteEntries.value.length || (event.button !== 2 && !(event.buttons & 2))) return false;
		event.preventDefault();
		event.stopPropagation();
		if (event instanceof DragEvent && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
		endRemoteDrag();
		browser.clearSelection();
		options.cancel();
		return true;
	}

	const handleRemoteTargetDragOver = (event: DragEvent, destination: string) => {
		if (cancelRemoteDrag(event)) return;
		if (!draggedRemoteEntries.value.length) return;
		event.stopPropagation();
		const accepted = remoteDropAllowed(destination) || remoteDragNavigationAllowed(destination);
		if (accepted) event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = accepted ? 'move' : 'none';
		remoteDragTarget.value = accepted ? destination : null;
		scheduleRemoteDragNavigation(event, destination);
		updateRemoteDragScroll(event);
	};

	function clearRemoteDragTarget(event?: DragEvent): void {
		if (event && remoteDragHover && event.currentTarget !== remoteDragHover.element) return;
		// Moving between the icon, label and cells of one row is still the same hover.
		if (
			event?.currentTarget instanceof Node &&
			event.relatedTarget instanceof Node &&
			event.currentTarget.contains(event.relatedTarget)
		)
			return;
		cancelRemoteDragHover();
		remoteDragTarget.value = null;
		stopRemoteDragScroll();
	}

	const dropRemote = (event: DragEvent, destination: string) => {
		if (cancelRemoteDrag(event) || options.scope().capture().aborted) return;
		if (!draggedRemoteEntries.value.length) return;
		event.preventDefault();
		event.stopPropagation();
		const entries = draggedRemoteEntries.value.filter(
			(entry) =>
				entry.path !== destination &&
				parentOf(entry.path) !== destination &&
				!(entry.metadata.isDirectory && destination.startsWith(`${entry.path}/`)),
		);
		endRemoteDrag();
		if (entries.length) options.move(entries, destination);
	};

	const handleDragEnter = (event: DragEvent) => {
		if (draggedRemoteEntries.value.length) return;
		if (event.dataTransfer?.types.includes('Files')) dragging.value = true;
	};

	const handleContainerDragOver = (event: DragEvent) => {
		if (cancelRemoteDrag(event)) return;
		if (draggedRemoteEntries.value.length) {
			cancelRemoteDragHover();
			const allowed = remoteDropAllowed(browser.path.value);
			remoteDragTarget.value = allowed ? browser.path.value : null;
			if (allowed) event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
			updateRemoteDragScroll(event);
			return;
		}
		if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
	};

	const handleDragLeave = (event: DragEvent) => {
		const container = event.currentTarget as HTMLElement;
		const related = event.relatedTarget;
		if (!(related instanceof Node) || !container.contains(related)) {
			dragging.value = false;
			clearRemoteDragTarget();
		}
	};

	onMounted(() => {
		document.addEventListener('dragend', endRemoteDrag);
		document.addEventListener('drop', endRemoteDrag);
		document.addEventListener('contextmenu', cancelRemoteDrag, true);
		document.addEventListener('pointerdown', cancelRemoteDrag, true);
		document.addEventListener('drag', cancelRemoteDrag, true);
		document.addEventListener('dragover', cancelRemoteDrag, true);
		document.addEventListener('drop', cancelRemoteDrag, true);
	});
	onDeactivated(endRemoteDrag);
	onBeforeUnmount(() => {
		endRemoteDrag();
		document.removeEventListener('dragend', endRemoteDrag);
		document.removeEventListener('drop', endRemoteDrag);
		document.removeEventListener('contextmenu', cancelRemoteDrag, true);
		document.removeEventListener('pointerdown', cancelRemoteDrag, true);
		document.removeEventListener('drag', cancelRemoteDrag, true);
		document.removeEventListener('dragover', cancelRemoteDrag, true);
		document.removeEventListener('drop', cancelRemoteDrag, true);
	});
	return {
		dragging,
		draggedRemoteEntries,
		remoteDragTarget,
		startRemoteDrag,
		endRemoteDrag,
		handleRemoteTargetDragOver,
		clearRemoteDragTarget,
		dropRemote,
		handleDragEnter,
		handleContainerDragOver,
		handleDragLeave,
	};
}
