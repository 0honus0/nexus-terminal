<script setup lang="ts">
	import { createReusableTemplate, useEventListener, useResizeObserver } from '@vueuse/core';
	import { computed, nextTick, onBeforeUnmount, onActivated, onDeactivated, ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiInput,
		UiInfoHint,
		UiNumberInput,
		UiOverlayPanel,
		UiPopover,
		UiResizeHandle,
		UiSpinner,
		type UiTone,
	} from '@/foundation/ui';
	import { readStoredValue, stringStorageCodec, useDeviceCapabilities, writeStoredValue } from '@/foundation/browser';
	import { useDraggablePosition, useResizeHandle } from '@/foundation/interaction';
	import { remoteDesktopApi } from '../api/remote-desktop-api';
	import { createBrowserDesktop } from '../adapters/browser-desktop';
	import { createRemoteDesktopController } from '../model/remote-desktop-controller';
	import type {
		RemoteDesktopConnection,
		RemoteDesktopCertificate,
		RemoteDesktopDisplay,
		RemoteDesktopState,
		RemoteTouchMode,
	} from '../model/remote-desktop-types';
	import {
		REMOTE_DESKTOP_MIN_DIMENSION,
		REMOTE_DESKTOP_MAX_DIMENSION,
		REMOTE_DESKTOP_MIN_DPI,
		REMOTE_DESKTOP_MAX_DPI,
	} from '@nexus-terminal/shared/remote/desktop/values';
	import { registerAuthenticatedSessionOwner } from '@/shared/session/public';
	import RdpFileClipboard from './RdpFileClipboard.vue';
	import RdpCertificateDialog from './RdpCertificateDialog.vue';

	const touchModeStorage = {
		namespace: 'remote-desktop.touch-mode',
		version: 1,
		codec: stringStorageCodec((value) => value === 'touchpad' || value === 'direct'),
		legacyKeys: ['nexus.rdp.touch-mode'],
	} as const;

	const readTouchMode = (): RemoteTouchMode =>
		readStoredValue(touchModeStorage) === 'touchpad' ? 'touchpad' : 'direct';

	const props = withDefaults(
		defineProps<{
			visible: boolean;
			connection: RemoteDesktopConnection | null;
			width?: number;
			height?: number;
			dpi?: number;
			sizeSaving?: boolean;
		}>(),
		{
			width: 1064,
			height: 858,
			sizeSaving: false,
		},
	);
	const emit = defineEmits<{
		close: [];
		sizeChange: [size: { width: number; height: number }];
		connected: [connectionId: number];
	}>();
	const { t } = useI18n();
	const device = useDeviceCapabilities();
	const [DefineWindowActions, WindowActions] = createReusableTemplate();
	const [DefineSizeControls, SizeControls] = createReusableTemplate();
	const [DefineReconnectControl, ReconnectControl] = createReusableTemplate();
	const [DefineTouchControls, TouchControls] = createReusableTemplate();
	const panel = ref<HTMLElement | null>(null);
	const display = ref<HTMLElement | null>(null);
	const mobileKeyboardInput = ref<HTMLTextAreaElement | null>(null);
	const mobileKeyboardFocused = ref(false);
	const state = ref<RemoteDesktopState>('idle');
	const stateLabel = computed(() => t(`remoteDesktopModal.status.${state.value}`));
	const windowTitle = computed(() =>
		props.connection?.type === 'VNC' ? t('vncModal.title') : t('remoteDesktopModal.title'),
	);
	const connectionLabel = computed(() => props.connection?.name || t('remoteDesktopModal.titlePlaceholder'));
	const stateTone = computed<UiTone>(() => {
		if (state.value === 'connected') return 'success';
		if (state.value === 'connecting') return 'warning';
		if (state.value === 'error') return 'danger';
		return 'neutral';
	});
	const message = ref('');
	const fullscreen = ref(false);
	const minimized = ref(false);
	const modalWidth = ref(props.width);
	const modalHeight = ref(props.height);
	const restoreAnchor = ref<HTMLElement | null>(null);
	const restoreDock = ref<'left' | 'right' | null>(null);
	const dockedRestore = computed(() => (props.connection?.type === 'RDP' ? restoreDock.value : null));

	const readViewport = () => {
		const root = document.documentElement;
		const visual = window.visualViewport;
		const left = Math.max(0, visual?.offsetLeft ?? 0);
		const top = Math.max(0, visual?.offsetTop ?? 0);
		// Chromium can include the stable scrollbar gutter in both clientWidth and visualViewport.width.
		const layoutWidth = Math.min(root.clientWidth, root.getBoundingClientRect().width);
		return {
			left,
			top,
			width: Math.max(0, Math.min(layoutWidth, left + (visual?.width ?? window.innerWidth)) - left),
			height: Math.max(0, Math.min(root.clientHeight, top + (visual?.height ?? window.innerHeight)) - top),
		};
	};

	const viewport = shallowRef(readViewport());
	const overlayViewportStyle = computed(() => ({
		left: `${viewport.value.left}px`,
		top: `${viewport.value.top}px`,
		width: `${viewport.value.width}px`,
		height: `${viewport.value.height}px`,
		right: 'auto',
		bottom: 'auto',
	}));
	const restorePosition = ref({ x: 16, y: Math.max(16, viewport.value.height / 2 - 25) });
	const touchMode = ref<RemoteTouchMode>(readTouchMode());
	const vncText = ref('');
	const vncTextFocused = ref(false);
	const fileClipboardOpen = ref(false);
	const sizeControlsOpen = ref(false);
	const touchControlsOpen = ref(false);
	const toolsOpen = ref(false);
	const floatingTools = computed(() => props.connection?.type === 'RDP' && !fullscreen.value);
	const compactTools = computed(() => floatingTools.value && modalWidth.value < 900);
	const toolbarDensity = computed(() => (floatingTools.value && device.hasTouch.value ? 'default' : 'compact'));
	const toolsPanelOpen = computed(() => fileClipboardOpen.value || sizeControlsOpen.value || touchControlsOpen.value);
	const touchHint = computed(() =>
		t(touchMode.value === 'direct' ? 'remoteDesktopModal.touchHintDirect' : 'remoteDesktopModal.touchHintTouchpad'),
	);

	const revealTools = async (event: MouseEvent) => {
		toolsOpen.value = true;
		if (event.detail === 0) {
			await nextTick();
			if (!active || !props.visible || !floatingTools.value || !toolsOpen.value) return;
			panel.value
				?.querySelector<HTMLElement>(
					'[data-desktop-chrome] input:not(:disabled), [data-desktop-chrome] button:not(:disabled)',
				)
				?.focus();
		}
	};

	const leaveTools = (event: PointerEvent) => {
		if (event.pointerType === 'mouse') toolsOpen.value = false;
	};

	const leaveToolsOnDesktop = (event: PointerEvent) => {
		if (
			event.pointerType === 'mouse' &&
			event.target instanceof Element &&
			!event.target.closest('[data-desktop-chrome], [data-desktop-edge]')
		) {
			toolsOpen.value = false;
		}
	};

	const hideToolsOnDesktop = (event: PointerEvent) => {
		if (!(event.target instanceof Element) || event.target.closest('[data-desktop-chrome], [data-desktop-edge]'))
			return;
		toolsOpen.value = false;
		sizeControlsOpen.value = false;
		touchControlsOpen.value = false;
		if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-desktop-chrome]')) {
			document.activeElement.blur();
		}
	};

	let resizeObserver: ReturnType<typeof useResizeObserver> | undefined;
	let resizeAnimationFrame: number | undefined;
	let mobileInputComposing = false;
	let active = true;
	let viewRevision = 0;
	const certificateChallenge = ref<RemoteDesktopCertificate | null>(null);
	let completeCertificate: ((choice: { remember: boolean } | null) => void) | null = null;

	const chooseCertificate = (choice: { remember: boolean } | null) => completeCertificate?.(choice);

	const controller = createRemoteDesktopController({
		api: remoteDesktopApi,
		createPeer: createBrowserDesktop,

		confirmCertificate(certificate, signal) {
			if (signal.aborted) return Promise.resolve(null);
			completeCertificate?.(null);
			return new Promise((resolve) => {
				const finish = (choice: { remember: boolean } | null) => {
					signal.removeEventListener('abort', cancel);
					certificateChallenge.value = null;
					completeCertificate = null;
					resolve(choice);
				};

				const cancel = () => finish(null);

				completeCertificate = finish;
				certificateChallenge.value = certificate;
				signal.addEventListener('abort', cancel, { once: true });
				if (signal.aborted) cancel();
			});
		},

		onState(next, failure) {
			state.value = next;
			message.value = failure
				? t('remoteDesktopModal.failures.' + failure.code) +
					(failure.outcome === 'unknown' ? ' ' + t('remoteDesktopModal.unknownOutcome') : '')
				: t('remoteDesktopModal.status.' + next);
			if (next === 'connected') void nextTick(sendSize);
			if (next === 'disconnected' || next === 'error') {
				resizeObserver?.stop();
				resizeObserver = undefined;
				cancelScheduledSize();
				hideMobileKeyboard();
			}
		},

		onConnected(id) {
			emit('connected', id);
		},
	});
	const unregisterSession = registerAuthenticatedSessionOwner('remote-desktop-modal', (event) => {
		if (event.type !== 'attach') {
			active = false;
			disconnect();
		}
	});

	const protocolMinWidth = () => (props.connection?.type === 'VNC' ? 800 : 640);

	const protocolMinHeight = () => (props.connection?.type === 'VNC' ? 600 : 480);

	const maxPanelWidth = () => Math.max(0, viewport.value.width - 32);

	const maxPanelHeight = () => Math.max(0, viewport.value.height - 32);

	const minPanelWidth = () => Math.min(protocolMinWidth(), maxPanelWidth());

	const minPanelHeight = () => Math.min(protocolMinHeight(), maxPanelHeight());

	const clampSize = () => {
		modalWidth.value = Math.min(Math.max(minPanelWidth(), modalWidth.value), maxPanelWidth());
		modalHeight.value = Math.min(Math.max(minPanelHeight(), modalHeight.value), maxPanelHeight());
	};

	const modalPanelStyle = computed(() =>
		fullscreen.value
			? { position: 'fixed' as const, inset: '0', width: '100vw', height: '100vh', boxShadow: 'none' }
			: { width: `${modalWidth.value}px`, height: `${modalHeight.value}px` },
	);

	const currentDisplay = (): RemoteDesktopDisplay => {
		const width = Math.min(
			REMOTE_DESKTOP_MAX_DIMENSION,
			Math.max(REMOTE_DESKTOP_MIN_DIMENSION, Math.round(display.value?.clientWidth || modalWidth.value)),
		);
		return {
			width,
			height: Math.min(
				REMOTE_DESKTOP_MAX_DIMENSION,
				Math.max(REMOTE_DESKTOP_MIN_DIMENSION, Math.round(display.value?.clientHeight || modalHeight.value)),
			),
			dpi: Math.min(
				REMOTE_DESKTOP_MAX_DPI,
				Math.max(
					REMOTE_DESKTOP_MIN_DPI,
					Math.round(props.dpi ?? (props.connection?.type === 'RDP' && width > 1920 ? 120 : 96)),
				),
			),
		};
	};

	const cancelScheduledSize = () => {
		if (resizeAnimationFrame === undefined) return;
		window.cancelAnimationFrame(resizeAnimationFrame);
		resizeAnimationFrame = undefined;
	};

	const sendSize = () => {
		cancelScheduledSize();
		resizeAnimationFrame = window.requestAnimationFrame(() => {
			resizeAnimationFrame = undefined;
			if (!controller.peer || state.value !== 'connected' || minimized.value || !props.visible) return;
			const size = currentDisplay();
			if (size.width > 0 && size.height > 0) controller.peer.resize(size);
		});
	};

	const focusMobileKeyboard = () => {
		if (!device.hasTouch.value || !mobileKeyboardInput.value || state.value !== 'connected') return;
		void controller.peer?.syncClipboard();
		mobileKeyboardInput.value.value = '';
		mobileKeyboardInput.value.focus({ preventScroll: true });
		mobileKeyboardInput.value.click();
		mobileKeyboardInput.value.select();
	};

	const hideMobileKeyboard = () => {
		mobileKeyboardInput.value?.blur();
		mobileKeyboardFocused.value = false;
	};

	const toggleMobileKeyboard = () => {
		if (mobileKeyboardFocused.value) hideMobileKeyboard();
		else focusMobileKeyboard();
	};

	const setTouchMode = (mode: RemoteTouchMode) => {
		touchMode.value = mode;
		writeStoredValue(touchModeStorage, mode);
		controller.peer?.setTouchMode(mode);
	};

	const disconnect = () => {
		cancelWindowGestures();
		fileClipboardOpen.value = false;
		sizeControlsOpen.value = false;
		touchControlsOpen.value = false;
		toolsOpen.value = false;
		viewRevision += 1;
		vncText.value = '';
		vncTextFocused.value = false;
		if (mobileKeyboardInput.value) mobileKeyboardInput.value.value = '';
		controller.close();
		resizeObserver?.stop();
		resizeObserver = undefined;
		cancelScheduledSize();
		hideMobileKeyboard();
	};

	const connect = async () => {
		if (!active || !props.visible || !props.connection || !display.value || state.value === 'connecting') return;
		viewRevision += 1;
		const target = { id: props.connection.id, name: props.connection.name, type: props.connection.type };
		const host = display.value;
		await controller.connect(
			target,
			currentDisplay(),
			{
				hasTouch: device.hasTouch.value,
				touchMode: touchMode.value,
				mobileInput: mobileKeyboardInput.value,
			},
			host,
		);
		if (
			controller.peer &&
			active &&
			props.visible &&
			props.connection?.id === target.id &&
			props.connection.type === target.type
		) {
			resizeObserver?.stop();
			resizeObserver = useResizeObserver(host, sendSize);
		}
	};

	const resize = useResizeHandle({
		width: modalWidth,
		height: modalHeight,
		minWidth: minPanelWidth,
		minHeight: minPanelHeight,
		maxWidth: maxPanelWidth,
		maxHeight: maxPanelHeight,
		// UiOverlayPanel keeps this surface centered while its size changes. Without the
		// 2x compensation the visible bottom-right corner only follows half of the
		// pointer movement because both opposite edges move around the fixed center.
		widthMultiplier: 2,
		heightMultiplier: 2,
		onMove: sendSize,

		onEnd: (size) => {
			emit('sizeChange', size);
			sendSize();
		},
	});

	const constrainRestorePosition = (position: { x: number; y: number }, element: HTMLElement) => ({
		x: Math.max(
			viewport.value.left,
			Math.min(position.x, viewport.value.left + viewport.value.width - element.offsetWidth),
		),
		y: Math.max(
			viewport.value.top,
			Math.min(position.y, viewport.value.top + viewport.value.height - element.offsetHeight),
		),
	});

	const restoreDrag = useDraggablePosition({
		position: restorePosition,

		getElement: () => restoreAnchor.value,

		constrain: constrainRestorePosition,

		onMove: () => {
			restoreDock.value = null;
		},

		onEnd: () => dockRestoreButton(),

		onTap: (event) => {
			// Touch browsers can omit the synthesized click after a docked drag.
			// Only a completed tap restores; cancel and actual dragging never do.
			if (event.pointerType !== 'mouse') restore();
		},
	});

	function dockRestoreButton(): void {
		const anchor = restoreAnchor.value;
		if (!minimized.value || props.connection?.type !== 'RDP' || !anchor) return;
		const left = restorePosition.value.x - viewport.value.left;
		const right = viewport.value.width - anchor.offsetWidth - left;
		restoreDock.value ??= left <= right ? 'left' : 'right';
		restorePosition.value = {
			x:
				restoreDock.value === 'left'
					? viewport.value.left
					: Math.max(viewport.value.left, viewport.value.left + viewport.value.width - anchor.offsetWidth),
			y: restorePosition.value.y,
		};
	}

	function cancelWindowGestures(): void {
		resize.cancelResize();
		restoreDrag.cancelDragging();
	}

	const fitWindowToViewport = () => {
		if (!active || !props.visible) return;
		cancelWindowGestures();
		viewport.value = readViewport();
		if (!fullscreen.value) clampSize();
		if (restoreAnchor.value) {
			restorePosition.value = constrainRestorePosition(restorePosition.value, restoreAnchor.value);
			dockRestoreButton();
		}
		sendSize();
	};

	useEventListener(window, 'resize', fitWindowToViewport);
	useEventListener(window.visualViewport, 'resize', fitWindowToViewport);
	useEventListener(window.visualViewport, 'scroll', fitWindowToViewport);
	useResizeObserver(document.documentElement, () => {
		const next = readViewport();
		const current = viewport.value;
		if (
			next.left !== current.left ||
			next.top !== current.top ||
			next.width !== current.width ||
			next.height !== current.height
		) {
			fitWindowToViewport();
		}
	});
	useEventListener(window, 'blur', cancelWindowGestures);
	useEventListener(document, 'visibilitychange', () => {
		if (document.hidden) cancelWindowGestures();
		else fitWindowToViewport();
	});
	watch(minimized, () => void nextTick(fitWindowToViewport));

	const minimize = () => {
		if (fullscreen.value) return;
		sizeControlsOpen.value = false;
		touchControlsOpen.value = false;
		hideMobileKeyboard();
		minimized.value = true;
	};

	const restore = () => {
		minimized.value = false;
		void nextTick(sendSize);
	};

	const handleRestoreClick = (event: MouseEvent) => {
		const dragged = restoreDrag.didDrag.value;
		restoreDrag.didDrag.value = false;
		if (dragged && event.detail > 0) return;
		restore();
	};

	const commitSize = (dimension: 'width' | 'height', event: Event) => {
		// Keep partial edits inside the input: resizing on every digit can switch
		// the toolbar layout and unmount the focused control before editing ends.
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) return;
		const value = input.valueAsNumber;
		if (Number.isFinite(value)) {
			if (dimension === 'width') modalWidth.value = value;
			else modalHeight.value = value;
		}
		clampSize();
		input.value = String(dimension === 'width' ? modalWidth.value : modalHeight.value);
		emit('sizeChange', { width: modalWidth.value, height: modalHeight.value });
		void nextTick(sendSize);
	};

	const exitFullscreen = async () => {
		if (!panel.value || document.fullscreenElement !== panel.value) return;
		try {
			await document.exitFullscreen();
		} catch {
			if (active) message.value = t('remoteDesktopModal.fullscreenFailed');
		}
	};

	const toggleFullscreen = async () => {
		if (!panel.value) return;
		try {
			if (document.fullscreenElement === panel.value) await document.exitFullscreen();
			else await panel.value.requestFullscreen();
		} catch {
			message.value = t('remoteDesktopModal.fullscreenFailed');
		}
	};

	const onFullscreen = () => {
		fullscreen.value = Boolean(panel.value && document.fullscreenElement === panel.value);
		void nextTick(fitWindowToViewport);
	};

	const handleFullscreenKeydown = (event: KeyboardEvent) => {
		if (toolsPanelOpen.value || certificateChallenge.value) return;
		if (
			event.key === 'Escape' &&
			floatingTools.value &&
			document.activeElement instanceof HTMLElement &&
			document.activeElement.closest('[data-desktop-chrome]')
		) {
			document.activeElement.blur();
			toolsOpen.value = false;
			void nextTick(() => {
				if (active && props.visible) panel.value?.querySelector<HTMLElement>('[data-desktop-edge]')?.focus();
			});
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key !== 'Escape' || !fullscreen.value || document.fullscreenElement !== panel.value) return;
		void exitFullscreen();
	};

	const closeModal = async () => {
		disconnect();
		const originalPanel = panel.value;
		const revision = viewRevision;
		await exitFullscreen();
		if (panel.value !== originalPanel || !active || revision !== viewRevision) return;
		fullscreen.value = false;
		minimized.value = false;
		vncText.value = '';
		vncTextFocused.value = false;
		disconnect();
		emit('close');
	};

	const beginMobileComposition = () => {
		mobileInputComposing = true;
	};

	const clearMobileInput = (event?: Event) => {
		if (mobileInputComposing || (event instanceof InputEvent && event.isComposing)) return;
		queueMicrotask(() => {
			if (active && mobileKeyboardInput.value && !mobileInputComposing) mobileKeyboardInput.value.value = '';
		});
	};

	const endMobileComposition = () => {
		mobileInputComposing = false;
		clearMobileInput();
	};

	const sendVncText = (): void => {
		if (props.connection?.type !== 'VNC' || state.value !== 'connected') return;
		try {
			controller.peer?.sendText(vncText.value);
		} catch {
			message.value = t('remoteDesktopModal.failures.input_failed');
		}
	};

	const releaseVncTextFocus = () => {
		vncTextFocused.value = false;
		if (state.value === 'connected') controller.peer?.focus();
	};

	watch(vncTextFocused, (value) => controller.peer?.setTextInputActive(value), { flush: 'sync' });
	onActivated(() => {
		active = true;
		fitWindowToViewport();
	});
	onDeactivated(() => {
		active = false;
		disconnect();
		void exitFullscreen();
		fullscreen.value = false;
		minimized.value = false;
	});
	document.addEventListener('fullscreenchange', onFullscreen);
	window.addEventListener('keydown', handleFullscreenKeydown, true);
	watch(
		() => [props.width, props.height] as const,
		([width, height]) => {
			if (!resize.isResizing.value) {
				modalWidth.value = width;
				modalHeight.value = height;
				clampSize();
			}
		},
	);
	watch(
		() => [props.visible, props.connection?.id, props.connection?.type] as const,
		([visible, connectionId, protocol], previous) => {
			if (visible && active) {
				fullscreen.value = Boolean(panel.value && document.fullscreenElement === panel.value);
				const changedConnection = previous?.[1] !== connectionId || previous?.[2] !== protocol;
				if (!previous?.[0] || changedConnection) {
					minimized.value = false;
					vncText.value = '';
					vncTextFocused.value = false;
					if (changedConnection) disconnect();
				}
				fitWindowToViewport();
				void nextTick(connect);
			} else {
				minimized.value = false;
				vncText.value = '';
				vncTextFocused.value = false;
				void exitFullscreen();
				fullscreen.value = false;
				disconnect();
			}
		},
		{ immediate: true },
	);
	onBeforeUnmount(() => {
		active = false;
		unregisterSession();
		document.removeEventListener('fullscreenchange', onFullscreen);
		window.removeEventListener('keydown', handleFullscreenKeydown, true);
		void exitFullscreen();
		disconnect();
	});
	watch(
		() => [props.visible, props.connection?.id, floatingTools.value, compactTools.value] as const,
		() => {
			sizeControlsOpen.value = false;
			touchControlsOpen.value = false;
		},
	);
</script>

<template>
	<DefineWindowActions>
		<UiButton
			type="button"
			appearance="ghost"
			:density="toolbarDensity"
			icon-only
			:title="fullscreen ? t('common.exitFullscreen') : t('common.fullscreen')"
			:aria-label="fullscreen ? t('common.exitFullscreen') : t('common.fullscreen')"
			@click="toggleFullscreen"
		>
			<i :class="fullscreen ? 'fas fa-compress fa-sm' : 'fas fa-expand fa-sm'" aria-hidden="true"></i>
		</UiButton>
		<UiButton
			type="button"
			appearance="ghost"
			:density="toolbarDensity"
			icon-only
			:title="t('common.minimize')"
			:aria-label="t('common.minimize')"
			@click="minimize"
		>
			<i class="fas fa-window-minimize fa-sm" aria-hidden="true"></i>
		</UiButton>
		<UiButton
			type="button"
			appearance="ghost"
			:density="toolbarDensity"
			icon-only
			:title="t('common.close')"
			:aria-label="t('common.close')"
			@click="closeModal"
		>
			<i class="fas fa-times fa-lg" aria-hidden="true"></i>
		</UiButton>
	</DefineWindowActions>
	<DefineReconnectControl>
		<UiButton
			type="button"
			appearance="solid"
			tone="primary"
			:density="floatingTools ? toolbarDensity : 'default'"
			:icon-only="compactTools"
			class="shrink-0 whitespace-nowrap"
			:disabled="state === 'connecting'"
			:aria-label="t('common.reconnect')"
			:title="t('remoteDesktopModal.reconnectTooltip')"
			@click="connect"
		>
			<i v-if="floatingTools" class="fas fa-rotate-right" aria-hidden="true"></i>
			<span v-if="!compactTools">{{ t('common.reconnect') }}</span>
		</UiButton>
	</DefineReconnectControl>
	<DefineSizeControls>
		<div
			class="remote-desktop-size-controls flex min-w-0 shrink-0 items-center gap-y-1"
			:class="
				floatingTools
					? 'gap-x-2'
					: device.isMobile.value
						? 'ml-0 w-full flex-nowrap justify-end gap-x-1.5 border-t border-border/60 pt-2'
						: 'ml-auto flex-wrap gap-x-2'
			"
		>
			<div class="remote-desktop-dimension" :class="{ 'remote-desktop-dimension-group': floatingTools }">
				<label
					:for="connection?.type === 'VNC' ? 'vnc-modal-width' : 'rdp-modal-width'"
					class="shrink-0 whitespace-nowrap text-xs"
				>
					{{ t('common.width') }}:
				</label>
				<div class="min-w-0 w-20" :class="device.isMobile.value && !floatingTools ? 'flex-1 max-w-20' : ''">
					<UiNumberInput
						:id="connection?.type === 'VNC' ? 'vnc-modal-width' : 'rdp-modal-width'"
						:model-value="modalWidth"
						:disabled="sizeSaving"
						density="compact"
						:min="minPanelWidth()"
						:max="maxPanelWidth()"
						step="10"
						:aria-label="t('common.width')"
						@change="commitSize('width', $event)"
					/>
				</div>
			</div>
			<div class="remote-desktop-dimension" :class="{ 'remote-desktop-dimension-group': floatingTools }">
				<label
					:for="connection?.type === 'VNC' ? 'vnc-modal-height' : 'rdp-modal-height'"
					class="shrink-0 whitespace-nowrap text-xs"
				>
					{{ t('common.height') }}:
				</label>
				<div class="min-w-0 w-20" :class="device.isMobile.value && !floatingTools ? 'flex-1 max-w-20' : ''">
					<UiNumberInput
						:id="connection?.type === 'VNC' ? 'vnc-modal-height' : 'rdp-modal-height'"
						:model-value="modalHeight"
						:disabled="sizeSaving"
						density="compact"
						:min="minPanelHeight()"
						:max="maxPanelHeight()"
						step="10"
						:aria-label="t('common.height')"
						@change="commitSize('height', $event)"
					/>
				</div>
			</div>
			<ReconnectControl v-if="!floatingTools" />
		</div>
	</DefineSizeControls>
	<DefineTouchControls>
		<div
			v-if="device.hasTouch.value"
			class="flex min-w-0 flex-col gap-1"
			:class="device.isMobile.value ? 'w-full' : ''"
		>
			<div
				class="flex gap-1.5"
				:class="
					floatingTools
						? 'flex-col items-stretch'
						: ['items-center', { 'w-full justify-between': device.isMobile.value }]
				"
			>
				<div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
					<span class="text-[11px] text-text-muted">{{ t('remoteDesktopModal.touchModeLabel') }}</span>
					<UiInfoHint
						v-if="device.isMobile.value && !floatingTools"
						:label="t('remoteDesktopModal.touchGuide')"
						:text="touchHint"
						trigger="click"
						align="start"
					/>
				</div>
				<div
					class="inline-flex shrink-0 overflow-hidden rounded border border-border"
					role="group"
					:aria-label="t('remoteDesktopModal.touchModeLabel')"
				>
					<button
						type="button"
						class="relative z-10 min-h-8 px-2 py-1 text-[11px] transition-colors"
						:class="[
							floatingTools && 'flex-1 whitespace-nowrap',
							touchMode === 'direct'
								? 'bg-primary text-white'
								: 'bg-background text-foreground hover:bg-hover',
						]"
						:aria-pressed="touchMode === 'direct'"
						:title="t('remoteDesktopModal.touchHintDirect')"
						@click="setTouchMode('direct')"
					>
						<i class="fas fa-hand-pointer mr-1" aria-hidden="true"></i
						>{{ t('remoteDesktopModal.touchModeDirect') }}
					</button>
					<button
						type="button"
						class="relative z-10 min-h-8 border-l border-border px-2 py-1 text-[11px] transition-colors"
						:class="[
							floatingTools && 'flex-1 whitespace-nowrap',
							touchMode === 'touchpad'
								? 'bg-primary text-white'
								: 'bg-background text-foreground hover:bg-hover',
						]"
						:aria-pressed="touchMode === 'touchpad'"
						:title="t('remoteDesktopModal.touchHintTouchpad')"
						@click="setTouchMode('touchpad')"
					>
						<i class="fas fa-arrows-up-down-left-right mr-1" aria-hidden="true"></i
						>{{ t('remoteDesktopModal.touchModeTouchpad') }}
					</button>
				</div>
			</div>
			<span
				v-if="floatingTools || !device.isMobile.value"
				class="text-[11px] text-text-muted"
				:class="floatingTools ? 'leading-relaxed' : 'leading-tight'"
			>
				{{ touchHint }}
			</span>
		</div>
	</DefineTouchControls>

	<Teleport to="body">
		<div
			v-if="visible && minimized"
			ref="restoreAnchor"
			class="fixed z-[100] h-[50px] w-[50px]"
			:class="{ 'overflow-hidden': dockedRestore !== null }"
			:style="{ left: `${restorePosition.x}px`, top: `${restorePosition.y}px` }"
		>
			<button
				type="button"
				class="remote-desktop-restore flex h-full w-full touch-none select-none cursor-grab items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50 active:cursor-grabbing"
				:class="{ 'is-dragging': restoreDrag.dragging.value }"
				:data-dock="dockedRestore"
				:title="t('remoteDesktopModal.restoreWindow')"
				@pointerdown="restoreDrag.startDragging"
				@click="handleRestoreClick"
			>
				<i class="fas fa-window-restore fa-lg" aria-hidden="true"></i>
			</button>
		</div>
	</Teleport>

	<UiOverlayPanel
		:visible="visible && !minimized"
		:keep-mounted="true"
		teleport
		:surface="false"
		:close-on-backdrop="false"
		:style="overlayViewportStyle"
	>
		<div
			ref="panel"
			role="dialog"
			aria-modal="true"
			:aria-label="connection?.name || windowTitle"
			:style="modalPanelStyle"
			class="remote-desktop-panel pointer-events-auto relative flex min-h-0 max-w-full flex-col overflow-hidden text-foreground"
			:class="
				fullscreen
					? 'remote-desktop-panel-fullscreen rounded-none border-0 bg-black shadow-none'
					: ['ui-glass-panel rounded-lg', { 'remote-desktop-panel-floating-tools': floatingTools }]
			"
			@pointerdown.capture="hideToolsOnDesktop"
			@pointermove="leaveToolsOnDesktop"
			@pointerleave="leaveTools"
		>
			<button
				v-if="floatingTools && state === 'connected' && !toolsOpen && !toolsPanelOpen"
				type="button"
				data-desktop-edge="top"
				class="remote-desktop-edge remote-desktop-edge-top"
				:aria-label="t('remoteDesktopModal.showWindowControls')"
				aria-expanded="false"
				@pointerenter="$event.pointerType === 'mouse' && (toolsOpen = true)"
				@click="revealTools($event)"
			>
				<span aria-hidden="true"></span>
			</button>
			<div
				class="remote-desktop-chrome"
				data-desktop-chrome
				:class="{
					'remote-desktop-tools-revealed': toolsOpen || toolsPanelOpen || state !== 'connected',
					'remote-desktop-tools-dialog': fileClipboardOpen,
				}"
				@pointerenter="toolsOpen = true"
				@pointerleave="leaveTools"
			>
				<header
					v-if="!fullscreen"
					class="remote-desktop-header flex shrink-0 items-center justify-between border-b border-border p-3"
				>
					<h3 class="min-w-0 truncate text-base font-semibold" :title="`${windowTitle} - ${connectionLabel}`">
						<i
							:class="connection?.type === 'VNC' ? 'fas fa-plug' : 'fas fa-desktop'"
							class="mr-2 text-text-secondary"
							aria-hidden="true"
						></i>
						{{ floatingTools ? connectionLabel : `${windowTitle} - ${connectionLabel}` }}
					</h3>
					<div class="ml-2 flex shrink-0 items-center space-x-1">
						<UiBadge
							appearance="soft"
							density="compact"
							:tone="stateTone"
							:class="{ 'sr-only': compactTools }"
							>{{ stateLabel }}</UiBadge
						>
						<span
							v-if="compactTools"
							class="remote-desktop-state-dot"
							:data-state="state"
							:title="stateLabel"
							aria-hidden="true"
						></span>
						<WindowActions v-if="!floatingTools" />
					</div>
				</header>
				<template v-if="floatingTools">
					<div class="remote-desktop-actions flex shrink-0 items-center gap-1 text-xs text-text-secondary">
						<UiPopover
							v-if="compactTools"
							v-model:open="sizeControlsOpen"
							:ariaLabel="t('remoteDesktopModal.windowSize')"
							:density="toolbarDensity"
							icon-only
							boundary-selector=".remote-desktop-panel"
							panel-class="p-3"
						>
							<template #trigger><i class="fas fa-ruler-combined" aria-hidden="true"></i></template>
							<template #panel>
								<div class="remote-desktop-size-popover">
									<p class="mb-3 text-xs font-medium">{{ t('remoteDesktopModal.windowSize') }}</p>
									<SizeControls />
								</div>
							</template>
						</UiPopover>
						<SizeControls v-else />
						<ReconnectControl />
						<RdpFileClipboard
							v-model:open="fileClipboardOpen"
							:icon-only="compactTools"
							:density="toolbarDensity"
							:clipboard="controller.peer?.fileClipboard ?? null"
							:enabled="state === 'connected'"
						/>
						<UiPopover
							v-if="device.hasTouch.value"
							v-model:open="touchControlsOpen"
							:ariaLabel="t('remoteDesktopModal.touchModeLabel')"
							:title="
								t(
									touchMode === 'direct'
										? 'remoteDesktopModal.touchModeDirect'
										: 'remoteDesktopModal.touchModeTouchpad',
								)
							"
							:density="toolbarDensity"
							icon-only
							boundary-selector=".remote-desktop-panel"
							panel-class="w-64 max-w-[calc(100vw-2rem)] p-3"
						>
							<template #trigger>
								<i
									:class="
										touchMode === 'direct'
											? 'fas fa-hand-pointer'
											: 'fas fa-arrows-up-down-left-right'
									"
									aria-hidden="true"
								></i>
							</template>
							<template #panel><TouchControls /></template>
						</UiPopover>
						<div class="flex shrink-0 items-center space-x-1">
							<WindowActions />
						</div>
					</div>
				</template>
				<footer
					v-else-if="!fullscreen"
					class="remote-desktop-footer flex shrink-0 gap-2 border-t border-border bg-header p-2 text-xs text-text-secondary"
					:class="device.isMobile.value ? 'flex-col items-stretch' : 'flex-wrap items-center justify-between'"
				>
					<div
						class="flex min-w-0 items-center gap-2"
						:class="device.isMobile.value ? 'w-full flex-none flex-col items-stretch' : 'flex-1 flex-wrap'"
					>
						<TouchControls />

						<div v-if="connection?.type === 'VNC'" class="flex min-w-[12rem] flex-1 items-center space-x-2">
							<UiInput
								v-model="vncText"
								density="compact"
								class="min-w-0 flex-1"
								:placeholder="t('vncModal.textInputPlaceholder')"
								:aria-label="t('vncModal.textInputPlaceholder')"
								@focus="vncTextFocused = true"
								@blur="releaseVncTextFocus"
								@keydown.enter.prevent="sendVncText"
							/>
							<UiButton
								type="button"
								appearance="solid"
								tone="primary"
								density="compact"
								:disabled="state !== 'connected' || !vncText"
								:title="t('vncModal.sendButtonTitle')"
								@mousedown.prevent
								@click="sendVncText"
							>
								{{ t('common.send') }}
							</UiButton>
						</div>
					</div>

					<SizeControls />
				</footer>
			</div>

			<div
				class="remote-desktop-body relative min-h-0 flex-1 overflow-hidden bg-black"
				:class="fullscreen ? 'h-full' : ''"
			>
				<div ref="display" class="remote-display-container h-full w-full overflow-hidden"></div>
				<div v-if="device.hasTouch.value" class="absolute right-2 top-2 z-20">
					<UiButton
						density="touch"
						:disabled="state !== 'connected'"
						:aria-pressed="mobileKeyboardFocused"
						:aria-label="
							t(
								mobileKeyboardFocused
									? 'remoteDesktopModal.hideKeyboard'
									: 'remoteDesktopModal.showKeyboard',
							)
						"
						:title="
							t(
								mobileKeyboardFocused
									? 'remoteDesktopModal.hideKeyboard'
									: 'remoteDesktopModal.showKeyboard',
							)
						"
						@pointerdown.prevent
						@click="toggleMobileKeyboard"
					>
						<template #leading><i class="fas fa-keyboard" aria-hidden="true"></i></template>
						{{ t('remoteDesktopModal.keyboard') }}
					</UiButton>
				</div>
				<textarea
					v-if="device.hasTouch.value"
					ref="mobileKeyboardInput"
					class="pointer-events-none fixed bottom-0 left-0 h-px w-px opacity-0"
					:aria-label="t('remoteDesktopModal.mobileKeyboardInputLabel')"
					inputmode="text"
					enterkeyhint="enter"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					tabindex="-1"
					@focus="mobileKeyboardFocused = true"
					@blur="mobileKeyboardFocused = false"
					@compositionstart="beginMobileComposition"
					@compositionend="endMobileComposition"
					@input="clearMobileInput"
				></textarea>
				<div
					v-if="state === 'connecting' || state === 'error'"
					class="absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-4 text-white"
				>
					<div class="text-center">
						<UiSpinner v-if="state === 'connecting'" class="mb-3 [--ui-spinner-size:32px]" />
						<i v-else class="fas fa-exclamation-triangle fa-2x mb-3 text-red-400" aria-hidden="true"></i>
						<p class="text-sm">{{ message }}</p>
						<UiButton
							v-if="state === 'error'"
							type="button"
							appearance="soft"
							tone="primary"
							density="compact"
							class="mt-4"
							@click="connect"
						>
							{{ t('common.retry') }}
						</UiButton>
					</div>
				</div>
			</div>

			<p
				v-if="message && state !== 'connecting' && state !== 'error' && message !== stateLabel"
				role="status"
				class="order-2 shrink-0 px-3 py-1 text-xs text-text-secondary"
			>
				{{ message }}
			</p>

			<UiResizeHandle
				v-if="!fullscreen && !device.isMobile.value"
				:disabled="sizeSaving"
				class="absolute bottom-0 right-0 z-[1100]"
				:title="t('remoteDesktopModal.resize')"
				:aria-label="t('remoteDesktopModal.resize')"
				@pointerdown.stop="resize.startResize"
			/>
			<RdpCertificateDialog
				v-if="certificateChallenge"
				:certificate="certificateChallenge"
				:teleport="!fullscreen"
				@cancel="chooseCertificate(null)"
				@approve="chooseCertificate"
			/>
		</div>
	</UiOverlayPanel>
</template>

<style scoped>
	.remote-desktop-restore[data-dock='left'] {
		transform: translateX(-50%);
	}

	.remote-desktop-restore[data-dock='right'] {
		transform: translateX(50%);
	}

	.remote-desktop-restore[data-dock]:focus-visible,
	.remote-desktop-restore.is-dragging {
		transform: none;
	}

	@media (hover: hover) {
		.remote-desktop-restore[data-dock]:hover {
			transform: none;
		}
	}

	.remote-desktop-panel:fullscreen,
	.remote-desktop-panel-fullscreen {
		width: 100vw !important;
		height: 100vh !important;
		max-width: none !important;
		max-height: none !important;
		margin: 0;
		border: 0 !important;
		border-radius: 0 !important;
		background: #000;
		background-image: none;
		box-shadow: none !important;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}

	.remote-desktop-chrome {
		display: contents;
	}
	.remote-desktop-body {
		order: 1;
	}
	.remote-desktop-footer {
		order: 3;
	}

	.remote-desktop-panel-floating-tools > .remote-desktop-chrome {
		position: absolute;
		top: 0;
		right: 0;
		left: 0;
		z-index: 30;
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: var(--color-header);
		box-shadow: 0 3px 10px #0003;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}

	.remote-desktop-panel-floating-tools > .remote-desktop-tools-revealed,
	.remote-desktop-panel-floating-tools > .remote-desktop-chrome:focus-within {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
	}

	.remote-desktop-panel-floating-tools > .remote-desktop-tools-dialog {
		z-index: 1200;
	}
	.remote-desktop-panel-floating-tools .remote-desktop-header {
		flex: 1 1 0;
		min-width: 0;
		padding: 0;
		border: 0;
	}
	.remote-desktop-panel-floating-tools .remote-desktop-header h3 {
		font-size: 0.8125rem;
	}
	.remote-desktop-state-dot {
		width: 0.5rem;
		height: 0.5rem;
		flex: none;
		border-radius: 50%;
		background: var(--color-text-muted);
	}
	.remote-desktop-state-dot[data-state='connected'] {
		background: var(--status-success-color);
	}
	.remote-desktop-state-dot[data-state='connecting'] {
		background: var(--status-warning-color);
	}
	.remote-desktop-state-dot[data-state='error'] {
		background: var(--status-error-color);
	}
	.remote-desktop-dimension {
		display: contents;
	}
	.remote-desktop-panel-floating-tools .remote-desktop-size-controls {
		display: contents;
	}
	.remote-desktop-dimension-group {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.remote-desktop-panel-floating-tools .remote-desktop-dimension > div {
		flex: none;
	}
	.remote-desktop-size-popover {
		width: 13rem;
		max-width: calc(100vw - 3rem);
	}
	.remote-desktop-size-popover .remote-desktop-size-controls {
		flex-direction: column;
		align-items: stretch;
		gap: 0.75rem;
	}
	.remote-desktop-size-popover .remote-desktop-dimension {
		justify-content: space-between;
	}

	.remote-desktop-edge {
		position: absolute;
		left: 50%;
		z-index: 31;
		display: flex;
		width: 3.5rem;
		height: 1rem;
		justify-content: center;
		align-items: center;
		transform: translateX(-50%);
	}

	.remote-desktop-edge > span {
		width: 2rem;
		height: 0.25rem;
		border-radius: 999px;
		background: #fff9;
		box-shadow: 0 1px 4px #0008;
	}

	.remote-desktop-edge:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.remote-desktop-edge-top {
		top: 0;
	}

	@media (pointer: coarse) {
		.remote-desktop-edge {
			height: 1.75rem;
		}
	}

	.remote-display-container {
		isolation: isolate;
		position: relative;
		overflow: hidden;
		background: #000;
	}

	.remote-desktop-panel-fullscreen .remote-display-container {
		width: 100vw;
		height: 100vh;
	}

	.remote-display-container :deep(canvas) {
		z-index: 1 !important;
	}
</style>
