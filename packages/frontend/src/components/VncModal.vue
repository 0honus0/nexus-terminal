<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionsStore } from '../stores/connections.store';
import Guacamole from 'guacamole-common-js';
import type { Client, Event as GuacamoleEvent, Keyboard, Mouse, Status } from 'guacamole-common-js';
import type { ConnectionInfo } from '../stores/connections.store';
import { createLatestValueSaver } from '@/foundation/async/latestValueSaver';
import { useResizeHandle } from '@/foundation/interaction/useResizeHandle';
import { useDraggablePosition } from '@/foundation/interaction/useDraggablePosition';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const props = defineProps<{
  connection: ConnectionInfo | null;
}>();

const MODAL_SETTING_SAVE_DELAY = 500;

const emit = defineEmits(['close']);

const modalWidthSaver = createLatestValueSaver<string>({
  delayMs: MODAL_SETTING_SAVE_DELAY,
  save: async (value) => {
    if (value === settingsStore.settings.vncModalWidth) return;
    await settingsStore.updateSetting('vncModalWidth', value);
    console.log(`[VNC Modal] Saved width to store: ${value}`);
  },
  onError: (error) => console.error('[VNC Modal] Failed to save width:', error),
});
const modalHeightSaver = createLatestValueSaver<string>({
  delayMs: MODAL_SETTING_SAVE_DELAY,
  save: async (value) => {
    if (value === settingsStore.settings.vncModalHeight) return;
    await settingsStore.updateSetting('vncModalHeight', value);
    console.log(`[VNC Modal] Saved height to store: ${value}`);
  },
  onError: (error) => console.error('[VNC Modal] Failed to save height:', error),
});

const MODAL_CONTAINER_PADDING = 32; 
const maxAllowedWidth = computed(() => window.innerWidth - MODAL_CONTAINER_PADDING);
const maxAllowedHeight = computed(() => window.innerHeight - MODAL_CONTAINER_PADDING);

const vncDisplayRef = ref<HTMLDivElement | null>(null);
const vncContainerRef = ref<HTMLDivElement | null>(null);
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
const guacClient = ref<Client | null>(null);
const connectionStatus = ref<ConnectionStatus>('disconnected');
const statusMessage = ref('');
const vncPasteInputText = ref('');

const sendInputTextToVnc = async () => {
  if (!guacClient.value || connectionStatus.value !== 'connected') {
    console.warn('[VncModal] Guacamole client not available or not connected to send text.');
    // Можно добавить сообщение для пользователя здесь, если нужно
    return;
  }
  const textToSend = vncPasteInputText.value;
  if (!textToSend) {
    console.log('[VncModal] Paste input is empty, nothing to send.');
    return;
  }

  console.log(`[VncModal] Simulating keyboard input for: ${textToSend.substring(0,50)}...`);
  try {
    for (const char of textToSend) {
      const keysym = char.charCodeAt(0); //直接使用字符的 Unicode 码点作为 keysym

      // 确保 keysym 是一个有效的数字，尽管 charCodeAt(0) 总是返回数字
      if (typeof keysym === 'number' && !isNaN(keysym)) {
        guacClient.value.sendKeyEvent(1, keysym); // Key press
        await new Promise(resolve => setTimeout(resolve, 20)); // 短暂延迟
        guacClient.value.sendKeyEvent(0, keysym); // Key release
        await new Promise(resolve => setTimeout(resolve, 30)); // 短暂延迟
      } else {
        console.warn(`[VncModal] Invalid keysym for character "${char}". Skipping.`);
      }
    }
    console.log('[VncModal] Finished simulating keyboard input.');
    // vncPasteInputText.value = ''; // 如果希望发送后清空输入框，取消此行注释
  } catch (err: unknown) {
    console.error('[VncModal] Error simulating keyboard input:', err);
    statusMessage.value = t('vncModal.errors.simulateInputError', { error: err instanceof Error ? err.message : String(err) });
  }
};
const keyboard = ref<Keyboard | null>(null);
const mouse = ref<Mouse | null>(null);
// Initialize desiredModalWidth and desiredModalHeight from store or defaults
const initialStoreWidth = settingsStore.settings.vncModalWidth
   ? parseInt(settingsStore.settings.vncModalWidth, 10)
   : 1024;
const initialStoreHeight = settingsStore.settings.vncModalHeight
   ? parseInt(settingsStore.settings.vncModalHeight, 10)
   : 768;

const MIN_MODAL_WIDTH = 800;
const MIN_MODAL_HEIGHT = 600;

const desiredModalWidth = ref(Math.min(Math.max(MIN_MODAL_WIDTH, isNaN(initialStoreWidth) ? MIN_MODAL_WIDTH : initialStoreWidth), maxAllowedWidth.value));
const desiredModalHeight = ref(Math.min(Math.max(MIN_MODAL_HEIGHT, isNaN(initialStoreHeight) ? MIN_MODAL_HEIGHT : initialStoreHeight), maxAllowedHeight.value));

const tempInputWidth = ref<number | string>(desiredModalWidth.value);
const tempInputHeight = ref<number | string>(desiredModalHeight.value);

const isKeyboardDisabledForInput = ref(false);
const isMinimized = ref(false);
const restoreButtonRef = ref<HTMLButtonElement | null>(null);
const restoreButtonPosition = ref({ x: 16, y: window.innerHeight / 2 - 25 }); // 16px from left, vertically centered (25 is half of button height 50px)

// 开发环境由 Vite、部署环境由 Nginx 统一代理 /ws。
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const remoteDesktopWsBaseUrl = `${wsProtocol}//${window.location.host}/ws/rdp-proxy`;

const handleConnection = async () => {
  if (!props.connection || !vncDisplayRef.value) {
    statusMessage.value = t('remoteDesktopModal.errors.missingInfo');
    connectionStatus.value = 'error';
    return;
  }

  while (vncDisplayRef.value.firstChild) {
    vncDisplayRef.value.removeChild(vncDisplayRef.value.firstChild);
  }
  disconnectGuacamole();

  connectionStatus.value = 'connecting';
  statusMessage.value = t('remoteDesktopModal.status.fetchingToken');

  try {
    const connectionsStore = useConnectionsStore();
    // Pass width and height to the token generation, backend will forward to gateway
    const token = await connectionsStore.getVncSessionToken(props.connection.id, desiredModalWidth.value, desiredModalHeight.value);
    if (!token) {
      throw new Error('VNC Token not found from store action');
    }
    statusMessage.value = t('remoteDesktopModal.status.connectingWs');
    // The backend proxy (/ws/rdp-proxy) expects token, width, height, dpi.
    // For VNC, DPI is less critical but the proxy might expect it. Send a default or let backend handle.
    // The backend's websocket.ts rdp-proxy handler now calculates DPI if not provided or uses a default.
    // We need to ensure width and height are passed for the proxy to correctly forward.
    const tunnelUrl = `${remoteDesktopWsBaseUrl}?token=${encodeURIComponent(token)}&width=${desiredModalWidth.value}&height=${desiredModalHeight.value}`;
  

    const tunnel = new Guacamole.WebSocketTunnel(tunnelUrl);

    tunnel.onerror = (status: Status) => {
      const errorMessage = status.message || 'Unknown tunnel error';
      const errorCode = status.code || 'N/A';
      statusMessage.value = `${t('remoteDesktopModal.errors.tunnelError')} (${errorCode}): ${errorMessage}`;
      connectionStatus.value = 'error';
      disconnectGuacamole();
    };

    guacClient.value = new Guacamole.Client(tunnel);

    vncDisplayRef.value.appendChild(guacClient.value.getDisplay().getElement());

    guacClient.value.onstatechange = (state: number) => {
      let currentStatus: ConnectionStatus | null = null;
      let i18nKeyPart = 'unknownState';

      switch (state) {
        case 0: i18nKeyPart = 'idle'; currentStatus = 'disconnected'; break;
        case 1: i18nKeyPart = 'connectingVnc'; currentStatus = 'connecting'; break;
        case 2: i18nKeyPart = 'waiting'; currentStatus = 'connecting'; break;
        case 3:
          i18nKeyPart = 'connected';
          currentStatus = 'connected';
          setupInputListeners();
          nextTick(() => {
            const displayEl = guacClient.value?.getDisplay()?.getElement();
            if (displayEl && typeof displayEl.focus === 'function') {
              displayEl.focus();
            }
            // Sync size on connect
            if (vncDisplayRef.value && guacClient.value) {
              const displayWidth = vncDisplayRef.value.offsetWidth;
              const displayHeight = vncDisplayRef.value.offsetHeight;
              if (displayWidth > 0 && displayHeight > 0) {
                console.log(`[VncModal] Initial resize on connect: ${displayWidth}x${displayHeight}`);
                guacClient.value.sendSize(displayWidth, displayHeight);
              }
            }
          });
          setTimeout(() => {
            nextTick(() => {
              if (vncDisplayRef.value && guacClient.value) {
                const canvases = vncDisplayRef.value.querySelectorAll('canvas');
                canvases.forEach((canvas) => { canvas.style.zIndex = '999'; });
              }
            });
          }, 100);
          break;
        case 4: i18nKeyPart = 'disconnecting'; currentStatus = 'disconnected'; break;
        case 5: i18nKeyPart = 'disconnected'; currentStatus = 'disconnected'; break;
      }
      statusMessage.value = t(`remoteDesktopModal.status.${i18nKeyPart}`, { state });
      if (currentStatus) connectionStatus.value = currentStatus;
    };

    guacClient.value.onerror = (status: Status) => {
      const errorMessage = status.message || 'Unknown client error';
      statusMessage.value = `${t('remoteDesktopModal.errors.clientError')}: ${errorMessage}`;
      connectionStatus.value = 'error';
      disconnectGuacamole();
    };

    guacClient.value.connect('');

  } catch (error: any) {
    statusMessage.value = `${t('remoteDesktopModal.errors.connectionFailed')}: ${error.response?.data?.message || error.message || String(error)}`;
    connectionStatus.value = 'error';
    disconnectGuacamole();
  }
};

const trySyncClipboardOnDisplayFocus = async () => {
  if (!guacClient.value) {
    return;
  }
  try {
    const currentClipboardText = await navigator.clipboard.readText();
    if (currentClipboardText && guacClient.value) {
      const stream = guacClient.value.createClipboardStream('text/plain');
      const writer = new Guacamole.StringWriter(stream);
      writer.sendText(currentClipboardText);
      writer.sendEnd();
      console.log('[VncModal] Sent clipboard to VNC on display focus:', currentClipboardText.substring(0, 50) + (currentClipboardText.length > 50 ? '...' : ''));
    }
  } catch (err) {
    // This error is expected if the document/tab is not focused when the VNC display element gets focus.
    // Or if clipboard permissions are not granted.
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      // console.log('[VncModal] Clipboard read on display focus skipped: Document not focused or permission denied.');
    } else {
      console.warn('[VncModal] Could not read clipboard on display focus, or other error:', err);
    }
  }
};

const setupInputListeners = () => {
    if (!guacClient.value || !vncDisplayRef.value) return;
    try {
        const displayEl = guacClient.value.getDisplay().getElement();
        displayEl.tabIndex = 0;

        const handleVncDisplayClick = () => {
          const activeElement = document.activeElement;
          if (activeElement instanceof HTMLElement && (activeElement.id === 'modal-width' || activeElement.id === 'modal-height')) {
            activeElement.blur();
          }
          // Ensure the VNC display element gets focus when clicked
          if (displayEl && typeof displayEl.focus === 'function') {
            displayEl.focus();
          }
        };
        displayEl.addEventListener('click', handleVncDisplayClick);

        const handleMouseEnter = () => { if (displayEl) displayEl.style.cursor = 'none'; };
        const handleMouseLeave = () => { if (displayEl) displayEl.style.cursor = 'default'; };
        displayEl.addEventListener('mouseenter', handleMouseEnter);
        displayEl.addEventListener('mouseleave', handleMouseLeave);

        mouse.value = new Guacamole.Mouse(displayEl);
        const display = guacClient.value.getDisplay();
        display.showCursor(true);

        const cursorLayer = display.getCursorLayer();
        if (cursorLayer) {
          const cursorElement = cursorLayer.getElement();
          if (cursorElement) {
             cursorElement.style.zIndex = '1000';
          }
        }

        mouse.value.onEach(['mousedown', 'mouseup', 'mousemove'], forwardMouseEvent);

        keyboard.value = new Guacamole.Keyboard(displayEl);

        keyboard.value.onkeydown = (keysym: number) => {
            if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(1, keysym);
            }
        };
        keyboard.value.onkeyup = (keysym: number) => {
             if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(0, keysym);
             }
        };

        // Listen for host copy events to send to VNC
        // document.addEventListener('copy', handleHostCopy); // Removed this
        // displayEl.addEventListener('mouseenter', trySyncClipboardOnMouseEnter); // Changed to focus event
        displayEl.addEventListener('focus', trySyncClipboardOnDisplayFocus);

    } catch (inputError) {
        console.error("Error setting up VNC input listeners:", inputError);
        statusMessage.value = t('remoteDesktopModal.errors.inputError');
    }
};

const removeInputListeners = () => {
    // Remove host copy event listener
    // document.removeEventListener('copy', handleHostCopy); // Removed this
    if (guacClient.value) {
        const displayEl = guacClient.value.getDisplay()?.getElement();
        if (displayEl) {
            // displayEl.removeEventListener('mouseenter', trySyncClipboardOnMouseEnter); // Changed to focus event
            displayEl.removeEventListener('focus', trySyncClipboardOnDisplayFocus);
            try {
              if (displayEl) {
                  displayEl.style.cursor = 'default';
              }
            } catch (e) {
                console.warn("Could not reset cursor on VNC display element:", e);
            }
        }
    }
    // The rest of the cleanup for keyboard and mouse can remain outside the guacClient.value check
    // as they are independent refs.
    if (keyboard.value) {
        keyboard.value.onkeydown = null;
        keyboard.value.onkeyup = null;
        keyboard.value = null;
    }
     if (mouse.value) {
        mouse.value.offEach(['mousedown', 'mouseup', 'mousemove'], forwardMouseEvent);
        mouse.value = null;
    }
};

const forwardMouseEvent = (event: GuacamoleEvent) => {
  if (event instanceof Guacamole.Mouse.Event && guacClient.value) {
    guacClient.value.sendMouseState(event.state);
  }
};

const disableVncKeyboard = () => {
  isKeyboardDisabledForInput.value = true;
};

const enableVncKeyboard = () => {
  isKeyboardDisabledForInput.value = false;
  nextTick(() => {
    const displayEl = guacClient.value?.getDisplay()?.getElement();
    if (displayEl && typeof displayEl.focus === 'function') {
      displayEl.focus();
    }
  });
};

const minimizeModal = () => {
  isMinimized.value = true;
};

const restoreModal = () => {
  isMinimized.value = false;
};

const {
  didDrag: restoreButtonDragged,
  startDragging: startRestoreButtonDrag,
} = useDraggablePosition({
  position: restoreButtonPosition,
  getElement: () => restoreButtonRef.value,
  constrain: (position, element) => ({
    x: Math.max(0, Math.min(position.x, window.innerWidth - element.offsetWidth)),
    y: Math.max(0, Math.min(position.y, window.innerHeight - element.offsetHeight)),
  }),
});

const handleClickRestoreButton = () => {
  if (!restoreButtonDragged.value) restoreModal();
  restoreButtonDragged.value = false;
};

const disconnectGuacamole = () => {
  removeInputListeners();
  isKeyboardDisabledForInput.value = false;
  if (guacClient.value) {
    guacClient.value.disconnect();
    guacClient.value = null;
  }
  if (vncDisplayRef.value) {
      while (vncDisplayRef.value.firstChild) {
          vncDisplayRef.value.removeChild(vncDisplayRef.value.firstChild);
      }
  }
  if (connectionStatus.value !== 'error') {
      connectionStatus.value = 'disconnected';
      statusMessage.value = t('remoteDesktopModal.status.disconnected');
  }
};

const closeModal = () => {
  disconnectGuacamole();
  emit('close');
};

const handleWidthInputBlur = () => {
  const currentValue = Number(tempInputWidth.value) || MIN_MODAL_WIDTH;
  const validatedValue = Math.min(Math.max(MIN_MODAL_WIDTH, currentValue), maxAllowedWidth.value);

  desiredModalWidth.value = validatedValue;
  tempInputWidth.value = validatedValue;
  modalWidthSaver.schedule(String(validatedValue));
  enableVncKeyboard();
};

const handleHeightInputBlur = () => {
  const currentValue = Number(tempInputHeight.value) || MIN_MODAL_HEIGHT;
  const validatedValue = Math.min(Math.max(MIN_MODAL_HEIGHT, currentValue), maxAllowedHeight.value);

  desiredModalHeight.value = validatedValue;
  tempInputHeight.value = validatedValue;
  modalHeightSaver.schedule(String(validatedValue));
  enableVncKeyboard();
};

watch(desiredModalWidth, (newVal) => {
  if (Number(tempInputWidth.value) !== newVal) {
    tempInputWidth.value = newVal;
  }
});

watch(desiredModalHeight, (newVal) => {
  if (Number(tempInputHeight.value) !== newVal) {
    tempInputHeight.value = newVal;
  }
});




onMounted(() => {
  if (props.connection) {
    tempInputWidth.value = desiredModalWidth.value;
    tempInputHeight.value = desiredModalHeight.value;
    nextTick(async () => {
        await handleConnection();
    });
  } else {
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

onUnmounted(() => {
  modalWidthSaver.dispose({ flush: true });
  modalHeightSaver.dispose({ flush: true });
  disconnectGuacamole();
});

watch(() => props.connection, (newConnection, oldConnection) => {
  if (newConnection && newConnection.id !== oldConnection?.id) {
     nextTick(async () => {
        await handleConnection();
     });
  } else if (!newConnection) {
      disconnectGuacamole();
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

const computedModalStyle = computed(() => {
  const actualWidth = Math.min(Math.max(MIN_MODAL_WIDTH, desiredModalWidth.value), maxAllowedWidth.value);
  const actualHeight = Math.min(Math.max(MIN_MODAL_HEIGHT, desiredModalHeight.value), maxAllowedHeight.value);
  return {
    width: `${actualWidth}px`,
    height: `${actualHeight}px`,
  };
});

watchEffect(() => {
  // 依赖 computedModalStyle，当其变化时此 effect 会重新运行
  const currentStyle = computedModalStyle.value;

  if (guacClient.value && connectionStatus.value === 'connected' && vncDisplayRef.value) {
    // 使用 nextTick 确保 DOM 更新完毕，vncDisplayRef 的尺寸已根据 currentStyle 刷新
    nextTick(() => {
      if (vncDisplayRef.value && guacClient.value) { // 再次检查，因为 nextTick 是异步的
        const displayWidth = vncDisplayRef.value.offsetWidth;
        const displayHeight = vncDisplayRef.value.offsetHeight;

        if (displayWidth > 0 && displayHeight > 0) {
          console.log(`[VncModal] Resizing VNC display to: ${displayWidth}x${displayHeight} due to style change.`);
          guacClient.value.sendSize(displayWidth, displayHeight);
        }
      }
    });
  }
});

const { startResize: initResize } = useResizeHandle({
  width: desiredModalWidth,
  height: desiredModalHeight,
  minWidth: MIN_MODAL_WIDTH,
  minHeight: MIN_MODAL_HEIGHT,
  maxWidth: () => maxAllowedWidth.value,
  maxHeight: () => maxAllowedHeight.value,
});

</script>
<template>
  <div
    data-testid="vnc-modal"
    :class="[
      'fixed inset-0 z-50 flex items-center justify-center p-4',
      isMinimized ? '' : 'bg-overlay',
      isMinimized ? 'pointer-events-none' : '' // 允许恢复按钮接收事件
    ]"
  >
     <button
        ref="restoreButtonRef"
        data-testid="vnc-window-restore"
        v-if="isMinimized"
        @pointerdown="startRestoreButtonDrag"
        @click="handleClickRestoreButton"
        :style="{ left: `${restoreButtonPosition.x}px`, top: `${restoreButtonPosition.y}px`, width: '50px', height: '50px' }"
        class="fixed z-[100] flex items-center justify-center bg-primary text-white rounded-full shadow-lg hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50 pointer-events-auto cursor-grab active:cursor-grabbing"
        :title="t('common.restore')"
      >
        <i class="fas fa-window-restore fa-lg"></i>
      </button>
     <div
        data-testid="vnc-panel"
        v-show="!isMinimized"
        :style="computedModalStyle"
        class="bg-background text-foreground rounded-lg shadow-xl flex flex-col overflow-hidden border border-border pointer-events-auto relative"
     >
      <div class="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <h3 class="text-base font-semibold truncate">
          <i class="fas fa-plug mr-2 text-text-secondary"></i>
          {{ t('vncModal.title') }} - {{ props.connection?.name || props.connection?.host || t('remoteDesktopModal.titlePlaceholder') }}
        </h3>
        <div class="flex items-center space-x-1">
            <span class="text-xs px-2 py-0.5 rounded"
                  :class="{
                    'bg-yellow-200 text-yellow-800': connectionStatus === 'connecting',
                    'bg-green-200 text-green-800': connectionStatus === 'connected',
                    'bg-red-200 text-red-800': connectionStatus === 'error',
                    'bg-gray-200 text-gray-800': connectionStatus === 'disconnected'
                  }">
              {{ t('remoteDesktopModal.status.' + connectionStatus) }}
            </span>
            <button
                data-testid="vnc-window-minimize"
                @click="minimizeModal"
                class="text-text-secondary hover:text-foreground transition-colors duration-150 p-1 rounded hover:bg-hover"
                :title="t('common.minimize')"
            >
                <i class="fas fa-window-minimize fa-sm"></i>
            </button>
             <button
                data-testid="vnc-window-close"
                @click="closeModal"
                class="text-text-secondary hover:text-foreground transition-colors duration-150 p-1 rounded hover:bg-hover"
                :title="t('common.close')"
             >
                <i class="fas fa-times fa-lg"></i>
             </button>
        </div>
      </div>

      <div ref="vncContainerRef" class="relative bg-black overflow-hidden flex-1">
        <div ref="vncDisplayRef" class="vnc-display-container w-full h-full">
        </div>
         <div v-if="connectionStatus === 'connecting' || connectionStatus === 'error'"
              class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 text-white p-4 z-10">
            <div class="text-center">
              <i v-if="connectionStatus === 'connecting'" class="fas fa-spinner fa-spin fa-2x mb-3"></i>
              <i v-else class="fas fa-exclamation-triangle fa-2x mb-3 text-red-400"></i>
              <p class="text-sm">{{ statusMessage }}</p>
               <button v-if="connectionStatus === 'error'"
                       @click="() => handleConnection()"
                       class="mt-4 px-3 py-1 bg-primary text-white rounded text-xs hover:bg-primary-dark">
                 {{ t('common.retry') }}
               </button>
            </div>
         </div>
      </div>

       <div class="p-2 border-t border-border flex-shrink-0 text-xs text-text-secondary bg-header flex items-center justify-between flex-wrap gap-y-2">
         <!-- 输入框和发送按钮 -->
         <div class="flex items-center space-x-2 flex-auto mr-0 sm:mr-4"> <!-- flex-auto to grow, responsive margin -->
           <input
             type="text"
             v-model="vncPasteInputText"
             :placeholder="t('vncModal.textInputPlaceholder')"
             class="flex-grow px-2 py-1 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0"
             style="min-width: 120px;"
             @focus="disableVncKeyboard"
             @blur="enableVncKeyboard"
             @keydown.enter.prevent="sendInputTextToVnc"
           />
           <button
             @click="sendInputTextToVnc"
             :disabled="!vncPasteInputText.trim() || connectionStatus !== 'connected'"
             class="px-3 py-1 bg-primary text-white rounded text-xs hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
             :title="t('vncModal.sendButtonTitle')"
           >
             {{ t('common.send') }}
           </button>
         </div>

         <!-- 现有的宽度/高度和重新连接按钮 -->
         <div class="flex items-center space-x-2 flex-wrap gap-y-1 flex-shrink-0">
            <label for="modal-width" class="text-xs ml-2">{{ t('common.width') }}:</label>
            <input
              id="modal-width"
              type="number"
              v-model.number="tempInputWidth"
              step="10"
              class="w-16 px-1 py-0.5 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              @focus="disableVncKeyboard"
              @blur="handleWidthInputBlur"
            />
            <label for="modal-height" class="text-xs">{{ t('common.height') }}:</label>
            <input
              id="modal-height"
              type="number"
              v-model.number="tempInputHeight"
              step="10"
              class="w-16 px-1 py-0.5 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              @focus="disableVncKeyboard"
              @blur="handleHeightInputBlur"
            />
             <button
               @click="handleConnection"
               :disabled="connectionStatus === 'connecting'"
               class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
               :title="t('remoteDesktopModal.reconnectTooltip')"
             >
               {{ t('common.reconnect') }}
             </button>
         </div>
       </div>
       <!-- Resize Handle -->
       <div
           data-testid="vnc-window-resize"
           class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10 bg-transparent hover:bg-primary-dark hover:bg-opacity-30"
           title="Resize"
           @pointerdown.stop="initResize"
       ></div>
   </div>
 </div>
</template>
<style scoped>
.vnc-display-container {
  overflow: hidden;
  position: relative;
}

.vnc-display-container :deep(div) {
}

.vnc-display-container :deep(canvas) {
  z-index: 999;
}
</style>
