<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useLayoutStore, type LayoutNode } from '../stores/layout.store'; // +++ Import LayoutNode +++
import { useDeviceDetection } from '../composables/useDeviceDetection';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import AddConnectionFormComponent from '../components/AddConnectionForm.vue';
import TerminalTabBar from '../components/TerminalTabBar.vue';
import LayoutRenderer from '../components/LayoutRenderer.vue';
import LayoutConfigurator from '../components/LayoutConfigurator.vue';
import CommandInputBar from '../components/CommandInputBar.vue'; 
import VirtualKeyboard from '../components/VirtualKeyboard.vue';
import FileManager from '../components/FileManager.vue'; 
import { useSessionStore } from '../stores/session.store';
import type { SessionTabInfoWithStatus, SshTerminalInstance } from '../stores/session/types';
import { useSettingsStore } from '../stores/settings.store';
import { useFileEditorStore, type FileTab } from '../stores/fileEditor.store';
import { useCommandHistoryStore } from '../stores/commandHistory.store';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import type { ISearchOptions } from '@xterm/addon-search';
import {
  useWorkspaceEventSubscriber,
  useWorkspaceEventOff,
  type WorkspaceEventPayloads
} from '../composables/workspaceEvents';
import type { WebSocketDependencies } from '../composables/useSftpActions'; 
import { applyTerminalModifiers } from '../utils/terminalModifiers';

// --- Setup ---
const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore(); // Keep settingsStore instance
const fileEditorStore = useFileEditorStore();
const layoutStore = useLayoutStore();
const commandHistoryStore = useCommandHistoryStore();
const connectionsStore = useConnectionsStore(); 
const { isHeaderVisible } = storeToRefs(layoutStore);
const { isMobile } = useDeviceDetection();

// 提前加载普通文本编辑器核心，避免首次打开无后缀/纯文本文件时才发起多个动态 import。
// 具体语言包仍保持按需加载，不在这里预取。
const preloadPlainTextEditor = () => {
  const preloadTasks: Promise<unknown>[] = [
    import('../components/FileEditorContainer.vue'),
    import('../components/FileEditorOverlay.vue'),
    isMobile.value
      ? import('../components/CodeMirrorMobileEditor.vue')
      : import('../components/MonacoEditor.vue'),
  ];

  void Promise.allSettled(preloadTasks).then((results) => {
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[WorkspaceView] 编辑器核心预加载有 ${failed.length} 个模块失败，将在实际打开文件时再次尝试。`, failed);
    }
  });
};

// --- 从 Store 获取响应式状态和 Getters ---
const { sessionTabsWithStatus, activeSessionId, activeSession, isRdpModalOpen, rdpConnectionInfo, isVncModalOpen, vncConnectionInfo } = storeToRefs(sessionStore); // 使用 storeToRefs 获取 RDP 和 VNC 状态
const { shareFileEditorTabsBoolean, layoutLockedBoolean } = storeToRefs(settingsStore); // +++ Add layoutLockedBoolean +++
const { orderedTabs: globalEditorTabs, activeTabId: globalActiveEditorTabId } = storeToRefs(fileEditorStore);
const { layoutTree } = storeToRefs(layoutStore); // 只获取布局树

// --- 计算属性 (用于动态绑定编辑器 Props) ---
// 这些计算属性现在需要传递给 LayoutRenderer
const editorTabs = computed((): FileTab[] => { // Ensure return type is FileTab[]
  if (shareFileEditorTabsBoolean.value) {
    return globalEditorTabs.value;
  } else {
    return activeSession.value?.editorTabs.value ?? [];
  }
});

const activeEditorTabId = computed(() => {
  if (shareFileEditorTabsBoolean.value) {
    return globalActiveEditorTabId.value;
  } else {
    return activeSession.value?.activeEditorTabId.value ?? null;
  }
});

// +++ Add computed property for mobile terminal layout node +++
const mobileLayoutNodeForTerminal = computed((): LayoutNode | null => {
  return {
    id: 'mobile-main-terminal-pane',
    type: 'pane' as const,
    component: 'terminal' as const,
    size: 100,
  };
});

// --- UI 状态 (保持本地) ---
const showAddEditForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const showLayoutConfigurator = ref(false); // 控制布局配置器可见性
// 本地 RDP 状态已被移除

// --- 搜索状态 ---
const currentSearchTerm = ref(''); // 当前搜索的关键词
const isVirtualKeyboardVisible = ref(false); 
const isVirtualCtrlActive = ref(false);
const isVirtualAltActive = ref(false);

const clearVirtualModifiers = () => {
  isVirtualCtrlActive.value = false;
  isVirtualAltActive.value = false;
};

const toggleVirtualModifier = (modifier: 'ctrl' | 'alt') => {
  if (modifier === 'ctrl') isVirtualCtrlActive.value = !isVirtualCtrlActive.value;
  else isVirtualAltActive.value = !isVirtualAltActive.value;
  // 不主动聚焦输入框：手机上 focus 会唤起系统软键盘，与应用快捷键栏叠加后挤压终端。
};

const subscribeToWorkspaceEvents = useWorkspaceEventSubscriber();
const unsubscribeFromWorkspaceEvents = useWorkspaceEventOff();
const workspaceEventCleanups: Array<() => void> = [];
const subscribeWorkspaceEvent = <K extends keyof WorkspaceEventPayloads>(
  type: K,
  handler: (payload: WorkspaceEventPayloads[K]) => void,
) => {
  subscribeToWorkspaceEvents(type, handler as any);
  workspaceEventCleanups.push(() => unsubscribeFromWorkspaceEvents(type, handler as any));
};

// --- 文件管理器模态框状态 ---
const showFileManagerModal = ref(false);
const fileManagerPropsMap = shallowRef<Map<string, {
  sessionId: string;
  instanceId: string;
  dbConnectionId: string;
  wsDeps: WebSocketDependencies;
}>>(new Map());
const currentFileManagerSessionId = ref<string | null>(null);

// --- 处理全局键盘事件 ---
const handleGlobalKeyDown = (event: KeyboardEvent) => {
  // 检查是否按下了 Alt 键以及上/下箭头键
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault(); // 阻止默认行为 (例如页面滚动)

    const tabs = sessionTabsWithStatus.value;
    const currentId = activeSessionId.value;

    if (!tabs || tabs.length <= 1 || !currentId) {
      // 如果没有标签页、只有一个标签页或没有活动标签页，则不执行任何操作
      return;
    }

    const currentIndex = tabs.findIndex(tab => tab.sessionId === currentId);
    if (currentIndex === -1) {
      // 如果找不到当前活动标签页 (理论上不应发生)，则不执行任何操作
      return;
    }

    let nextIndex: number;
    if (event.key === 'ArrowDown') {
      // Alt + 下箭头：切换到下一个标签页
      nextIndex = (currentIndex + 1) % tabs.length;
    } else {
      // Alt + 上箭头：切换到上一个标签页
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }

    const nextSessionId = tabs[nextIndex].sessionId;
    if (nextSessionId !== currentId) {
      console.log(`[WorkspaceView] Alt+${event.key} detected. Switching to session: ${nextSessionId}`);
      sessionStore.activateSession(nextSessionId);
    }
  }
};

// --- 生命周期钩子 ---
onMounted(() => {
  console.log('[工作区视图] 组件已挂载。');
  preloadPlainTextEditor();
  // 添加键盘事件监听器
  window.addEventListener('keydown', handleGlobalKeyDown);
  // 移动端高度交给 CSS dvh；不要跟随 visualViewport 的软键盘缩放反复压缩工作区。
  // 确保布局已初始化 (layoutStore 内部会处理)

  // +++ 订阅工作区事件 +++
  subscribeWorkspaceEvent('terminal:sendCommand', (payload) => handleSendCommand(payload.command, payload.sessionId));
  subscribeWorkspaceEvent('terminal:input', handleTerminalInput);
  subscribeWorkspaceEvent('terminal:resize', handleTerminalResize);
  subscribeWorkspaceEvent('terminal:ready', handleTerminalReady);
  subscribeWorkspaceEvent('terminal:detached', handleTerminalDetached);
  subscribeWorkspaceEvent('terminal:clear', handleClearTerminal);
  subscribeWorkspaceEvent('terminal:scrollToBottomRequest', handleScrollToBottomRequest);

  subscribeWorkspaceEvent('editor:closeTab', (payload) => handleCloseEditorTab(payload.tabId));
  subscribeWorkspaceEvent('editor:activateTab', (payload) => handleActivateEditorTab(payload.tabId));
  subscribeWorkspaceEvent('editor:updateContent', handleUpdateEditorContent);
  subscribeWorkspaceEvent('editor:saveTab', (payload) => handleSaveEditorTab(payload.tabId));
  subscribeWorkspaceEvent('editor:changeEncoding', handleChangeEncoding);
  subscribeWorkspaceEvent('editor:closeOtherTabs', (payload) => handleCloseOtherEditorTabs(payload.tabId));
  subscribeWorkspaceEvent('editor:closeTabsToRight', (payload) => handleCloseEditorTabsToRight(payload.tabId));
  subscribeWorkspaceEvent('editor:closeTabsToLeft', (payload) => handleCloseEditorTabsToLeft(payload.tabId));
  subscribeWorkspaceEvent('editor:updateScrollPosition', handleEditorScrollPositionUpdate); // +++ 订阅滚动位置更新事件 +++
 
  // 移除对 connection:connect 事件的监听，以避免重复创建会话
  // subscribeWorkspaceEvent('connection:connect', (payload) => handleConnectRequest(payload.connectionId));
  subscribeWorkspaceEvent('connection:openNewSession', (payload) => handleOpenNewSession(payload.connectionId));
  subscribeWorkspaceEvent('connection:requestAdd', handleRequestAddConnection);
  subscribeWorkspaceEvent('connection:requestEdit', (payload) => handleRequestEditConnection(payload.connectionInfo));

  subscribeWorkspaceEvent('search:start', (payload) => handleSearch(payload.term));
  subscribeWorkspaceEvent('search:findNext', handleFindNext);
  subscribeWorkspaceEvent('search:findPrevious', handleFindPrevious);
  subscribeWorkspaceEvent('search:close', handleCloseSearch);

  // 来自 TerminalTabBar 的事件
  subscribeWorkspaceEvent('session:activate', (payload) => sessionStore.activateSession(payload.sessionId));
  subscribeWorkspaceEvent('session:close', (payload) => sessionStore.closeSession(payload.sessionId));
  subscribeWorkspaceEvent('session:closeOthers', (payload) => handleCloseOtherSessions(payload.targetSessionId));
  subscribeWorkspaceEvent('session:closeToRight', (payload) => handleCloseSessionsToRight(payload.targetSessionId));
  subscribeWorkspaceEvent('session:closeToLeft', (payload) => handleCloseSessionsToLeft(payload.targetSessionId));
  subscribeWorkspaceEvent('ui:openLayoutConfigurator', handleOpenLayoutConfigurator);
  subscribeWorkspaceEvent('fileManager:openModalRequest', handleFileManagerOpenRequest); // +++ 订阅文件管理器打开请求 +++
  subscribeWorkspaceEvent('quickCommand:executeProcessed', handleQuickCommandExecuteProcessed);
});

onBeforeUnmount(() => {
  console.log('[工作区视图] 组件即将卸载，清理工作区事件监听...');
  window.removeEventListener('keydown', handleGlobalKeyDown);

  while (workspaceEventCleanups.length > 0) {
    const cleanup = workspaceEventCleanups.pop();
    try {
      cleanup?.();
    } catch (error) {
      console.error('[WorkspaceView] 清理工作区事件监听失败:', error);
    }
  }
});


 // --- 本地方法 (仅处理 UI 状态) ---
 const handleRequestAddConnection = () => {
   console.log('[WorkspaceView] handleRequestAddConnection 被调用！');
   connectionToEdit.value = null;
   showAddEditForm.value = true;
 };

 const handleRequestEditConnection = (connection: ConnectionInfo) => {
   connectionToEdit.value = connection;
   showAddEditForm.value = true;
 };

 const handleFormClose = () => {
   showAddEditForm.value = false;
   connectionToEdit.value = null;
 };

 const handleConnectionAdded = () => {
   console.log('[工作区视图] 连接已添加');
   handleFormClose();
 };

 const handleConnectionUpdated = () => {
   console.log('[工作区视图] 连接已更新');
   handleFormClose();
 };

 // 处理打开和关闭布局配置器
 const handleOpenLayoutConfigurator = () => {
   showLayoutConfigurator.value = true;
 };
 const handleCloseLayoutConfigurator = () => {
   showLayoutConfigurator.value = false;
 };

 // --- 事件处理 (传递给 LayoutRenderer 或直接使用) ---

 // 处理命令发送 (用于 CommandBar, CommandHistory, QuickCommands)
 const handleSendCommand = (command: string, targetSessionId?: string) => {
   const sessionToCommand = targetSessionId ? sessionStore.sessions.get(targetSessionId) : activeSession.value;

   if (!sessionToCommand) {
     const idForLog = targetSessionId || 'active (none found)';
     console.warn(`[WorkspaceView] Cannot send command, no session found for ID: ${idForLog}.`);
     return;
   }
   const terminalManager = sessionToCommand.terminalManager as (SshTerminalInstance | undefined);

   // workspace 路由可能早于 SSH shell 真正 ready。首次握手完成前直接忽略所有命令入口，
   // 避免快捷指令/历史命令等旁路绕过 CommandInputBar 的 disabled 状态。
   if (terminalManager && !terminalManager.isSshConnected.value && !terminalManager.hasSshConnectedOnce.value) {
     console.log(`[WorkspaceView] Ignoring command while initial SSH connection is still pending for session ${sessionToCommand.sessionId}.`);
     return;
   }

   if (terminalManager?.isSshConnected && !terminalManager.isSshConnected.value && command.trim() === '') {
     console.log(`[WorkspaceView] Command bar Enter detected in disconnected session ${sessionToCommand.sessionId}, attempting reconnect...`);
     if (terminalManager.terminalInstance?.value) {
         terminalManager.terminalInstance.value.writeln(`\r\n\x1b[33m${t('workspace.terminal.reconnectingMsg')}\x1b[0m`);
     }
     const connectionInfo = connectionsStore.connections.find(c => c.id === Number(sessionToCommand.connectionId));
     if (connectionInfo) {
       sessionStore.handleConnectRequest(connectionInfo);
     } else {
       console.error(`[WorkspaceView] handleSendCommand: 未找到 ID 为 ${sessionToCommand.connectionId} 的连接信息。`);
     }
     return;
   }

   if (terminalManager && typeof terminalManager.sendData === 'function') {
     const commandToSend = command.trim(); // Keep trimmed for history
     console.log(`[WorkspaceView] Sending command/data to session ${sessionToCommand.sessionId}: ${JSON.stringify(command)}`); // Log raw command
     // Only append '\r' for regular commands, not for control characters like Ctrl+C (\x03)
     // Send the raw command as received by the function for control characters
     const dataToSend = command === '\x03' ? command : command + '\r';
     terminalManager.sendData(dataToSend);

     // Add to history only if it's a user-typed command (not just Enter or control chars)
     // And only if the command is being sent to the active session (to avoid polluting history from "send to all")
     if (commandToSend.length > 0 && command !== '\x03' && sessionToCommand.sessionId === activeSessionId.value) {
       commandHistoryStore.addCommand(commandToSend);
     }
   } else {
     console.warn(`[WorkspaceView] Cannot send command for session ${sessionToCommand.sessionId}, terminal manager or sendData method not available.`);
   }
 };

 // 处理终端输入 (用于 Terminal)
 // 注意：LayoutRenderer 内部的 Terminal 组件需要 emit('terminal-input', sessionId, data)
 const handleTerminalInput = (payload: { sessionId: string; data: string }) => {
   const resolvedSessionId = sessionStore.resolveSessionId(payload.sessionId);
   let data = payload.data;
   if (isMobile.value && resolvedSessionId === activeSessionId.value && (isVirtualCtrlActive.value || isVirtualAltActive.value)) {
     const modifiedData = applyTerminalModifiers(data, {
       ctrl: isVirtualCtrlActive.value,
       alt: isVirtualAltActive.value,
     });
     if (modifiedData !== null) {
       data = modifiedData;
       clearVirtualModifiers();
     }
   }
   const session = sessionStore.sessions.get(resolvedSessionId);
   const manager = session?.terminalManager as (SshTerminalInstance | undefined);
   if (!session || !manager) {
     console.warn(`[WorkspaceView] handleTerminalInput: 未找到会话 ${payload.sessionId}（解析为 ${resolvedSessionId}）或其 terminalManager`);
     return;
   }
   const wsStatus = session.wsManager.connectionStatus.value;

   // 初次 SSH 握手期间丢弃终端输入，不把它误判成“断线后的任意键重连”。
   // 只有至少成功连接过一次后，下面的 reconnectNow 路径才生效。
   if (!manager.isSshConnected.value && !manager.hasSshConnectedOnce.value) {
     return;
   }

   // 已标记挂起的会话断开后，SSH 可能已被后端接管。此时输入只能触发挂起恢复，
   // 不能走普通 reconnect，否则会建立一个全新的 SSH 并丢失原终端上下文。
   if (data.length > 0 && wsStatus !== 'connected' && session.isMarkedForSuspend) {
     console.log(`[WorkspaceView] 标记挂起会话 ${resolvedSessionId} 收到输入，优先尝试恢复后端挂起会话。`);
     void sessionStore.recoverMarkedSshSessionsAfterForeground();
     return;
   }

   // 未标记的普通断线保持原有行为：任意键立即打断自动重连退避。
   const shouldReconnect = data.length > 0 && wsStatus !== 'connected';
   if (shouldReconnect) {
     console.log(`[WorkspaceView] 检测到断开的会话 ${resolvedSessionId} 收到键盘输入，尝试重连...`);
     if (manager.terminalInstance?.value) {
       manager.terminalInstance.value.writeln(`\r\n\x1b[33m${t('workspace.terminal.reconnectingMsg')}\x1b[0m`);
     } else {
       console.warn(`[WorkspaceView] 无法写入重连提示，terminalInstance 不可用。`);
     }
     session.wsManager.reconnectNow();
     return;
   }

   manager.handleTerminalData(data);
 };

 // 处理终端大小调整 (用于 Terminal)
 // 注意：LayoutRenderer 内部的 Terminal 组件需要 emit('terminal-resize', sessionId, dims)
 const handleTerminalResize = (payload: { sessionId: string; dims: { cols: number; rows: number } }) => {
    const resolvedSessionId = sessionStore.resolveSessionId(payload.sessionId);
    sessionStore.sessions.get(resolvedSessionId)?.terminalManager.handleTerminalResize(payload.dims);
 };

 // 处理终端就绪 (用于 Terminal)
 // 注意：LayoutRenderer 内部的 Terminal 组件需要 emit('terminal-ready', payload)
 // *** 修正：更新 payload 类型以包含 searchAddon ***
 const handleTerminalReady = (payload: { sessionId: string; terminal: XtermTerminal; searchAddon: any | null }) => { // --- 使用重命名的 XtermTerminal ---
    console.log(`[工作区视图 ${payload.sessionId}] 收到 terminal-ready 事件。Payload:`, payload); // *** 添加 Payload 日志 ***
    // *** 检查 payload 中 searchAddon 是否存在 ***
    if (payload && payload.searchAddon) {
        console.log(`[工作区视图 ${payload.sessionId}] Payload 包含 searchAddon 实例。`);
    } else {
        console.warn(`[工作区视图 ${payload.sessionId}] Payload 未包含 searchAddon 实例！ Payload:`, payload);
    }
    // sessionId 可能刚被后端重键；通过 alias 找到同一个 SessionState，避免新终端挂载后丢失缓存输出。
    const resolvedSessionId = sessionStore.resolveSessionId(payload.sessionId);
    sessionStore.sessions.get(resolvedSessionId)?.terminalManager.handleTerminalReady(payload);
};

 const handleTerminalDetached = (payload: { sessionId: string; terminal: XtermTerminal; snapshot?: string }) => {
    const resolvedSessionId = sessionStore.resolveSessionId(payload.sessionId);
    const session = sessionStore.sessions.get(resolvedSessionId);
    if (!session) return;
    // sessionActions 在重键前会主动抓取当前终端 snapshot 放进 pendingOutput。
    // 旧组件随后触发 detached 时不要再次缓存同一份 snapshot，否则新终端会重复回放。
    if (resolvedSessionId !== payload.sessionId && (session.pendingOutput?.length ?? 0) > 0) return;
    session.terminalManager.handleTerminalDetached(payload);
 };


// --- 搜索事件处理 ---
const handleSearch = (term: string) => { // +++ 修改 +++
  currentSearchTerm.value = term;
  if (!term) {
    // 如果搜索词为空，清除搜索
    handleCloseSearch();
    return;
  }
  console.log(`[WorkspaceView] Received search event: "${term}"`);
  // 默认向前搜索
  // 触发 findNext
  handleFindNext(); // 保持调用 findNext，内部会处理 isMobile
};

const handleFindNext = () => {
  const manager = activeSession.value?.terminalManager;
  if (manager && currentSearchTerm.value) {
    const mode = isMobile.value ? 'Mobile' : 'Desktop';
    console.log(`[WorkspaceView ${mode}] Calling findNext for term: "${currentSearchTerm.value}"`);
    const found = manager.searchNext(currentSearchTerm.value, { incremental: true });
    console.log(`[WorkspaceView ${mode}] findNext returned: ${found}`);
    if (!found) {
      console.log(`[WorkspaceView ${mode}] findNext: No more results for "${currentSearchTerm.value}"`);
    }
  } else {
    const mode = isMobile.value ? 'Mobile' : 'Desktop';
    console.warn(`[WorkspaceView ${mode}] Cannot findNext, no active session manager or search term.`);
  }
};

const handleFindPrevious = () => {
  const manager = activeSession.value?.terminalManager;
  if (manager && currentSearchTerm.value) {
    const mode = isMobile.value ? 'Mobile' : 'Desktop';
    console.log(`[WorkspaceView ${mode}] Calling findPrevious for term: "${currentSearchTerm.value}"`);
    const found = manager.searchPrevious(currentSearchTerm.value, { incremental: true });
    console.log(`[WorkspaceView ${mode}] findPrevious returned: ${found}`);
    if (!found) {
      console.log(`[WorkspaceView ${mode}] findPrevious: No previous results for "${currentSearchTerm.value}"`);
    }
  } else {
    const mode = isMobile.value ? 'Mobile' : 'Desktop';
    console.warn(`[WorkspaceView ${mode}] Cannot findPrevious, no active session manager or search term.`);
  }
};

const handleCloseSearch = () => {
  console.log(`[WorkspaceView] Received close-search event.`);
  currentSearchTerm.value = ''; // 清空搜索词
  const manager = activeSession.value?.terminalManager;
  const mode = isMobile.value ? 'Mobile' : 'Desktop';
  if (manager) {
    manager.clearTerminalSearch();
    console.log(`[WorkspaceView ${mode}] Search cleared.`);
  } else {
    console.warn(`[WorkspaceView ${mode}] Cannot clear search, no active session manager.`);
  }
};

// +++ 处理清空终端事件 +++
const handleClearTerminal = () => {
  const currentSession = activeSession.value;
  if (!currentSession) {
    console.warn('[WorkspaceView] Cannot clear terminal, no active session.');
    return;
  }
  const terminalManager = currentSession.terminalManager as (SshTerminalInstance | undefined);
  const mode = isMobile.value ? 'Mobile' : 'Desktop';

  if (terminalManager && terminalManager.terminalInstance?.value && typeof terminalManager.terminalInstance.value.clear === 'function') {
    console.log(`[WorkspaceView ${mode}] Clearing terminal for active session ${currentSession.sessionId}`);
    terminalManager.terminalInstance.value.clear();
  } else {
    console.warn(`[WorkspaceView ${mode}] Cannot clear terminal for session ${currentSession.sessionId}, terminal manager, instance, or clear method not available.`);
  }
};

// +++ 处理滚动到底部请求 +++
const handleScrollToBottomRequest = (payload: { sessionId: string }) => {
  const resolvedSessionId = sessionStore.resolveSessionId(payload.sessionId);
  const session = sessionStore.sessions.get(resolvedSessionId);
  const terminalManager = session?.terminalManager as (SshTerminalInstance | undefined);
  if (terminalManager?.terminalInstance?.value) {
    console.log(`[WorkspaceView] Scrolling to bottom for session ${payload.sessionId}`);
    terminalManager.terminalInstance.value.scrollToBottom();
  } else {
    console.warn(`[WorkspaceView] Cannot scroll to bottom for session ${payload.sessionId}, terminal instance not found.`);
  }
};

// Removed computed properties for search results, will pass manager directly
// --- 编辑器操作处理 (用于 FileEditorContainer) ---
const handleCloseEditorTab = (tabId: string) => {
   const isShared = shareFileEditorTabsBoolean.value;
   console.log(`[WorkspaceView] handleCloseEditorTab: ${tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.closeTab(tabId);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     if (currentActiveSessionId) {
       sessionStore.closeEditorTabInSession(currentActiveSessionId, tabId);
     } else {
       console.warn('[WorkspaceView] Cannot close editor tab: No active session in independent mode.');
     }
   }
 };

 const handleActivateEditorTab = (tabId: string) => {
   const isShared = shareFileEditorTabsBoolean.value;
   console.log(`[WorkspaceView] handleActivateEditorTab: ${tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.setActiveTab(tabId);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     if (currentActiveSessionId) {
       sessionStore.setActiveEditorTabInSession(currentActiveSessionId, tabId);
     } else {
       console.warn('[WorkspaceView] Cannot activate editor tab: No active session in independent mode.');
     }
   }
 };

 const handleUpdateEditorContent = (payload: { tabId: string; content: string }) => {
   const isShared = shareFileEditorTabsBoolean.value;
   console.log(`[WorkspaceView] handleUpdateEditorContent for tab ${payload.tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.updateFileContent(payload.tabId, payload.content);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     if (currentActiveSessionId) {
       sessionStore.updateFileContentInSession(currentActiveSessionId, payload.tabId, payload.content);
     } else {
       console.warn('[WorkspaceView] Cannot update editor content: No active session in independent mode.');
     }
   }
 };

 const handleSaveEditorTab = (tabId: string) => {
   const isShared = shareFileEditorTabsBoolean.value;
   console.log(`[WorkspaceView] handleSaveEditorTab: ${tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.saveFile(tabId);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     if (currentActiveSessionId) {
       sessionStore.saveFileInSession(currentActiveSessionId, tabId);
     } else {
       console.warn('[WorkspaceView] Cannot save editor tab: No active session in independent mode.');
     }
   }
 };

 // +++ 处理编辑器编码更改事件 +++
 const handleChangeEncoding = (payload: { tabId: string; encoding: string }) => {
   const isShared = shareFileEditorTabsBoolean.value;
   console.log(`[WorkspaceView] handleChangeEncoding for tab ${payload.tabId} to ${payload.encoding}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.changeEncoding(payload.tabId, payload.encoding);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     if (currentActiveSessionId) {
       // 假设 sessionStore 有一个 changeEncodingInSession 方法
       sessionStore.changeEncodingInSession(currentActiveSessionId, payload.tabId, payload.encoding);
     } else {
       console.warn('[WorkspaceView] Cannot change editor encoding: No active session in independent mode.');
     }
   }
 };
 
 // +++ 处理编辑器滚动位置更新事件 (由 FileEditorContainer 发出) +++
 const handleEditorScrollPositionUpdate = (payload: { tabId: string; scrollTop: number; scrollLeft: number }) => {
   const { tabId, scrollTop, scrollLeft } = payload;
   if (shareFileEditorTabsBoolean.value) {
     fileEditorStore.updateTabScrollPosition(tabId, scrollTop, scrollLeft);
   } else {
     const currentActiveSession = activeSession.value;
     if (currentActiveSession) {
       // 假设 tabId 在当前活动会话的编辑器标签中是唯一的
       sessionStore.updateTabScrollPositionInSession(currentActiveSession.sessionId, tabId, scrollTop, scrollLeft);
     } else {
       console.warn('[WorkspaceView] Cannot update editor scroll position: No active session in independent mode for tab:', tabId);
     }
   }
 };

 // --- 连接列表操作处理 (用于 WorkspaceConnectionList) ---
 const handleConnectRequest = (id: number) => {
   const connectionInfo = connectionsStore.connections.find(c => c.id === id);
   // console.log(`[WorkspaceView] Received 'connect-request' event for ID: ${id}`); // 保留原始日志或移除
   if (connectionInfo) {
     sessionStore.handleConnectRequest(connectionInfo);
   } else {
     console.error(`[WorkspaceView] handleConnectRequest: Connection info not found for ID ${id}.`); // 保留错误日志
   }
 };
 const handleOpenNewSession = (id: number) => {
    console.log(`[WorkspaceView] Received 'open-new-session' event for ID: ${id}`);
    sessionStore.handleOpenNewSession(id);
 };

// +++ 处理虚拟键盘按键事件 +++
const handleVirtualKeyPress = (keySequence: string) => {
 const currentSession = activeSession.value;
 if (!currentSession) {
   console.warn('[WorkspaceView] Cannot send virtual key, no active session.');
   return;
 }
 // 在移动端模式下，我们假设 terminalManager 总是存在的（如果会话活动）
 // 并且直接发送数据，因为虚拟键盘通常用于发送控制字符或特殊序列
 const terminalManager = currentSession.terminalManager as (SshTerminalInstance | undefined);
 if (terminalManager && typeof terminalManager.sendData === 'function') {
   console.log(`[WorkspaceView Mobile] Sending virtual key sequence: ${JSON.stringify(keySequence)}`);
   terminalManager.sendData(keySequence);
   clearVirtualModifiers();
 } else {
   console.warn(`[WorkspaceView Mobile] Cannot send virtual key for session ${currentSession.sessionId}, terminal manager or sendData method not available.`);
 }
};

// +++ Function to toggle virtual keyboard visibility +++
const toggleVirtualKeyboard = () => {
 isVirtualKeyboardVisible.value = !isVirtualKeyboardVisible.value;
 if (!isVirtualKeyboardVisible.value) clearVirtualModifiers();
};

// RDP 事件处理方法已被移除

 // --- 标签页关闭操作处理 ---

 const handleCloseOtherSessions = (targetSessionId: string) => {
   const sessionsToClose = sessionTabsWithStatus.value
     .filter(tab => tab.sessionId !== targetSessionId)
     .map(tab => tab.sessionId);
   sessionsToClose.forEach(id => sessionStore.closeSession(id));
 };

 const handleCloseSessionsToRight = (targetSessionId: string) => {
   const targetIndex = sessionTabsWithStatus.value.findIndex(tab => tab.sessionId === targetSessionId);
   if (targetIndex === -1) return;
   const sessionsToClose = sessionTabsWithStatus.value
     .slice(targetIndex + 1)
     .map(tab => tab.sessionId);
   sessionsToClose.forEach(id => sessionStore.closeSession(id));
 };

 const handleCloseSessionsToLeft = (targetSessionId: string) => {
   const targetIndex = sessionTabsWithStatus.value.findIndex(tab => tab.sessionId === targetSessionId);
   if (targetIndex === -1) return;
   const sessionsToClose = sessionTabsWithStatus.value
     .slice(0, targetIndex)
     .map(tab => tab.sessionId);
   sessionsToClose.forEach(id => sessionStore.closeSession(id));
 };

 const handleCloseOtherEditorTabs = (targetTabId: string) => {
   const tabsToClose = editorTabs.value
     .filter(tab => tab.id !== targetTabId)
     .map(tab => tab.id);
   tabsToClose.forEach(id => handleCloseEditorTab(id)); // Reuse existing close logic
 };

 const handleCloseEditorTabsToRight = (targetTabId: string) => {
   const targetIndex = editorTabs.value.findIndex(tab => tab.id === targetTabId);
   if (targetIndex === -1) return;
   const tabsToClose = editorTabs.value
     .slice(targetIndex + 1)
     .map(tab => tab.id);
   tabsToClose.forEach(id => handleCloseEditorTab(id));
 };

 const handleCloseEditorTabsToLeft = (targetTabId: string) => {
   const targetIndex = editorTabs.value.findIndex(tab => tab.id === targetTabId);
   if (targetIndex === -1) return;
   const tabsToClose = editorTabs.value
     .slice(0, targetIndex)
     .map(tab => tab.id);
   tabsToClose.forEach(id => handleCloseEditorTab(id));
 };

// --- 文件管理器模态框处理 ---
const handleFileManagerOpenRequest = (payload: { sessionId: string }) => {
  const { sessionId } = payload;
  const session = sessionStore.sessions.get(sessionId);
  if (!session) {
    console.error(`[WorkspaceView] Cannot open file manager: Session ${sessionId} not found.`);
    // TODO: Show error notification
    return;
  }

  // 1. 获取 dbConnectionId
  const dbConnectionId = session.connectionId;
  if (!dbConnectionId) {
    console.error(`[WorkspaceView] Cannot open file manager: Missing dbConnectionId for session ${sessionId}.`);
    // TODO: Show error notification
    return;
  }

  // 2. 获取 wsDeps (从 session.wsManager 获取)
  if (!session.wsManager) {
      console.error(`[WorkspaceView] Cannot open file manager: wsManager not found for session ${sessionId}.`);
      // TODO: Show error notification
      return;
  }
  const wsDeps: WebSocketDependencies = {
      sendMessage: session.wsManager.sendMessage,
      sendBinaryMessage: session.wsManager.sendBinaryMessage,
      sendUploadBinaryMessage: session.wsManager.sendUploadBinaryMessage,
      onMessage: session.wsManager.onMessage,
      isConnected: session.wsManager.isConnected,
      isSftpReady: session.wsManager.isSftpReady,
  };

  if (!wsDeps) {
      // 如果 wsDeps 仍然为 null，则无法继续
      console.error(`[WorkspaceView] Cannot open file manager: wsDeps are null after attempting retrieval for session ${sessionId}.`);
      return;
  }

  // 3. 生成或获取 instanceId
  const currentProps = fileManagerPropsMap.value.get(sessionId);
  const instanceId = currentProps ? currentProps.instanceId : `fm-modal-${sessionId}`;

  // 4. 设置 props 并显示模态框
  const newProps = {
    sessionId,
    instanceId,
    dbConnectionId: String(dbConnectionId), // 确保是 string
    wsDeps,
  };
  fileManagerPropsMap.value.set(sessionId, newProps);
  currentFileManagerSessionId.value = sessionId;
  showFileManagerModal.value = true;
  console.log(`[WorkspaceView] Opening FileManager modal with props for session ${sessionId}:`, newProps);
};

// --- 处理 quickCommand:executeProcessed 事件 ---
const handleQuickCommandExecuteProcessed = (payload: WorkspaceEventPayloads['quickCommand:executeProcessed']) => {
  const { command, sessionId: targetSessionId } = payload;
  console.log(`[WorkspaceView] Received quickCommand:executeProcessed event. Command: "${command}", TargetSessionID: ${targetSessionId}`);

  // 使用现有的 handleSendCommand 逻辑来发送指令
  // handleSendCommand 会处理 sessionId 未定义时使用 activeSessionId 的情况
  handleSendCommand(command, targetSessionId);
};

const closeFileManagerModal = () => {
  showFileManagerModal.value = false;
  console.log('[WorkspaceView] FileManager modal hidden (kept alive).');
};

</script>

<template>
  <!-- *** 动态 class 绑定，添加 is-mobile 类 *** -->
  <div :class="['workspace-view', { 'with-header': isHeaderVisible, 'is-mobile': isMobile }]">
    <!-- TerminalTabBar 始终渲染, 传递 isMobile 状态 -->
    <TerminalTabBar
        :sessions="sessionTabsWithStatus"
        :active-session-id="activeSessionId"
        :is-mobile="isMobile"
    />

    <!-- --- 桌面端布局 --- -->
    <template v-if="!isMobile">
      <div class="main-content-area">
        <LayoutRenderer
          v-if="layoutTree"
          :is-root-renderer="true"
          :layout-node="layoutTree"
          :active-session-id="activeSessionId"
          :layout-locked="layoutLockedBoolean"
          class="layout-renderer-wrapper"
          :editor-tabs="editorTabs"
          :active-editor-tab-id="activeEditorTabId"
        ></LayoutRenderer>
        <div v-else class="pane-placeholder">
          {{ t('layout.loading', '加载布局中...') }}
        </div>
      </div>
    </template>

    <!-- --- 移动端布局 --- -->
    <template v-else>
      <div class="mobile-content-area">
        <LayoutRenderer
          v-if="activeSessionId && mobileLayoutNodeForTerminal"
          :layout-node="mobileLayoutNodeForTerminal"
          :active-session-id="activeSessionId"
          :is-root-renderer="false"
          :layout-locked="layoutLockedBoolean"
          class="layout-renderer-wrapper flex-grow overflow-auto"
          :editor-tabs="editorTabs"
          :active-editor-tab-id="activeEditorTabId"
        />
        <div v-else class="pane-placeholder">
          {{ t('workspace.noActiveSession', '没有活动的会话') }}
        </div>
      </div>
      <CommandInputBar
        class="mobile-command-bar"
        :is-mobile="isMobile"
        @send-command="handleSendCommand"
        @search="handleSearch"
        @find-next="handleFindNext"
        @find-previous="handleFindPrevious"
        @close-search="handleCloseSearch"
        @clear-terminal="handleClearTerminal"
        :is-virtual-keyboard-visible="isVirtualKeyboardVisible"
        :virtual-ctrl-active="isVirtualCtrlActive"
        :virtual-alt-active="isVirtualAltActive"
        @toggle-virtual-keyboard="toggleVirtualKeyboard"
        @consume-virtual-modifiers="clearVirtualModifiers"
      />
      <!-- +++ Use v-show for VirtualKeyboard and bind visibility +++ -->
      <VirtualKeyboard
        v-show="isVirtualKeyboardVisible"
        class="mobile-virtual-keyboard"
        :ctrl-active="isVirtualCtrlActive"
        :alt-active="isVirtualAltActive"
        @send-key="handleVirtualKeyPress"
        @toggle-modifier="toggleVirtualModifier"
      />
    </template>

    <!-- Modals 保持不变，应在布局之外 -->
    <AddConnectionFormComponent
      v-if="showAddEditForm"
      :connection-to-edit="connectionToEdit"
      @close="handleFormClose"
      @connection-added="handleConnectionAdded"
      @connection-updated="handleConnectionUpdated"
    />

    <LayoutConfigurator
      :is-visible="showLayoutConfigurator"
      @close="handleCloseLayoutConfigurator"
    />

    <!-- RDP Modal is now rendered in App.vue -->
    <!-- VNC Modal is now rendered in App.vue -->

    <!-- FileManager Modal Container -->
    <div data-testid="file-manager-modal" v-show="showFileManagerModal && currentFileManagerSessionId && fileManagerPropsMap.get(currentFileManagerSessionId)" class="fixed inset-0 flex items-center justify-center z-50 p-4" :style="{ backgroundColor: 'var(--overlay-bg-color)' }" @click.self="closeFileManagerModal">
      <div class="bg-background rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-border">
        <div class="flex justify-between items-center p-3 border-b border-border flex-shrink-0 bg-header">
          <h2 class="text-lg font-semibold text-foreground">{{ t('fileManager.modalTitle', '文件管理器') }} ({{ currentFileManagerSessionId ? (sessionStore.sessions.get(currentFileManagerSessionId)?.connectionName || currentFileManagerSessionId) : '未知会话' }})</h2>
          <button data-testid="file-manager-modal-close" @click="closeFileManagerModal" class="text-text-secondary hover:text-foreground transition-colors">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="flex-grow overflow-hidden">
          <template v-for="propsData in fileManagerPropsMap.values()" :key="`${propsData.sessionId}-${isMobile}`">
            <div v-show="propsData.sessionId === currentFileManagerSessionId" class="h-full">
              <FileManager
                :session-id="propsData.sessionId"
                :instance-id="propsData.instanceId"
                :db-connection-id="propsData.dbConnectionId"
                :ws-deps="propsData.wsDeps"
                :is-mobile="isMobile"
                class="h-full"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.workspace-view {
  display: flex;
  background-color: transparent;
  flex-direction: column;
  height: 100dvh; /* 使用动态视口高度 */
  overflow: hidden;
  transition: height 0.3s ease; /* 可选：添加过渡效果 */
}

/* 当 Header 可见时，调整高度 */
.workspace-view.with-header {
  /* 假设 Header 高度为 55px (根据 App.vue CSS) */
  height: calc(100dvh - 55px); /* 使用动态视口高度计算 */
}

.main-content-area {
    display: flex;
    flex: 1;
    overflow: hidden; /* Keep overflow hidden */
    border: 1px solid var(--border-color, #ccc); /* Use variable for border */
    border-top: none; /* Remove top border as it's handled by the tab bar */
    border-radius: 0 0 5px 5px; /* Top-left, Top-right, Bottom-right, Bottom-left */
    margin: var(--base-margin, 0.5rem); /* Add some margin around the content area */
    margin-top: 0; /* Remove top margin if tab bar is directly above */
}

.layout-renderer-wrapper {
  flex-grow: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 面板占位符样式 (用于加载或错误状态) */
.pane-placeholder {
    flex-grow: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    text-align: center;
    color: var(--text-color-secondary); /* Use secondary text color variable */
    background-color: var(--header-bg-color); /* Use header background for slight contrast */
    font-size: 0.9em;
    padding: var(--base-padding); /* Use base padding variable */
}


/* --- Mobile Layout Styles --- */
.workspace-view.is-mobile {
  /* 由动态视口单位负责跟随浏览器可用高度，避免软键盘关闭后残留旧的 visualViewport 高度。 */
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
  transition: none;
}

.workspace-view.is-mobile.with-header {
  height: calc(100dvh - 55px);
}

.workspace-view.is-mobile .main-content-area {
  /* Hide the desktop content area in mobile view */
  display: none;
}

.mobile-content-area {
  display: flex; /* Use flex for the terminal container */
  flex-direction: column; /* Stack elements vertically if needed */
  flex: 1 1 0; /* Allow the terminal to shrink when the phone keyboard opens */
  min-height: 0;
  overflow: hidden; /* Prevent overflow */
  position: relative; /* Needed for potential absolute positioning inside */
  /* Remove desktop margins/borders */
  margin: 0;
  border: none;
  border-radius: 0;
}

.mobile-terminal {
  flex-grow: 1; /* Terminal takes all available space in mobile-content-area */
  width: 100%;
  overflow: hidden;
}

.mobile-command-bar {
  flex-shrink: 0; /* Prevent command bar from shrinking */
  /* Add specific styles if needed, e.g., border-top */
  border-top: 1px solid var(--border-color, #ccc);
}

.mobile-virtual-keyboard {
  flex-shrink: 0; /* 防止虚拟键盘缩小 */
  width: 100%; /* 确保宽度为 100% */
  box-sizing: border-box; /* 边框和内边距包含在宽度内 */
  /* 可以添加更多样式，例如背景色、边框等 */
}



</style>
