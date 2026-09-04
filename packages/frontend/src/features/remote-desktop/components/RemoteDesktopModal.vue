<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
  import Guacamole from 'guacamole-common-js';
  import type { Client, Event as GuacamoleEvent, Keyboard, Mouse, Status } from 'guacamole-common-js';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput, BaseSpinner, OverlayPanel } from '@/foundation/ui';
  import { useDeviceCapabilities } from '@/foundation/browser/useDeviceCapabilities';
  import { useDraggablePosition, useResizeHandle } from '@/foundation/interaction';
  import { apiErrorMessage } from '@/client/http';
  import { remoteDesktopApi } from '../api/remoteDesktopApi';
  import { attachRemoteTouchInput, type RemoteTouchInput, type RemoteTouchMode } from '../composables/remoteTouchInput';
  import { attachRemoteClipboard, type RemoteClipboardBridge } from '../composables/remoteClipboard';
  import type { RemoteDesktopConnection, RemoteDesktopDisplay, RemoteDesktopState } from '../model/remoteDesktop';
  import type { RemoteDesktopSessionPort } from '../ports/remote-desktop-session-port';

  const TOUCH_MODE_KEY = 'nexus.rdp.touch-mode';
  const readTouchMode = (): RemoteTouchMode => {
    try {
      return localStorage.getItem(TOUCH_MODE_KEY) === 'touchpad' ? 'touchpad' : 'direct';
    } catch {
      return 'direct';
    }
  };

  const props = withDefaults(
    defineProps<{
      visible: boolean;
      connection: RemoteDesktopConnection | null;
      sessionPort?: RemoteDesktopSessionPort;
      width?: number;
      height?: number;
      dpi?: number;
    }>(),
    { sessionPort: () => remoteDesktopApi, width: 1064, height: 858, dpi: 96 },
  );
  const emit = defineEmits<{ close: []; sizeChange: [size: { width: number; height: number }] }>();
  const { t } = useI18n();
  const device = useDeviceCapabilities();
  const panel = ref<HTMLElement | null>(null);
  const display = ref<HTMLElement | null>(null);
  const mobileKeyboardInput = ref<HTMLTextAreaElement | null>(null);
  const state = ref<RemoteDesktopState>('idle');
  const stateLabel = computed(() => t(`remoteDesktopModal.status.${state.value}`));
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

  let client: Client | undefined;
  let keyboard: Keyboard | undefined;
  let mouse: Mouse | undefined;
  let mouseForwarder: ((event: GuacamoleEvent) => void) | undefined;
  let remoteTouch: RemoteTouchInput | undefined;
  let clipboard: RemoteClipboardBridge | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let displayClick: (() => void) | undefined;
  let displayMouseEnter: (() => void) | undefined;
  let displayMouseLeave: (() => void) | undefined;
  let resizeAnimationFrame: number | undefined;
  let connectGeneration = 0;
  let mobileInputComposing = false;

  const protocolMinWidth = () => (props.connection?.type === 'VNC' ? 800 : 1024);
  const protocolMinHeight = () => (props.connection?.type === 'VNC' ? 600 : 768);
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
      ? { position: 'fixed' as const, inset: '0', width: '100vw', height: '100vh' }
      : { width: `${modalWidth.value}px`, height: `${modalHeight.value}px` },
  );

  const currentDisplay = (): RemoteDesktopDisplay => ({
    width: Math.max(100, Math.round(display.value?.clientWidth || modalWidth.value)),
    height: Math.max(100, Math.round(display.value?.clientHeight || modalHeight.value)),
    dpi: props.dpi,
  });
  const cancelScheduledSize = () => {
    if (resizeAnimationFrame === undefined) return;
    window.cancelAnimationFrame(resizeAnimationFrame);
    resizeAnimationFrame = undefined;
  };
  const sendSize = () => {
    cancelScheduledSize();
    resizeAnimationFrame = window.requestAnimationFrame(() => {
      resizeAnimationFrame = undefined;
      if (!client || state.value !== 'connected' || minimized.value || !props.visible) return;
      const size = currentDisplay();
      if (size.width > 0 && size.height > 0) client.sendSize(size.width, size.height);
    });
  };

  const focusMobileKeyboard = () => {
    if (!device.hasTouch.value || !mobileKeyboardInput.value || state.value !== 'connected') return;
    void clipboard?.syncHostToRemote();
    mobileKeyboardInput.value.value = '';
    mobileKeyboardInput.value.focus({ preventScroll: true });
    mobileKeyboardInput.value.click();
    mobileKeyboardInput.value.select();
  };
  const bindTouch = (element: HTMLElement) => {
    remoteTouch?.destroy();
    remoteTouch = undefined;
    if (!client || !device.hasTouch.value) return;
    remoteTouch = attachRemoteTouchInput(element, client, touchMode.value, focusMobileKeyboard);
  };
  const setTouchMode = (mode: RemoteTouchMode) => {
    if (touchMode.value === mode) return;
    touchMode.value = mode;
    try {
      localStorage.setItem(TOUCH_MODE_KEY, mode);
    } catch {
      /* in-memory choice remains */
    }
    const element = client?.getDisplay().getElement();
    if (element && state.value === 'connected') bindTouch(element);
  };

  const cleanupInput = () => {
    const element = client?.getDisplay().getElement();
    clipboard?.destroy();
    clipboard = undefined;
    remoteTouch?.destroy();
    remoteTouch = undefined;
    if (keyboard) {
      keyboard.reset();
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
    }
    keyboard = undefined;
    if (mouse && mouseForwarder) mouse.offEach(['mousedown', 'mousemove', 'mouseup'], mouseForwarder);
    mouse = undefined;
    mouseForwarder = undefined;
    if (element) {
      element.style.cursor = 'default';
      if (displayClick) element.removeEventListener('click', displayClick);
      if (displayMouseEnter) element.removeEventListener('mouseenter', displayMouseEnter);
      if (displayMouseLeave) element.removeEventListener('mouseleave', displayMouseLeave);
    }
    displayClick = undefined;
    displayMouseEnter = undefined;
    displayMouseLeave = undefined;
  };
  const cleanupClient = (nextState: RemoteDesktopState = 'disconnected') => {
    cleanupInput();
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    cancelScheduledSize();
    const current = client;
    client = undefined;
    if (current) {
      current.onstatechange = null;
      current.onerror = null;
      try {
        current.disconnect();
      } catch {
        /* already closed */
      }
    }
    if (display.value) display.value.replaceChildren();
    state.value = nextState;
  };
  const disconnect = () => {
    connectGeneration += 1;
    cleanupClient('disconnected');
  };
  const failConnection = (generation: number, errorMessage: string) => {
    if (generation !== connectGeneration) return;
    connectGeneration += 1;
    message.value = errorMessage;
    cleanupClient('error');
  };

  const setupInput = () => {
    if (!client || !display.value) return;
    const element = client.getDisplay().getElement();
    element.tabIndex = 0;
    keyboard = new Guacamole.Keyboard(element);
    if (mobileKeyboardInput.value) keyboard.listenTo(mobileKeyboardInput.value);
    keyboard.onkeydown = (keysym) => {
      if (!vncTextFocused.value) client?.sendKeyEvent(1, keysym);
    };
    keyboard.onkeyup = (keysym) => {
      if (!vncTextFocused.value) client?.sendKeyEvent(0, keysym);
    };
    mouse = new Guacamole.Mouse(element);
    mouseForwarder = (event) => {
      if (event instanceof Guacamole.Mouse.Event) client?.sendMouseState(event.state, true);
    };
    mouse.onEach(['mousedown', 'mousemove', 'mouseup'], mouseForwarder);
    displayClick = () => {
      if (device.hasTouch.value) focusMobileKeyboard();
      else element.focus();
    };
    displayMouseEnter = () => {
      element.style.cursor = 'none';
    };
    displayMouseLeave = () => {
      element.style.cursor = 'default';
    };
    element.addEventListener('click', displayClick);
    element.addEventListener('mouseenter', displayMouseEnter);
    element.addEventListener('mouseleave', displayMouseLeave);
    clipboard = attachRemoteClipboard(element, client);
    bindTouch(element);
    const guacDisplay = client.getDisplay();
    guacDisplay.showCursor(true);
    const cursorElement = guacDisplay.getCursorLayer()?.getElement();
    if (cursorElement) cursorElement.style.zIndex = '1000';
    if (!device.hasTouch.value) element.focus();
  };

  const connect = async () => {
    if (!props.connection || !display.value || state.value === 'connecting') return;
    const generation = ++connectGeneration;
    const connectionId = props.connection.id;
    const protocol = props.connection.type;
    cleanupClient('disconnected');
    state.value = 'connecting';
    message.value = t('remoteDesktopModal.status.fetchingToken');
    try {
      const spec = currentDisplay();
      const session = await props.sessionPort.create(connectionId, protocol, spec);
      if (
        generation !== connectGeneration ||
        !props.visible ||
        props.connection?.id !== connectionId ||
        props.connection.type !== protocol ||
        !display.value
      )
        return;

      const tunnel = new Guacamole.WebSocketTunnel(props.sessionPort.tunnelUrl());
      const nextClient = new Guacamole.Client(tunnel);
      tunnel.onerror = (status: Status) => {
        failConnection(generation, status.message || t('remoteDesktopModal.errors.tunnelError'));
      };
      client = nextClient;
      display.value.replaceChildren();
      display.value.appendChild(nextClient.getDisplay().getElement());
      nextClient.onstatechange = (value: number) => {
        if (generation !== connectGeneration || client !== nextClient) return;
        if (value === 3) {
          state.value = 'connected';
          message.value = t('remoteDesktopModal.status.connected');
          setupInput();
          void nextTick(sendSize);
        } else if (value === 1 || value === 2) state.value = 'connecting';
        else if (value === 4) state.value = 'disconnecting';
        else if (value === 0 || value === 5) state.value = 'disconnected';
      };
      nextClient.onerror = (status: Status) => {
        failConnection(generation, status.message || t('remoteDesktopModal.errors.clientError'));
      };
      nextClient.connect(props.sessionPort.tunnelData(session, spec));
      resizeObserver = new ResizeObserver(sendSize);
      resizeObserver.observe(display.value);
    } catch (cause) {
      if (generation !== connectGeneration) return;
      failConnection(generation, apiErrorMessage(cause, t('remoteDesktopModal.errors.connectionFailed')));
    }
  };

  const resize = useResizeHandle({
    width: modalWidth,
    height: modalHeight,
    minWidth: minPanelWidth,
    minHeight: minPanelHeight,
    maxWidth: maxPanelWidth,
    maxHeight: maxPanelHeight,
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
    if (document.fullscreenElement !== panel.value) return;
    try {
      await document.exitFullscreen();
    } catch {
      /* browser may already be leaving fullscreen */
    }
  };
  const toggleFullscreen = async () => {
    if (!panel.value) return;
    try {
      if (document.fullscreenElement === panel.value) await document.exitFullscreen();
      else await panel.value.requestFullscreen();
    } catch (cause) {
      message.value = cause instanceof Error ? cause.message : String(cause);
    }
  };
  const onFullscreen = () => {
    fullscreen.value = document.fullscreenElement === panel.value;
    void nextTick(sendSize);
  };
  const handleFullscreenKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !fullscreen.value || document.fullscreenElement !== panel.value) return;
    void exitFullscreen();
  };
  const closeModal = async () => {
    await exitFullscreen();
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
      if (mobileKeyboardInput.value && !mobileInputComposing) mobileKeyboardInput.value.value = '';
    });
  };
  const endMobileComposition = () => {
    mobileInputComposing = false;
    clearMobileInput();
  };

  const unicodeKeysym = (character: string): number | null => {
    if (character === '\n' || character === '\r') return 0xff0d;
    if (character === '\t') return 0xff09;
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return null;
    if ((codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff)) return codePoint;
    return 0x01000000 | codePoint;
  };
  const sendVncText = async (): Promise<void> => {
    const text = vncText.value;
    if (!client || state.value !== 'connected' || props.connection?.type !== 'VNC' || !text) return;
    try {
      for (const character of text) {
        const keysym = unicodeKeysym(character);
        if (keysym === null) continue;
        client.sendKeyEvent(1, keysym);
        client.sendKeyEvent(0, keysym);
      }
    } catch (cause) {
      message.value = t('vncModal.errors.simulateInputError', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };
  const releaseVncTextFocus = () => {
    vncTextFocused.value = false;
    if (state.value === 'connected') client?.getDisplay().getElement().focus();
  };

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
      if (visible) {
        fullscreen.value = document.fullscreenElement === panel.value;
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
      :data-testid="connection?.type === 'VNC' ? 'vnc-window-restore' : 'rdp-window-restore'"
      class="fixed z-[100] grid h-12 w-12 cursor-grab place-items-center rounded-full bg-primary text-white shadow-lg active:cursor-grabbing"
      :style="{ left: `${restorePosition.x}px`, top: `${restorePosition.y}px` }"
      :title="t('remoteDesktopModal.restoreWindow')"
      @pointerdown="restoreDrag.startDragging"
      @click="handleRestoreClick"
    >
      <i class="fas fa-window-restore" aria-hidden="true"></i>
    </button>
  </Teleport>

  <OverlayPanel
    :data-testid="connection?.type === 'VNC' ? 'vnc-modal' : 'remote-desktop-modal'"
    :visible="visible && !minimized"
    :keep-mounted="true"
    teleport
    :surface="false"
    :close-on-backdrop="false"
  >
    <div
      ref="panel"
      :data-testid="connection?.type === 'VNC' ? 'vnc-panel' : 'remote-desktop-panel'"
      role="dialog"
      aria-modal="true"
      :aria-label="connection?.name || t('remoteDesktopModal.title')"
      :style="modalPanelStyle"
      class="relative flex min-h-0 max-w-full flex-col overflow-hidden bg-black text-foreground"
      :class="
        fullscreen ? 'h-screen w-screen rounded-none border-0 shadow-none' : 'rounded-lg border border-border shadow-xl'
      "
    >
      <header
        v-if="!fullscreen"
        :data-testid="connection?.type === 'VNC' ? 'vnc-window-header' : 'rdp-window-header'"
        class="flex flex-wrap items-center justify-between gap-2 bg-header px-3 py-2 text-foreground"
      >
        <span class="min-w-0 truncate">
          {{ connection?.name || t('remoteDesktopModal.title') }} · {{ connection?.type }} · {{ message }}
        </span>
        <div class="flex flex-wrap items-center gap-1">
          <template v-if="device.hasTouch.value">
            <span class="px-1 text-xs text-text-secondary">{{ t('remoteDesktopModal.touchModeLabel') }}</span>
            <BaseButton
              size="sm"
              :variant="touchMode === 'direct' ? 'primary' : 'ghost'"
              :aria-pressed="touchMode === 'direct'"
              :title="t('remoteDesktopModal.touchHintDirect')"
              @click="setTouchMode('direct')"
            >
              {{ t('remoteDesktopModal.touchModeDirect') }}
            </BaseButton>
            <BaseButton
              size="sm"
              :variant="touchMode === 'touchpad' ? 'primary' : 'ghost'"
              :aria-pressed="touchMode === 'touchpad'"
              :title="t('remoteDesktopModal.touchHintTouchpad')"
              @click="setTouchMode('touchpad')"
            >
              {{ t('remoteDesktopModal.touchModeTouchpad') }}
            </BaseButton>
          </template>
          <BaseButton size="sm" :disabled="state === 'connecting'" @click="connect">{{
            t('common.reconnect')
          }}</BaseButton>
          <BaseButton data-testid="rdp-browser-fullscreen" size="sm" @click="toggleFullscreen">
            {{ fullscreen ? t('common.exitFullscreen') : t('common.fullscreen') }}
          </BaseButton>
          <BaseButton
            :data-testid="connection?.type === 'VNC' ? 'vnc-window-minimize' : 'rdp-window-minimize'"
            size="sm"
            variant="ghost"
            :title="t('common.minimize')"
            @click="minimize"
          >
            <i class="fas fa-window-minimize" aria-hidden="true"></i>
          </BaseButton>
          <BaseButton
            :data-testid="connection?.type === 'VNC' ? 'vnc-window-close' : 'rdp-window-close'"
            size="sm"
            @click="closeModal"
            >{{ t('common.close') }}</BaseButton
          >
        </div>
      </header>

      <div class="relative min-h-0 flex-1 overflow-hidden" :class="fullscreen ? 'h-full' : ''">
        <div ref="display" class="h-full w-full overflow-hidden"></div>
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
          @compositionstart="beginMobileComposition"
          @compositionend="endMobileComposition"
          @input="clearMobileInput"
        ></textarea>
        <div v-if="state === 'connecting'" class="absolute inset-0 z-10 grid place-items-center bg-black/60">
          <BaseSpinner />
        </div>
        <div v-if="state === 'error'" class="absolute inset-0 z-10 grid place-items-center bg-black/75 p-4 text-white">
          <div class="max-w-lg text-center">
            <p class="text-sm">{{ message }}</p>
            <BaseButton class="mt-4" size="sm" @click="connect">{{ t('common.retry') }}</BaseButton>
          </div>
        </div>
      </div>

      <div
        v-if="!fullscreen && connection?.type === 'VNC'"
        class="flex shrink-0 items-center gap-2 border-t border-border bg-header px-3 py-2"
      >
        <BaseInput
          v-model="vncText"
          class="min-w-0 flex-1"
          :placeholder="t('vncModal.textInputPlaceholder')"
          @focus="vncTextFocused = true"
          @blur="releaseVncTextFocus"
          @keyup.enter.prevent="sendVncText"
        />
        <BaseButton
          size="sm"
          :disabled="state !== 'connected' || !vncText.trim()"
          :title="t('vncModal.sendButtonTitle')"
          @mousedown.prevent
          @click="sendVncText"
        >
          {{ t('common.send') }}
        </BaseButton>
      </div>

      <footer
        v-if="!fullscreen"
        :data-testid="connection?.type === 'VNC' ? 'vnc-window-footer' : 'rdp-window-footer'"
        class="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-header px-3 py-1 text-xs text-text-secondary"
      >
        <span>{{ stateLabel }}</span>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-1">
            <span>{{ t('common.width') }}</span>
            <input
              v-model.number="modalWidth"
              type="number"
              :min="minPanelWidth()"
              :max="maxPanelWidth()"
              step="10"
              class="w-20 rounded border border-border bg-input px-1 py-0.5 text-foreground"
              @change="commitSize"
            />
          </label>
          <label class="flex items-center gap-1">
            <span>{{ t('common.height') }}</span>
            <input
              v-model.number="modalHeight"
              type="number"
              :min="minPanelHeight()"
              :max="maxPanelHeight()"
              step="10"
              class="w-20 rounded border border-border bg-input px-1 py-0.5 text-foreground"
              @change="commitSize"
            />
          </label>
        </div>
      </footer>

      <button
        v-if="!fullscreen && !device.isMobile.value"
        :data-testid="connection?.type === 'VNC' ? 'vnc-window-resize' : 'rdp-window-resize'"
        type="button"
        class="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize bg-transparent"
        :title="t('remoteDesktopModal.resize')"
        @pointerdown.stop="resize.startResize"
      ></button>
    </div>
  </OverlayPanel>
</template>
