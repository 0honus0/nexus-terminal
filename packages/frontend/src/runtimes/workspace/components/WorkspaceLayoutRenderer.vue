<script setup lang="ts">
  import { ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Splitpanes, Pane } from 'splitpanes';
  import 'splitpanes/dist/splitpanes.css';
  import { BaseButton } from '@/foundation/ui';
  import { TerminalView, type TerminalChannel, type TerminalVisualOptions } from '@/features/terminal/public';
  import {
    FileManager,
    type ArchiveCompressionIntent,
    type LocalUploadFile,
    type RemoteFileEntry,
  } from '@/features/filesystem/public';
  import { FileEditor, type FileEditorSessionController } from '@/features/file-editor/public';
  import { FilePreview, type FilePreviewSessionController } from '@/features/file-preview/public';
  import { StatusMonitor } from '@/features/status-monitor/public';
  import { DockerManager } from '@/features/docker/public';
  import { QuickCommandsPanel, type ExecuteCommandIntent } from '@/features/quick-commands/public';
  import { CommandHistoryPanel, type ExecuteHistoryIntent } from '@/features/command-history/public';
  import {
    SuspendedSessionsPanel,
    type MarkedSuspendedSession,
    type SuspendedSession,
  } from '@/features/ssh-suspend/public';
  import type { Connection } from '@/features/connections/public';
  import WorkspaceCommandBar from './WorkspaceCommandBar.vue';
  import WorkspaceConnectionList from './WorkspaceConnectionList.vue';
  import type { WorkspaceLayoutNode } from '../layout/workspaceLayout';
  import type { WorkspaceRuntimeSession } from '../session';

  interface TerminalApi {
    focus?: () => void;
    fit?: () => void;
    clear?: () => void;
    serialize?: () => string;
  }
  interface EditorApi {
    open?: (path: string) => Promise<unknown> | unknown;
  }
  interface PreviewApi {
    open?: (path: string) => Promise<unknown> | unknown;
  }

  const { t } = useI18n();

  const props = defineProps<{
    node: WorkspaceLayoutNode;
    session: WorkspaceRuntimeSession;
    documentMode: 'editor' | 'preview';
    terminalFontFamily?: string;
    terminalFontSize?: number;
    terminalTheme?: Record<string, string>;
    terminalVisual?: TerminalVisualOptions;
    terminalScrollback?: number;
    rightClickCopyPaste?: boolean;
    editorFontFamily?: string;
    editorFontSize?: number;
    mobileEditorFontSize?: number;
    editorScopeLabel?: string;
    showEditorScopeLabel?: boolean;
    commandInputSyncTarget?: import('@/features/preferences/public').Preferences['commandInputSyncTarget'];
    statusIntervalSeconds?: number;
    dockerIntervalSeconds?: number;
    dockerDefaultExpand?: boolean;
    statusScale?: number;
    statusShowIp?: boolean;
    statusHost?: string;
    editorSession?: FileEditorSessionController;
    previewSession?: FilePreviewSessionController;
    popupDocuments?: boolean;
    popupFileManager?: boolean;
    fileManagerConfirmDelete?: boolean;
    quickCommandsCollapsibleSearch?: boolean;
    quickCommandsCompactMode?: boolean;
    showConnectionTags?: boolean;
    showQuickCommandTags?: boolean;
    fileManagerRowScale?: number;
    fileManagerColumnWidths?: Record<string, number>;
    spreadsheetRowsPerPage?: number;
    spreadsheetMaxColumns?: number;
    quickCommandRowScale?: number;
    clipboardCount?: number;
    markedSuspendedSessions?: MarkedSuspendedSession[];
    layoutLocked?: boolean;
    terminalChannel?: TerminalChannel;
  }>();

  const emit = defineEmits<{
    openConnection: [connection: Connection];
    openFile: [path: string];
    openTextFile: [path: string];
    upload: [path: string];
    clipboardSet: [operation: 'copy' | 'cut', entries: RemoteFileEntry[]];
    moveTo: [entries: RemoteFileEntry[], destination: string];
    paste: [destination: string];
    compress: [entries: RemoteFileEntry[]];
    compressPreset: [intent: ArchiveCompressionIntent];
    decompress: [entry: RemoteFileEntry];
    sendFiles: [entries: RemoteFileEntry[]];
    command: [command: string, allSessions: boolean];
    clearTerminal: [];
    terminalApi: [api: TerminalApi | null];
    editorApi: [api: EditorApi | null];
    previewApi: [api: PreviewApi | null];
    documentMode: [mode: 'editor' | 'preview'];
    resumeSuspended: [session: SuspendedSession];
    resumeMarkedSuspended: [workspaceId: string];
    unmarkSuspended: [workspaceId: string];
    openFileManager: [];
    openEditor: [];
    statusScale: [scale: number];
    terminalFontSize: [size: number];
    editorFontSize: [size: number];
    mobileEditorFontSize: [size: number];
    interaction: [];
    uploadFiles: [path: string, files: LocalUploadFile[], directories: string[]];
    fileManagerRowScale: [scale: number];
    fileManagerColumnWidths: [widths: Record<string, number>];
    editPreview: [path: string];
    hidePreview: [];
    quickCommandRowScale: [scale: number];
    quickCommandCompactMode: [compact: boolean];
    layoutResize: [containerId: string, sizes: number[]];
  }>();

  const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);
  const editorRef = ref<InstanceType<typeof FileEditor> | null>(null);
  const previewRef = ref<InstanceType<typeof FilePreview> | null>(null);

  watch(terminalRef, (value) => emit('terminalApi', value ? (value as TerminalApi) : null), { flush: 'post' });
  watch(editorRef, (value) => emit('editorApi', value ? (value as EditorApi) : null), { flush: 'post' });
  watch(previewRef, (value) => emit('previewApi', value ? (value as PreviewApi) : null), { flush: 'post' });

  const executeQuick = (intent: ExecuteCommandIntent) => emit('command', intent.command, Boolean(intent.allSessions));
  const executeHistory = (intent: ExecuteHistoryIntent) => emit('command', intent.command, Boolean(intent.allSessions));
  const handleLayoutResize = (payload: { panes: Array<{ size: number }> }): void => {
    if (props.layoutLocked || props.node.type !== 'container') return;
    const sizes = payload.panes.map((pane) => pane.size);
    if (sizes.length !== (props.node.children?.length ?? 0) || sizes.some((size) => !Number.isFinite(size))) return;
    emit('layoutResize', props.node.id, sizes);
  };
  const stopLockedSplitterKeydown = (event: KeyboardEvent): void => {
    if (!props.layoutLocked) return;
    const target = event.target as Element | null;
    if (!target?.closest('.splitpanes__splitter')) return;
    event.preventDefault();
    event.stopPropagation();
  };
</script>

<template>
  <Splitpanes
    v-if="node.type === 'container'"
    class="workspace-split"
    :class="{ 'workspace-split--locked': layoutLocked }"
    :horizontal="node.direction === 'vertical'"
    :maximize-panes="!layoutLocked"
    @resized="handleLayoutResize"
    @keydown.capture="stopLockedSplitterKeydown"
  >
    <Pane v-for="child in node.children ?? []" :key="child.id" :size="child.size">
      <WorkspaceLayoutRenderer
        :node="child"
        :session="session"
        :document-mode="documentMode"
        :terminal-font-family="terminalFontFamily"
        :terminal-font-size="terminalFontSize"
        :terminal-theme="terminalTheme"
        :terminal-visual="terminalVisual"
        :terminal-scrollback="terminalScrollback"
        :right-click-copy-paste="rightClickCopyPaste"
        :editor-font-family="editorFontFamily"
        :editor-font-size="editorFontSize"
        :mobile-editor-font-size="mobileEditorFontSize"
        :editor-scope-label="editorScopeLabel"
        :show-editor-scope-label="showEditorScopeLabel"
        :command-input-sync-target="commandInputSyncTarget"
        :status-interval-seconds="statusIntervalSeconds"
        :docker-interval-seconds="dockerIntervalSeconds"
        :docker-default-expand="dockerDefaultExpand"
        :status-scale="statusScale"
        :status-show-ip="statusShowIp"
        :status-host="statusHost"
        :editor-session="editorSession"
        :preview-session="previewSession"
        :popup-documents="popupDocuments"
        :popup-file-manager="popupFileManager"
        :file-manager-confirm-delete="fileManagerConfirmDelete"
        :quick-commands-collapsible-search="quickCommandsCollapsibleSearch"
        :quick-commands-compact-mode="quickCommandsCompactMode"
        :show-connection-tags="showConnectionTags"
        :show-quick-command-tags="showQuickCommandTags"
        :file-manager-row-scale="fileManagerRowScale"
        :file-manager-column-widths="fileManagerColumnWidths"
        :spreadsheet-rows-per-page="spreadsheetRowsPerPage"
        :spreadsheet-max-columns="spreadsheetMaxColumns"
        :quick-command-row-scale="quickCommandRowScale"
        :clipboard-count="clipboardCount"
        :marked-suspended-sessions="markedSuspendedSessions"
        :layout-locked="layoutLocked"
        :terminal-channel="terminalChannel"
        @open-connection="emit('openConnection', $event)"
        @open-file="emit('openFile', $event)"
        @open-text-file="emit('openTextFile', $event)"
        @upload="emit('upload', $event)"
        @upload-files="(path, files, directories) => emit('uploadFiles', path, files, directories)"
        @clipboard-set="(operation, entries) => emit('clipboardSet', operation, entries)"
        @move-to="(entries, destination) => emit('moveTo', entries, destination)"
        @paste="(destination) => emit('paste', destination)"
        @compress="emit('compress', $event)"
        @compress-preset="emit('compressPreset', $event)"
        @decompress="emit('decompress', $event)"
        @send-files="emit('sendFiles', $event)"
        @command="(command, all) => emit('command', command, all)"
        @clear-terminal="emit('clearTerminal')"
        @terminal-api="emit('terminalApi', $event)"
        @editor-api="emit('editorApi', $event)"
        @preview-api="emit('previewApi', $event)"
        @document-mode="emit('documentMode', $event)"
        @resume-suspended="emit('resumeSuspended', $event)"
        @resume-marked-suspended="emit('resumeMarkedSuspended', $event)"
        @unmark-suspended="emit('unmarkSuspended', $event)"
        @update:model-value="session.commandDraft.value = $event"
        @open-file-manager="emit('openFileManager')"
        @open-editor="emit('openEditor')"
        @status-scale="emit('statusScale', $event)"
        @terminal-font-size="emit('terminalFontSize', $event)"
        @editor-font-size="emit('editorFontSize', $event)"
        @mobile-editor-font-size="emit('mobileEditorFontSize', $event)"
        @interaction="emit('interaction')"
        @file-manager-row-scale="emit('fileManagerRowScale', $event)"
        @file-manager-column-widths="emit('fileManagerColumnWidths', $event)"
        @edit-preview="emit('editPreview', $event)"
        @hide-preview="emit('hidePreview')"
        @quick-command-row-scale="emit('quickCommandRowScale', $event)"
        @quick-command-compact-mode="emit('quickCommandCompactMode', $event)"
        @layout-resize="(containerId, sizes) => emit('layoutResize', containerId, sizes)"
      />
    </Pane>
  </Splitpanes>

  <section v-else class="flex h-full min-h-0 flex-col overflow-hidden border border-border/60 bg-background">
    <WorkspaceConnectionList
      v-if="node.component === 'connections'"
      :show-tags="showConnectionTags"
      @open="emit('openConnection', $event)"
    />

    <TerminalView
      v-else-if="node.component === 'terminal'"
      ref="terminalRef"
      class="min-h-0 flex-1"
      :channel="terminalChannel ?? session.adapters.terminal"
      :font-family="terminalFontFamily"
      :font-size="terminalFontSize"
      :theme="terminalTheme"
      :visual="terminalVisual"
      :scrollback="terminalScrollback"
      :right-click-copy-paste="rightClickCopyPaste"
      :state="session.terminalState"
      @font-size-change="emit('terminalFontSize', $event)"
      @interaction="emit('interaction')"
    />

    <WorkspaceCommandBar
      v-else-if="node.component === 'commandBar'"
      :model-value="session.commandDraft.value"
      :command-input-sync-target="commandInputSyncTarget"
      :quick-commands-grouped="showQuickCommandTags"
      :show-file-manager-button="popupFileManager"
      :show-editor-button="popupDocuments"
      :ready="session.hasConnected.value"
      @update:model-value="session.commandDraft.value = $event"
      @open-file-manager="emit('openFileManager')"
      @open-editor="emit('openEditor')"
      @send="(command, all) => emit('command', command, all)"
      @clear="emit('clearTerminal')"
      @interaction="emit('interaction')"
    />

    <template v-else-if="node.component === 'fileManager'">
      <div v-if="popupFileManager" class="grid min-h-0 flex-1 place-items-center gap-2 p-4 text-sm text-text-secondary">
        <span>{{ t('settings.popupFileManager.title') }}</span>
        <BaseButton size="sm" variant="primary" @click="emit('openFileManager')">{{
          t('fileManager.modalTitle')
        }}</BaseButton>
      </div>
      <FileManager
        v-else
        :channel="session.adapters.filesystem"
        :download="session.adapters.download"
        :terminal-directory="session.adapters.terminalDirectory"
        :confirm-delete="fileManagerConfirmDelete"
        :row-scale="fileManagerRowScale"
        :column-widths="fileManagerColumnWidths"
        :clipboard-count="clipboardCount"
        :state="session.filesystemState"
        @open-file="emit('openFile', $event.path)"
        @open-as-text="emit('openTextFile', $event.path)"
        @upload="emit('upload', $event)"
        @upload-files="(path, files, directories) => emit('uploadFiles', path, files, directories)"
        @copy-to-clipboard="emit('clipboardSet', 'copy', $event)"
        @cut-to-clipboard="emit('clipboardSet', 'cut', $event)"
        @paste="emit('paste', $event)"
        @compress="emit('compress', $event)"
        @compress-preset="emit('compressPreset', $event)"
        @decompress="emit('decompress', $event)"
        @send-files="emit('sendFiles', $event)"
        @row-scale="emit('fileManagerRowScale', $event)"
        @column-widths="emit('fileManagerColumnWidths', $event)"
      />
    </template>

    <template v-else-if="node.component === 'editor'">
      <div class="flex items-center gap-1 border-b border-border bg-header/50 px-2 py-1">
        <BaseButton
          size="sm"
          :variant="documentMode === 'editor' ? 'primary' : 'ghost'"
          @click="emit('documentMode', 'editor')"
          >{{ t('workspace.documents.editor') }}</BaseButton
        >
        <BaseButton
          size="sm"
          :variant="documentMode === 'preview' ? 'primary' : 'ghost'"
          @click="emit('documentMode', 'preview')"
          >{{ t('workspace.documents.preview') }}</BaseButton
        >
      </div>
      <div v-if="popupDocuments" class="grid min-h-0 flex-1 place-items-center text-sm text-text-secondary">
        {{ t('settings.popupEditor.title') }}
      </div>
      <template v-else>
        <FileEditor
          ref="editorRef"
          v-show="documentMode === 'editor'"
          class="min-h-0 flex-1"
          :port="session.adapters.documents"
          :scope-id="session.id"
          :scope-label="editorScopeLabel"
          :show-scope-label="showEditorScopeLabel"
          :session="editorSession"
          :font-family="editorFontFamily"
          :font-size="editorFontSize"
          :mobile-font-size="mobileEditorFontSize"
          @font-size="emit('editorFontSize', $event)"
          @mobile-font-size="emit('mobileEditorFontSize', $event)"
        />
        <FilePreview
          ref="previewRef"
          v-show="documentMode === 'preview'"
          class="min-h-0 flex-1"
          :source="session.adapters.preview"
          :scope-id="session.id"
          :session="previewSession"
          :spreadsheet-rows-per-page="spreadsheetRowsPerPage"
          :spreadsheet-max-columns="spreadsheetMaxColumns"
          :quick-command-row-scale="quickCommandRowScale"
          @edit="emit('editPreview', $event)"
          @hide="emit('hidePreview')"
        />
      </template>
    </template>

    <StatusMonitor
      v-else-if="node.component === 'statusMonitor'"
      class="min-h-0 flex-1 overflow-auto p-2"
      :session="session.statusController"
      :interval-seconds="statusIntervalSeconds"
      :scale="statusScale"
      :show-ip="statusShowIp"
      :host="statusHost"
      @update:scale="emit('statusScale', $event)"
    />
    <DockerManager
      v-else-if="node.component === 'dockerManager'"
      class="min-h-0 flex-1 overflow-auto p-2"
      :session="session.dockerController"
      :interval-seconds="dockerIntervalSeconds"
      :default-expand="dockerDefaultExpand"
      :connection-state="session.state.value"
      :connection-message="session.statusMessage.value"
      @terminal-command="emit('command', $event, false)"
    />
    <QuickCommandsPanel
      v-else-if="node.component === 'quickCommands'"
      :collapsible-search="quickCommandsCollapsibleSearch"
      :compact="quickCommandsCompactMode"
      :show-tags="showQuickCommandTags"
      :row-scale="quickCommandRowScale"
      @row-scale="emit('quickCommandRowScale', $event)"
      @compact-mode="emit('quickCommandCompactMode', $event)"
      @execute="executeQuick"
    />
    <CommandHistoryPanel v-else-if="node.component === 'commandHistory'" @execute="executeHistory" />
    <SuspendedSessionsPanel
      v-else-if="node.component === 'suspendedSshSessions'"
      :can-resume="true"
      :marked-sessions="markedSuspendedSessions"
      @resume="emit('resumeSuspended', $event)"
      @resume-marked="emit('resumeMarkedSuspended', $event)"
      @unmark="emit('unmarkSuspended', $event)"
    />
  </section>
</template>

<style scoped>
  .workspace-split {
    height: 100%;
    min-height: 0;
    background: var(--background-color);
  }
  :deep(.splitpanes__pane) {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  :deep(.splitpanes__splitter) {
    background: var(--border-color);
    position: relative;
  }
  .workspace-split--locked :deep(.splitpanes__splitter) {
    pointer-events: none;
    cursor: default;
  }
  :deep(.splitpanes--vertical > .splitpanes__splitter) {
    width: 4px;
  }
  :deep(.splitpanes--horizontal > .splitpanes__splitter) {
    height: 4px;
  }
</style>
