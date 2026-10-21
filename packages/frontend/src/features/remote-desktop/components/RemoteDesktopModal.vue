<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, onActivated, onDeactivated, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiOverlayPanel, UiResizeHandle } from '@/foundation/ui';
	import { readStoredValue, stringStorageCodec, useDeviceCapabilities, writeStoredValue } from '@/foundation/browser';
	import { useDraggablePosition, useResizeHandle } from '@/foundation/interaction';
	import { remoteDesktopApi } from '../api/remote-desktop-api';
	import { createGuacamoleDesktop } from '../adapters/guacamole-desktop';
	import { createRemoteDesktopController } from '../model/remote-desktop-controller';
	import type {
		RemoteDesktopConnection,
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
		attempted: [connectionId: number, lastConnectedAt: number];
	}>();
	const { t } = useI18n();
	const device = useDeviceCapabilities();
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
	const stateBadgeClass = computed(() => {
		if (state.value === 'connected') return 'bg-green-200 text-green-800';
		if (state.value === 'connecting') return 'bg-yellow-200 text-yellow-800';
		if (state.value === 'error') return 'bg-red-200 text-red-800';
		return 'bg-gray-200 text-gray-800';
	});
	const message = ref('');
	const fullscreen = ref(false);
	const minimized = ref(false);
	const modalWidth = ref(props.width);
	const modalHeight = ref(props.height);
	const restoreButton = ref<HTMLButtonElement | null>(null);
	const restorePosition = ref({ x: 16, y: Math.max(16, window.innerHeight / 2 - 25) });
	const touchMode = ref<RemoteTouchMode>(readTouchMode());
	const vncText = ref('');
	const vncTextFocused = ref(false);

	let resizeObserver: ResizeObserver | undefined;
	let resizeAnimationFrame: number | undefined;
	let mobileInputComposing = false;
	let active = true;
	let viewRevision = 0;
	const controller = createRemoteDesktopController({
		api: remoteDesktopApi,
		createPeer: createGuacamoleDesktop,

		onState(next, failure) {
			state.value = next;
			message.value = failure
				? t('remoteDesktopModal.failures.' + failure.code) +
					(failure.outcome === 'unknown' ? ' ' + t('remoteDesktopModal.unknownOutcome') : '')
				: t('remoteDesktopModal.status.' + next);
			if (next === 'connected') void nextTick(sendSize);
			if (next === 'disconnected' || next === 'error') {
				resizeObserver?.disconnect();
				resizeObserver = undefined;
				cancelScheduledSize();
				hideMobileKeyboard();
			}
		},

		onAttempt(id, lastConnectedAt) {
			emit('attempted', id, lastConnectedAt);
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

	const maxPanelWidth = () => Math.max(200, window.innerWidth - 32);

	const maxPanelHeight = () => Math.max(200, window.innerHeight - 32);

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
		viewRevision += 1;
		vncText.value = '';
		vncTextFocused.value = false;
		if (mobileKeyboardInput.value) mobileKeyboardInput.value.value = '';
		controller.close();
		resizeObserver?.disconnect();
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
			resizeObserver?.disconnect();
			resizeObserver = new ResizeObserver(sendSize);
			resizeObserver.observe(host);
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
	const restoreDrag = useDraggablePosition({
		position: restorePosition,

		getElement: () => restoreButton.value,

		constrain: (position, element) => ({
			x: Math.max(0, Math.min(position.x, window.innerWidth - element.offsetWidth)),
			y: Math.max(0, Math.min(position.y, window.innerHeight - element.offsetHeight)),
		}),
	});

	const minimize = () => {
		if (fullscreen.value) return;
		hideMobileKeyboard();
		minimized.value = true;
	};

	const restore = () => {
		minimized.value = false;
		void nextTick(sendSize);
	};

	const handleRestoreClick = () => {
		if (restoreDrag.didDrag.value) {
			restoreDrag.didDrag.value = false;
			return;
		}
		restore();
	};

	const commitSize = () => {
		clampSize();
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
		void nextTick(sendSize);
	};

	const handleFullscreenKeydown = (event: KeyboardEvent) => {
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
				clampSize();
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
</script>

<template>
	<Teleport to="body">
		<button
			v-if="visible && minimized"
			ref="restoreButton"
			type="button"
			class="fixed z-[100] flex h-[50px] w-[50px] cursor-grab items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50 active:cursor-grabbing"
			:style="{ left: `${restorePosition.x}px`, top: `${restorePosition.y}px` }"
			:title="t('remoteDesktopModal.restoreWindow')"
			@pointerdown="restoreDrag.startDragging"
			@click="handleRestoreClick"
		>
			<i class="fas fa-window-restore fa-lg" aria-hidden="true"></i>
		</button>
	</Teleport>

	<UiOverlayPanel
		:visible="visible && !minimized"
		:keep-mounted="true"
		teleport
		:surface="false"
		:close-on-backdrop="false"
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
					: 'rounded-lg border border-border bg-background shadow-xl'
			"
		>
			<header v-if="!fullscreen" class="flex shrink-0 items-center justify-between border-b border-border p-3">
				<h3 class="min-w-0 truncate text-base font-semibold">
					<i
						:class="connection?.type === 'VNC' ? 'fas fa-plug' : 'fas fa-desktop'"
						class="mr-2 text-text-secondary"
						aria-hidden="true"
					></i>
					{{ windowTitle }} - {{ connectionLabel }}
				</h3>
				<div class="ml-2 flex shrink-0 items-center space-x-1">
					<span class="rounded px-2 py-0.5 text-xs" :class="stateBadgeClass">{{ stateLabel }}</span>
					<button
						type="button"
						class="rounded p-1 text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-foreground"
						:title="fullscreen ? t('common.exitFullscreen') : t('common.fullscreen')"
						:aria-label="fullscreen ? t('common.exitFullscreen') : t('common.fullscreen')"
						@click="toggleFullscreen"
					>
						<i :class="fullscreen ? 'fas fa-compress fa-sm' : 'fas fa-expand fa-sm'" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="rounded p-1 text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-foreground"
						:title="t('common.minimize')"
						:aria-label="t('common.minimize')"
						@click="minimize"
					>
						<i class="fas fa-window-minimize fa-sm" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="rounded p-1 text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-foreground"
						:title="t('common.close')"
						:aria-label="t('common.close')"
						@click="closeModal"
					>
						<i class="fas fa-times fa-lg" aria-hidden="true"></i>
					</button>
				</div>
			</header>

			<div class="relative min-h-0 flex-1 overflow-hidden bg-black" :class="fullscreen ? 'h-full' : ''">
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
						<i
							v-if="state === 'connecting'"
							class="fas fa-spinner fa-spin fa-2x mb-3"
							aria-hidden="true"
						></i>
						<i v-else class="fas fa-exclamation-triangle fa-2x mb-3 text-red-400" aria-hidden="true"></i>
						<p class="text-sm">{{ message }}</p>
						<button
							v-if="state === 'error'"
							type="button"
							class="mt-4 rounded bg-primary px-3 py-1 text-xs text-white hover:bg-primary-dark"
							@click="connect"
						>
							{{ t('common.retry') }}
						</button>
					</div>
				</div>
			</div>

			<p
				v-if="message && state !== 'connecting' && state !== 'error' && message !== stateLabel"
				role="status"
				class="shrink-0 px-3 py-1 text-xs text-text-secondary"
			>
				{{ message }}
			</p>

			<footer
				v-if="!fullscreen"
				class="flex shrink-0 gap-2 border-t border-border bg-header p-2 text-xs text-text-secondary"
				:class="device.isMobile.value ? 'flex-col items-stretch' : 'flex-wrap items-center justify-between'"
			>
				<div
					class="flex min-w-0 items-center gap-2"
					:class="device.isMobile.value ? 'w-full flex-none flex-col items-stretch' : 'flex-1 flex-wrap'"
				>
					<div
						v-if="device.hasTouch.value"
						class="flex min-w-0 flex-col gap-1"
						:class="device.isMobile.value ? 'w-full' : ''"
					>
						<div
							class="flex items-center gap-1.5"
							:class="device.isMobile.value ? 'w-full justify-between' : ''"
						>
							<span class="shrink-0 text-[11px] text-text-muted">{{
								t('remoteDesktopModal.touchModeLabel')
							}}</span>
							<div
								class="inline-flex shrink-0 overflow-hidden rounded border border-border"
								role="group"
								:aria-label="t('remoteDesktopModal.touchModeLabel')"
							>
								<button
									type="button"
									class="relative z-10 min-h-8 px-2 py-1 text-[11px] transition-colors"
									:class="
										touchMode === 'direct'
											? 'bg-primary text-white'
											: 'bg-background text-foreground hover:bg-hover'
									"
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
									:class="
										touchMode === 'touchpad'
											? 'bg-primary text-white'
											: 'bg-background text-foreground hover:bg-hover'
									"
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
							class="text-[11px] leading-tight text-text-muted"
							:class="device.isMobile.value ? 'whitespace-normal' : ''"
						>
							{{
								t(
									touchMode === 'direct'
										? 'remoteDesktopModal.touchHintDirect'
										: 'remoteDesktopModal.touchHintTouchpad',
								)
							}}
						</span>
					</div>

					<div v-if="connection?.type === 'VNC'" class="flex min-w-[12rem] flex-1 items-center space-x-2">
						<input
							v-model="vncText"
							type="text"
							:placeholder="t('vncModal.textInputPlaceholder')"
							class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
							@focus="vncTextFocused = true"
							@blur="releaseVncTextFocus"
							@keydown.enter.prevent="sendVncText"
						/>
						<button
							type="button"
							class="whitespace-nowrap rounded bg-primary px-3 py-1 text-xs text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
							:disabled="state !== 'connected' || !vncText"
							:title="t('vncModal.sendButtonTitle')"
							@mousedown.prevent
							@click="sendVncText"
						>
							{{ t('common.send') }}
						</button>
					</div>
				</div>

				<div
					class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1"
					:class="
						device.isMobile.value ? 'ml-0 w-full justify-end border-t border-border/60 pt-2' : 'ml-auto'
					"
				>
					<label :for="connection?.type === 'VNC' ? 'vnc-modal-width' : 'rdp-modal-width'" class="text-xs">
						{{ t('common.width') }}:
					</label>
					<input
						:id="connection?.type === 'VNC' ? 'vnc-modal-width' : 'rdp-modal-width'"
						v-model.number="modalWidth"
						:disabled="sizeSaving"
						type="number"
						:min="minPanelWidth()"
						:max="maxPanelWidth()"
						step="10"
						class="w-16 rounded border border-border bg-input px-1 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
						@change="commitSize"
					/>
					<label :for="connection?.type === 'VNC' ? 'vnc-modal-height' : 'rdp-modal-height'" class="text-xs">
						{{ t('common.height') }}:
					</label>
					<input
						:id="connection?.type === 'VNC' ? 'vnc-modal-height' : 'rdp-modal-height'"
						v-model.number="modalHeight"
						:disabled="sizeSaving"
						type="number"
						:min="minPanelHeight()"
						:max="maxPanelHeight()"
						step="10"
						class="w-16 rounded border border-border bg-input px-1 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
						@change="commitSize"
					/>
					<button
						type="button"
						class="rounded-md bg-button px-4 py-2 text-button-text shadow-sm transition duration-150 ease-in-out hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
						:disabled="state === 'connecting'"
						:title="t('remoteDesktopModal.reconnectTooltip')"
						@click="connect"
					>
						{{ t('common.reconnect') }}
					</button>
				</div>
			</footer>

			<UiResizeHandle
				v-if="!fullscreen && !device.isMobile.value"
				:disabled="sizeSaving"
				class="absolute bottom-0 right-0 z-[1100]"
				:title="t('remoteDesktopModal.resize')"
				:aria-label="t('remoteDesktopModal.resize')"
				@pointerdown.stop="resize.startResize"
			/>
		</div>
	</UiOverlayPanel>
</template>

<style scoped>
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
		box-shadow: none !important;
	}

	.remote-display-container {
		isolation: isolate;
		position: relative;
		overflow: hidden;
	}

	.remote-desktop-panel-fullscreen .remote-display-container {
		width: 100vw;
		height: 100vh;
	}

	.remote-display-container :deep(canvas) {
		/* guacamole-common-js writes `z-index: -1` inline on every layer canvas. Without an
       important override the connected session can render behind this surface's black
       background, producing a green Connected state with no visible remote image. Keep
       the layers inside this isolated display stacking context so they cannot cover the
       modal header, footer, or resize affordance. */
		z-index: 1 !important;
	}
</style>
