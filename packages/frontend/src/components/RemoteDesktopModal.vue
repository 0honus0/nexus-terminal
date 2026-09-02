<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed, watchEffect } from 'vue'; 
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionsStore } from '../stores/connections.store'; 
import Guacamole from 'guacamole-common-js';
import type { Client, Event as GuacamoleEvent, Keyboard, Mouse, Status } from 'guacamole-common-js';
import { isAxiosError } from 'axios';
import apiClient from '../utils/apiClient';
import type { ConnectionInfo } from '../stores/connections.store';
import { createLatestValueSaver } from '@/foundation/async/latestValueSaver';
import { useResizeHandle } from '@/foundation/interaction/useResizeHandle';
import { useDraggablePosition } from '@/foundation/interaction/useDraggablePosition';
import {
  attachRemoteTouchInput,
  type RemoteTouchInput,
  type RemoteTouchMode,
} from '@/foundation/interaction/remoteTouchInput';

const { t } = useI18n();
const settingsStore = useSettingsStore(); 

const props = defineProps<{
  connection: ConnectionInfo | null;
}>();

const MODAL_SETTING_SAVE_DELAY = 500;
const REMOTE_TOUCH_MODE_STORAGE_KEY = 'nexus.rdp.touch-mode';

const readRemoteTouchMode = (): RemoteTouchMode => {
  try {
    return window.localStorage.getItem(REMOTE_TOUCH_MODE_STORAGE_KEY) === 'touchpad'
      ? 'touchpad'
      : 'direct';
  } catch {
    return 'direct';
  }
};

const emit = defineEmits(['close']);

const modalWidthSaver = createLatestValueSaver<string>({
  delayMs: MODAL_SETTING_SAVE_DELAY,
  save: async (value) => {
    if (value === settingsStore.settings.rdpModalWidth) return;
    await settingsStore.updateSetting('rdpModalWidth', value);
    console.log(`[RDP Modal] Saved width to store: ${value}`);
  },
  onError: (error) => console.error('[RDP Modal] Failed to save width:', error),
});
const modalHeightSaver = createLatestValueSaver<string>({
  delayMs: MODAL_SETTING_SAVE_DELAY,
  save: async (value) => {
    if (value === settingsStore.settings.rdpModalHeight) return;
    await settingsStore.updateSetting('rdpModalHeight', value);
    console.log(`[RDP Modal] Saved height to store: ${value}`);
  },
  onError: (error) => console.error('[RDP Modal] Failed to save height:', error),
});

const MODAL_CONTAINER_PADDING = 32; 
const maxAllowedWidth = computed(() => window.innerWidth - MODAL_CONTAINER_PADDING);
const maxAllowedHeight = computed(() => window.innerHeight - MODAL_CONTAINER_PADDING);

const rdpDisplayRef = ref<HTMLDivElement | null>(null);
const rdpContainerRef = ref<HTMLDivElement | null>(null);
const modalPanelRef = ref<HTMLDivElement | null>(null);
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
const guacClient = ref<Client | null>(null);
const connectionStatus = ref<ConnectionStatus>('disconnected');
const statusMessage = ref('');
const keyboard = ref<Keyboard | null>(null);
const mouse = ref<Mouse | null>(null);
let remoteTouchInput: RemoteTouchInput | null = null;
let mobileKeyboardInput: HTMLTextAreaElement | null = null;
const hasTouchInput = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
const remoteTouchMode = ref<RemoteTouchMode>(readRemoteTouchMode());
const desiredModalWidth = ref(1064);
const desiredModalHeight = ref(858);
const isBrowserFullscreen = ref(false);
let displayResizeObserver: ResizeObserver | null = null;
let sendSizeAnimationFrame: number | null = null;

const tempInputWidth = ref<number | string>(desiredModalWidth.value);
const tempInputHeight = ref<number | string>(desiredModalHeight.value);

const isKeyboardDisabledForInput = ref(false); // 标记键盘是否因输入框聚焦而禁用
const isMinimized = ref(false);
const restoreButtonRef = ref<HTMLButtonElement | null>(null);
const restoreButtonPosition = ref({ x: 16, y: window.innerHeight / 2 - 25 }); // 16px from left, vertically centered

const MIN_MODAL_WIDTH = 1024;
const MIN_MODAL_HEIGHT = 768;

const sendRemoteDisplaySize = () => {
  if (sendSizeAnimationFrame !== null) {
    window.cancelAnimationFrame(sendSizeAnimationFrame);
  }
  sendSizeAnimationFrame = window.requestAnimationFrame(() => {
    sendSizeAnimationFrame = null;
    if (!guacClient.value || connectionStatus.value !== 'connected' || !rdpContainerRef.value) return;
    const rawWidth = Math.round(rdpContainerRef.value.clientWidth);
    const rawHeight = Math.round(rdpContainerRef.value.clientHeight);
    // v-show collapses the panel to 0x0 while minimized. Do not shrink the
    // remote Windows desktop merely because the local RDP window is hidden.
    if (rawWidth <= 0 || rawHeight <= 0) return;
    guacClient.value.sendSize(Math.max(100, rawWidth), Math.max(100, rawHeight));
  });
};

const handleFullscreenChange = () => {
  isBrowserFullscreen.value = document.fullscreenElement === modalPanelRef.value;
  nextTick(sendRemoteDisplaySize);
};

const handleFullscreenKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !isBrowserFullscreen.value || !document.fullscreenElement) return;
  void document.exitFullscreen().catch(error => {
    console.warn('[RDP Modal] Failed to exit browser fullscreen with Escape:', error);
  });
};

const toggleBrowserFullscreen = async () => {
  if (!modalPanelRef.value) return;
  try {
    if (document.fullscreenElement === modalPanelRef.value) {
      await document.exitFullscreen();
    } else {
      await modalPanelRef.value.requestFullscreen();
    }
  } catch (error) {
    console.warn('[RDP Modal] Browser fullscreen request failed:', error);
  }
};

// 开发环境由 Vite、部署环境由 Nginx 统一代理 /ws，避免 localhost 部署时误连未暴露的后端端口。
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const backendBaseUrl = `${wsProtocol}//${window.location.host}/ws`;

const handleConnection = async () => {
  if (!props.connection || !rdpDisplayRef.value) {
    statusMessage.value = t('remoteDesktopModal.errors.missingInfo');
    connectionStatus.value = 'error';
    return;
  }

  // Clear previous display and disconnect
  while (rdpDisplayRef.value.firstChild) {
    rdpDisplayRef.value.removeChild(rdpDisplayRef.value.firstChild);
  }
  disconnectGuacamole(); // Renamed from disconnectRdp

  connectionStatus.value = 'connecting';
  statusMessage.value = t('remoteDesktopModal.status.fetchingToken');

  try {
    let token: string | null = null;
    let tunnelUrl: string = '';
    const connectionsStore = useConnectionsStore();

    if (props.connection.type === 'RDP') {
      const apiUrl = `connections/${props.connection.id}/rdp-session`;
      const response = await apiClient.post<{ token: string }>(apiUrl);
      token = response.data?.token;
      if (!token) {
        throw new Error('RDP Token not found in API response');
      }
      statusMessage.value = t('remoteDesktopModal.status.connectingWs');

      await nextTick();
      let widthToSend = 800;
      let heightToSend = 600;
      const dpiToSend = 96;

      if (rdpContainerRef.value) {
        widthToSend = rdpContainerRef.value.clientWidth;
        heightToSend = rdpContainerRef.value.clientHeight - 1;
        widthToSend = Math.max(100, widthToSend);
        heightToSend = Math.max(100, heightToSend);
      }
      tunnelUrl = `${backendBaseUrl}/rdp-proxy?token=${encodeURIComponent(token)}&width=${widthToSend}&height=${heightToSend}&dpi=${dpiToSend}`;

    } else {
      throw new Error(`Unsupported connection type: ${props.connection.type}`);
    }

    const tunnel = new Guacamole.WebSocketTunnel(tunnelUrl);

    tunnel.onerror = (status: Status) => {
      const errorMessage = status.message || 'Unknown tunnel error';
      const errorCode = status.code || 'N/A';
      statusMessage.value = `${t('remoteDesktopModal.errors.tunnelError')} (${errorCode}): ${errorMessage}`;
      connectionStatus.value = 'error';
      disconnectGuacamole();
    };

    guacClient.value = new Guacamole.Client(tunnel);

    rdpDisplayRef.value.appendChild(guacClient.value.getDisplay().getElement());

    guacClient.value.onstatechange = (state: number) => {
      let currentStatus: ConnectionStatus | null = null;
      let i18nKeyPart = 'unknownState';

      switch (state) {
        case 0: // IDLE
          i18nKeyPart = 'idle';
          currentStatus = 'disconnected';
          break;
        case 1: // CONNECTING
          i18nKeyPart = 'connectingRdp';
          currentStatus = 'connecting';
          break;
        case 2: // WAITING
          i18nKeyPart = 'waiting';
          currentStatus = 'connecting';
          break;
        case 3: // CONNECTED
          i18nKeyPart = 'connected';
          currentStatus = 'connected';
          setupInputListeners();
          nextTick(() => {
            const displayEl = guacClient.value?.getDisplay()?.getElement();
            if (displayEl && typeof displayEl.focus === 'function') {
              displayEl.focus();
            }
            sendRemoteDisplaySize();
          });
          setTimeout(() => { // z-index fix for canvas
            nextTick(() => {
              if (rdpDisplayRef.value && guacClient.value) {
                const canvases = rdpDisplayRef.value.querySelectorAll('canvas');
                canvases.forEach((canvas) => { canvas.style.zIndex = '999'; });
              }
            });
          }, 100);
          break;
        case 4: // DISCONNECTING
          i18nKeyPart = 'disconnecting';
          currentStatus = 'disconnected'; // Or 'disconnecting'
          break;
        case 5: // DISCONNECTED
          i18nKeyPart = 'disconnected';
          currentStatus = 'disconnected';
          break;
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

  } catch (error: unknown) {
    const errorMessage = isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message || error.message
      : error instanceof Error ? error.message : String(error);
    statusMessage.value = `${t('remoteDesktopModal.errors.connectionFailed')}: ${errorMessage}`;
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
      console.log('[RemoteDesktopModal] Sent clipboard to RDP on display focus:', currentClipboardText.substring(0, 50) + (currentClipboardText.length > 50 ? '...' : ''));
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      // console.log('[RemoteDesktopModal] Clipboard read on display focus skipped: Document not focused or permission denied.');
    } else {
      console.warn('[RemoteDesktopModal] Could not read clipboard on display focus, or other error:', err);
    }
  }
};

const removeMobileKeyboardInput = () => {
  mobileKeyboardInput?.remove();
  mobileKeyboardInput = null;
};

const focusMobileKeyboard = () => {
  if (!hasTouchInput || !mobileKeyboardInput || connectionStatus.value !== 'connected') return;

  mobileKeyboardInput.value = '';
  mobileKeyboardInput.focus({ preventScroll: true });
  mobileKeyboardInput.click();
  mobileKeyboardInput.select();
};

const createMobileKeyboardInput = () => {
  removeMobileKeyboardInput();
  if (!hasTouchInput || !rdpContainerRef.value) return null;

  const input = document.createElement('textarea');
  input.dataset.testid = 'rdp-mobile-keyboard-input';
  input.setAttribute('aria-label', t('remoteDesktopModal.mobileKeyboardInputLabel'));
  input.setAttribute('inputmode', 'text');
  input.setAttribute('enterkeyhint', 'enter');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  input.tabIndex = -1;
  Object.assign(input.style, {
    position: 'fixed',
    left: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    fontSize: '16px',
    pointerEvents: 'none',
  });

  let isComposing = false;
  const clearValueAfterInput = () => {
    if (isComposing) return;
    queueMicrotask(() => {
      if (mobileKeyboardInput === input) input.value = '';
    });
  };
  input.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  input.addEventListener('compositionend', () => {
    isComposing = false;
    clearValueAfterInput();
  });
  input.addEventListener('input', clearValueAfterInput);
  input.addEventListener('focus', trySyncClipboardOnDisplayFocus);
  rdpContainerRef.value.appendChild(input);
  mobileKeyboardInput = input;
  return input;
};

const bindRemoteTouchInput = (displayEl: HTMLElement) => {
  remoteTouchInput?.destroy();
  remoteTouchInput = null;
  if (!guacClient.value) return;
  remoteTouchInput = attachRemoteTouchInput(
    displayEl,
    guacClient.value,
    remoteTouchMode.value,
    { onTap: focusMobileKeyboard },
  );
};

const setRemoteTouchMode = (mode: RemoteTouchMode) => {
  if (remoteTouchMode.value === mode) return;
  remoteTouchMode.value = mode;
  try {
    window.localStorage.setItem(REMOTE_TOUCH_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable in private browsing. The in-memory choice still applies.
  }

  if (connectionStatus.value !== 'connected') return;
  const displayEl = guacClient.value?.getDisplay()?.getElement();
  if (displayEl) bindRemoteTouchInput(displayEl);
};

const setupInputListeners = () => {
    if (!guacClient.value || !rdpDisplayRef.value) return;
    try {
        const displayEl = guacClient.value.getDisplay().getElement();
        displayEl.tabIndex = 0; // 使 RDP 显示区域可聚焦

        // 添加点击事件监听器以处理失焦逻辑
        const handleRdpDisplayClick = () => {
          const activeElement = document.activeElement;
          // 检查活动元素是否是宽度或高度输入框
          if (activeElement instanceof HTMLElement && (activeElement.id === 'modal-width' || activeElement.id === 'modal-height')) {
            activeElement.blur();
            console.log('[RDP Modal] Blurred input field on RDP display click.');
          }
          // Mobile browsers only open the system keyboard for a focused text
          // control. Keep desktop behavior unchanged.
          if (hasTouchInput) {
            focusMobileKeyboard();
          } else if (displayEl && typeof displayEl.focus === 'function') {
            displayEl.focus();
          }
        };
        displayEl.addEventListener('click', handleRdpDisplayClick);


        // 鼠标进入 RDP 区域时隐藏本地光标
        const handleMouseEnter = () => {
          if (displayEl) displayEl.style.cursor = 'none';
        };
        // 鼠标离开 RDP 区域时恢复本地光标
        const handleMouseLeave = () => {
          if (displayEl) displayEl.style.cursor = 'default';
        };
        displayEl.addEventListener('mouseenter', handleMouseEnter);
        displayEl.addEventListener('mouseleave', handleMouseLeave);



        mouse.value = new Guacamole.Mouse(displayEl);

        const display = guacClient.value.getDisplay();
        // 启用 Guacamole 的内置光标渲染
        display.showCursor(true);


        // 提高 Guacamole 光标图层的 z-index
        const cursorLayer = display.getCursorLayer(); // 获取光标图层
        if (cursorLayer) {
          const cursorElement = cursorLayer.getElement(); // 获取光标图层的 DOM 元素
          if (cursorElement) {
             cursorElement.style.zIndex = '1000'; // 设置 DOM 元素的 z-index
             console.log('[RDP Modal] Set cursor layer element z-index to 1000.');
          } else {
             console.warn('[RDP Modal] Could not get cursor layer element to set z-index.');
          }
        } else {
          console.warn('[RDP Modal] Could not get cursor layer to set z-index.');
        }



        mouse.value.onEach(['mousedown', 'mouseup', 'mousemove'], forwardMouseEvent);

        bindRemoteTouchInput(displayEl);

        keyboard.value = new Guacamole.Keyboard(displayEl); // 将监听器附加到 RDP 显示元素
        const mobileInput = createMobileKeyboardInput();
        if (mobileInput) keyboard.value.listenTo(mobileInput);

        keyboard.value.onkeydown = (keysym: number) => {
            // 仅当输入框未聚焦时发送按键事件
            if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(1, keysym);
            }
        };
        keyboard.value.onkeyup = (keysym: number) => {
             // 仅当输入框未聚焦时发送按键事件
             if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(0, keysym);
             }
        };
        
        // Listen for display focus to sync clipboard (Host -> RDP)
        displayEl.addEventListener('focus', trySyncClipboardOnDisplayFocus);

        // Listen for clipboard data from RDP (RDP -> Host)
        guacClient.value.onclipboard = async (stream, mimetype) => {
          if (mimetype === 'text/plain') {
            const reader = new Guacamole.StringReader(stream);
            let text = '';
            reader.ontext = (chunk: string) => {
              text += chunk;
            };
            reader.onend = async () => {
              try {
                await navigator.clipboard.writeText(text);
                console.log('[RemoteDesktopModal] Received clipboard from RDP and wrote to host:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
              } catch (err) {
                console.warn('[RemoteDesktopModal] Could not write to host clipboard:', err);
              }
            };
          }
        };

    } catch (inputError) {
        console.error("Error setting up input listeners:", inputError); // 添加错误日志
        statusMessage.value = t('remoteDesktopModal.errors.inputError');
    }
};

const removeInputListeners = () => {
    // 恢复光标并尝试移除监听器
    if (guacClient.value) {
        try {
            const displayEl = guacClient.value.getDisplay()?.getElement();
            if (displayEl) {
                // 恢复默认光标样式
                displayEl.style.cursor = 'default';
                displayEl.removeEventListener('focus', trySyncClipboardOnDisplayFocus);
            }
        } catch (e) {
             console.warn("Could not reset cursor or remove listeners on display element during listener removal:", e);
        }
    }

    remoteTouchInput?.destroy();
    remoteTouchInput = null;
    removeMobileKeyboardInput();

    // 清理 Guacamole 的键盘和鼠标对象
    if (keyboard.value) {
        keyboard.value.onkeydown = null;
        keyboard.value.onkeyup = null;
        keyboard.value = null;
    }
     if (mouse.value) {
        mouse.value.offEach(['mousedown', 'mouseup', 'mousemove'], forwardMouseEvent);
        mouse.value = null;
    }
    // 清理剪贴板监听器
    if (guacClient.value) {
        guacClient.value.onclipboard = null;
    }
};

const forwardMouseEvent = (event: GuacamoleEvent) => {
  if (event instanceof Guacamole.Mouse.Event && guacClient.value) {
    guacClient.value.sendMouseState(event.state);
  }
};

const disableRdpKeyboard = () => {
  isKeyboardDisabledForInput.value = true;
  console.log('[RDP Modal] Keyboard disabled for input focus.');
};

const enableRdpKeyboard = () => {
  isKeyboardDisabledForInput.value = false;
  console.log('[RDP Modal] Keyboard enabled after input blur.');
  // 尝试将焦点移回 RDP 显示区域
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
  isKeyboardDisabledForInput.value = false; // 确保状态重置
  if (guacClient.value) {
    guacClient.value.disconnect();
    guacClient.value = null;
  }
  if (rdpDisplayRef.value) {
      while (rdpDisplayRef.value.firstChild) {
          rdpDisplayRef.value.removeChild(rdpDisplayRef.value.firstChild);
      }
  }
  if (connectionStatus.value !== 'error') {
      connectionStatus.value = 'disconnected';
      statusMessage.value = t('remoteDesktopModal.status.disconnected');
  }
};


const closeModal = async () => {
  if (document.fullscreenElement === modalPanelRef.value) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn('[RDP Modal] Failed to exit fullscreen while closing:', error);
    }
  }
  disconnectGuacamole();
  emit('close');
};

const handleWidthInputBlur = () => {
  const currentValue = Number(tempInputWidth.value) || MIN_MODAL_WIDTH;
  const validatedValue = Math.min(Math.max(MIN_MODAL_WIDTH, currentValue), maxAllowedWidth.value);

  desiredModalWidth.value = validatedValue;
  tempInputWidth.value = validatedValue;
  modalWidthSaver.schedule(String(validatedValue));
  enableRdpKeyboard();
};

const handleHeightInputBlur = () => {
  const currentValue = Number(tempInputHeight.value) || MIN_MODAL_HEIGHT;
  const validatedValue = Math.min(Math.max(MIN_MODAL_HEIGHT, currentValue), maxAllowedHeight.value);

  desiredModalHeight.value = validatedValue;
  tempInputHeight.value = validatedValue;
  modalHeightSaver.schedule(String(validatedValue));
  enableRdpKeyboard();
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

// 组件挂载或设置更改时从设置存储加载初始尺寸
watchEffect(() => {
  const storeWidth = settingsStore.settings.rdpModalWidth;
  const storeHeight = settingsStore.settings.rdpModalHeight;
  console.log(`[RDP 模态框] 从存储加载尺寸 - 宽度: ${storeWidth}, 高度: ${storeHeight}`);
 
  // 如果存储中有默认值则使用，否则使用组件默认值
  const initialWidth = storeWidth ? parseInt(storeWidth, 10) : desiredModalWidth.value; // 使用当前 ref 值作为备用默认值
  const initialHeight = storeHeight ? parseInt(storeHeight, 10) : desiredModalHeight.value; // 使用当前 ref 值作为备用默认值

  // 根据最小值进行验证
  const finalWidth = Math.min(Math.max(MIN_MODAL_WIDTH, isNaN(initialWidth) ? MIN_MODAL_WIDTH : initialWidth), maxAllowedWidth.value);
  const finalHeight = Math.min(Math.max(MIN_MODAL_HEIGHT, isNaN(initialHeight) ? MIN_MODAL_HEIGHT : initialHeight), maxAllowedHeight.value);
  console.log(`[RDP 模态框] 应用验证后的尺寸 - 宽度: ${finalWidth}, 高度: ${finalHeight}`);
  desiredModalWidth.value = finalWidth;
  desiredModalHeight.value = finalHeight;
  tempInputWidth.value = finalWidth;
  tempInputHeight.value = finalHeight;
 });
  
onMounted(() => {
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  window.addEventListener('keydown', handleFullscreenKeydown, true);
  if (rdpContainerRef.value && typeof ResizeObserver !== 'undefined') {
    displayResizeObserver = new ResizeObserver(() => sendRemoteDisplaySize());
    displayResizeObserver.observe(rdpContainerRef.value);
  }
  if (Number(tempInputWidth.value) !== desiredModalWidth.value) {
    tempInputWidth.value = desiredModalWidth.value;
  }
  if (Number(tempInputHeight.value) !== desiredModalHeight.value) {
    tempInputHeight.value = desiredModalHeight.value;
  }

  if (props.connection) {
    nextTick(async () => {
        await handleConnection(); // 使用初始尺寸连接
        // 不再需要设置 observer
    });
  } else {
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

onUnmounted(() => {
  modalWidthSaver.dispose({ flush: true });
  modalHeightSaver.dispose({ flush: true });
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  window.removeEventListener('keydown', handleFullscreenKeydown, true);
  displayResizeObserver?.disconnect();
  displayResizeObserver = null;
  if (sendSizeAnimationFrame !== null) {
    window.cancelAnimationFrame(sendSizeAnimationFrame);
    sendSizeAnimationFrame = null;
  }
  disconnectGuacamole(); // 这里已经调用了 removeInputListeners
});

watch(() => props.connection, (newConnection, oldConnection) => {
  if (newConnection && newConnection.id !== oldConnection?.id) {
     nextTick(async () => {
        await handleConnection(); // 使用初始尺寸连接
        // 不再需要设置 observer
     });
  } else if (!newConnection) {
      disconnectGuacamole();
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

// 直接使用所需的模态框尺寸作为样式
const computedModalStyle = computed(() => {

  if (isBrowserFullscreen.value) {
    return {
      width: '100vw',
      height: '100vh',
    };
  }

  // 在此处为实际模态框样式应用最小约束
  const actualWidth = Math.min(Math.max(MIN_MODAL_WIDTH, desiredModalWidth.value), maxAllowedWidth.value);
  const actualHeight = Math.min(Math.max(MIN_MODAL_HEIGHT, desiredModalHeight.value), maxAllowedHeight.value);
  return {
    width: `${actualWidth}px`,
    height: `${actualHeight}px`,
  };
});

// Watch for modal size changes to update Guacamole client
watch(computedModalStyle, () => nextTick(sendRemoteDisplaySize));

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
    data-testid="remote-desktop-modal"
    :class="[
      'fixed inset-0 z-50 flex items-center justify-center',
      isBrowserFullscreen ? 'p-0' : 'p-4',
      isMinimized ? '' : 'bg-overlay',
      isMinimized ? 'pointer-events-none' : '' // 允许恢复按钮接收事件
    ]"
  >
    <button
      ref="restoreButtonRef"
      data-testid="rdp-window-restore"
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
      ref="modalPanelRef"
      data-testid="remote-desktop-panel"
      v-show="!isMinimized"
      :style="computedModalStyle"
      :class="[
        'rdp-panel bg-background text-foreground flex flex-col overflow-hidden pointer-events-auto relative',
        isBrowserFullscreen ? 'rdp-panel-fullscreen rounded-none border-0 shadow-none bg-black' : 'rounded-lg border border-border shadow-xl'
      ]"
    >
      <div v-show="!isBrowserFullscreen" data-testid="rdp-window-header" class="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <h3 class="text-base font-semibold truncate">
          <i class="fas fa-desktop mr-2 text-text-secondary"></i>
          {{ t('remoteDesktopModal.title') }} - {{ props.connection?.name || props.connection?.host || t('remoteDesktopModal.titlePlaceholder') }}
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
                data-testid="rdp-browser-fullscreen"
                @click="toggleBrowserFullscreen"
                class="text-text-secondary hover:text-foreground transition-colors duration-150 p-1 rounded hover:bg-hover"
                :title="isBrowserFullscreen ? t('common.exitFullscreen', '退出全屏') : t('common.fullscreen', '网页全屏')"
            >
                <i :class="isBrowserFullscreen ? 'fas fa-compress fa-sm' : 'fas fa-expand fa-sm'"></i>
            </button>
            <button
                data-testid="rdp-window-minimize"
                @click="minimizeModal"
                class="text-text-secondary hover:text-foreground transition-colors duration-150 p-1 rounded hover:bg-hover"
                :title="t('common.minimize')"
            >
                <i class="fas fa-window-minimize fa-sm"></i>
            </button>
             <button
                data-testid="rdp-window-close"
                @click="closeModal"
                class="text-text-secondary hover:text-foreground transition-colors duration-150 p-1 rounded hover:bg-hover"
                :title="t('common.close')"
             >
                <i class="fas fa-times fa-lg"></i>
             </button>
        </div>
      </div>

      <div ref="rdpContainerRef" class="relative bg-black overflow-hidden flex-1">
        <div ref="rdpDisplayRef" data-testid="rdp-display-container" class="rdp-display-container w-full h-full">
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

       <div v-show="!isBrowserFullscreen" data-testid="rdp-window-footer" class="p-2 border-t border-border flex-shrink-0 text-xs text-text-secondary bg-header flex items-center justify-between gap-2 flex-wrap">
         <div v-if="hasTouchInput" class="flex min-w-0 flex-col gap-1">
           <div class="flex items-center gap-1.5">
             <span class="shrink-0 text-[11px] text-text-muted">
               {{ t('remoteDesktopModal.touchModeLabel') }}
             </span>
             <div
               class="inline-flex overflow-hidden rounded border border-border"
               role="group"
               :aria-label="t('remoteDesktopModal.touchModeLabel')"
             >
               <button
                 type="button"
                 data-testid="rdp-touch-mode-direct"
                 class="px-2 py-1 text-[11px] transition-colors"
                 :class="remoteTouchMode === 'direct' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-hover'"
                 :aria-pressed="remoteTouchMode === 'direct'"
                 :title="t('remoteDesktopModal.touchHintDirect')"
                 @click="setRemoteTouchMode('direct')"
               >
                 <i class="fas fa-hand-pointer mr-1" aria-hidden="true"></i>
                 {{ t('remoteDesktopModal.touchModeDirect') }}
               </button>
               <button
                 type="button"
                 data-testid="rdp-touch-mode-touchpad"
                 class="border-l border-border px-2 py-1 text-[11px] transition-colors"
                 :class="remoteTouchMode === 'touchpad' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-hover'"
                 :aria-pressed="remoteTouchMode === 'touchpad'"
                 :title="t('remoteDesktopModal.touchHintTouchpad')"
                 @click="setRemoteTouchMode('touchpad')"
               >
                 <i class="fas fa-arrows-up-down-left-right mr-1" aria-hidden="true"></i>
                 {{ t('remoteDesktopModal.touchModeTouchpad') }}
               </button>
             </div>
           </div>
           <span data-testid="rdp-touch-hint" class="text-[10px] leading-tight text-text-muted">
             {{ t(remoteTouchMode === 'direct' ? 'remoteDesktopModal.touchHintDirect' : 'remoteDesktopModal.touchHintTouchpad') }}
           </span>
         </div>
         <div class="flex items-center space-x-2 flex-wrap gap-y-1 ml-auto">
            <label for="modal-width" class="text-xs ml-2">{{ t('common.width') }}:</label>
            <input
              id="modal-width"
              type="number"
              v-model.number="tempInputWidth"
              step="10"
              class="w-16 px-1 py-0.5 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              @focus="disableRdpKeyboard"
              @blur="handleWidthInputBlur"
            />
            <label for="modal-height" class="text-xs">{{ t('common.height') }}:</label>
            <input
              id="modal-height"
              type="number"
              v-model.number="tempInputHeight"
              step="10"
              class="w-16 px-1 py-0.5 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              @focus="disableRdpKeyboard"
              @blur="handleHeightInputBlur"
            />
             <!-- 添加重新连接按钮 -->
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
         v-if="!isBrowserFullscreen"
         data-testid="rdp-window-resize"
         class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10 bg-transparent hover:bg-primary-dark hover:bg-opacity-30"
         title="Resize"
         @pointerdown.stop="initResize"
       ></div>
   </div>
 </div>
</template>
<style scoped>
.rdp-panel:fullscreen,
.rdp-panel-fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: #000;
}

.rdp-display-container {
  overflow: hidden;
  position: relative;
}

.rdp-panel-fullscreen .rdp-display-container {
  width: 100vw;
  height: 100vh;
}

.rdp-display-container :deep(div) {
}

.rdp-display-container :deep(canvas) {
  z-index: 999;
}
</style>
