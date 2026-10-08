<script setup lang="ts">
  import { defineAsyncComponent, onMounted, onBeforeUnmount, ref } from 'vue';
  import { isAgentRunNonTerminal } from '../api/agent-api';
  import { useAgentAppController, type AgentAppControllerProps } from './useAgentAppController';
  import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
  import AgentConversation from '../ai/AgentConversation.vue';
  import AgentThreadSidebar from './AgentThreadSidebar.vue';
  import AgentConfigPopover from '../files/AgentConfigPopover.vue';
  import ApprovalCard from '../runtime/ApprovalCard.vue';
  const TaskRail = defineAsyncComponent(() => import('../runtime/TaskRail.vue'));
  const props = defineProps<AgentAppControllerProps>();
  const {
    runtimeOperation,
    appExecutable,
    threads,
    threadNextCursor,
    threadListLoadingMore,
    currentThread,
    entries,
    nextCursor,
    run,
    pendingInputRequest,
    reconciliationDetails,
    reconciliationBusy,
    threadRuns,
    connections,
    attachments,
    approvalBatch,
    approvals,
    pendingApprovals,
    hardLimits,
    backgroundRuns,
    detailSnapshot,
    detailCheckpoints,
    currentRunCheckpoints,
    detailApprovalBatch,
    error,
    errorCode,
    errorRetry,
    detailSubagents,
    selectedSubagentId,
    detailSubagentMessages,
    detailVisible,
    selectedModelKey,
    taskRailVisible,
    threadDeleteArmedId,
    deleteAllThreadsArmed,
    threadSidebarVisible,
    threadsOverlay,
    threadDrawerOpen,
    threadSidebar,
    threadPageSize,
    streamingText,
    busy,
    loading,
    selectingThread,
    threadContentReady,
    draft,
    commandResult,
    activeThreadCount,
    threadStatuses,
    threadTitles,
    modelOptions,
    providerSelection,
    modelOptionHint,
    modelSelectionLocked,
    executionModeValue,
    setExecutionMode,
    approvalModeValue,
    setApprovalMode,
    reasoningLevels,
    reasoningCapabilityAvailable,
    reasoningValue,
    activeReasoningIndex,
    isDraggingReasoning,
    thumbLeftPercent,
    trackFillPercent,
    isUltraOrMax,
    currentReasoningDescription,
    reasoningTrackRef,
    reasoningDisplayLabel,
    onTrackPointerDown,
    onTrackPointerMove,
    onTrackPointerUp,
    onTrackPointerCancel,
    displayedConnectionIds,
    mutationLocked,
    canSend,
    clearCurrentError,
    errorDomainLabel,
    errorRetryLabel,
    retryFailedOperation,
    setModelSelection,
    toggleConnectionSelection,
    connectionSelectionState,
    toggleAllConnectionSelections,
    resolveReconciliation,
    selectThread,
    beginThreadCreation,
    loadMoreThreads,
    send,
    cancel,
    increaseBudget,
    resolveApproval,
    selectSubagent,
    cancelSubagent,
    openRunDetail,
    closeRunDetail,
    saveCheckpoint,
    resumeCheckpoint,
    deleteRun,
    requestDeleteThread,
    requestDeleteAllConversations,
    loadOlder,
    updateDraft,
    THREADS_OVERLAY_BREAKPOINT,
  } = useAgentAppController(props);
  const layoutRoot = ref<HTMLElement | null>(null);

  let layoutObserver: ResizeObserver | null = null;

  onMounted(() => {
    if (!layoutRoot.value || typeof ResizeObserver === 'undefined') return;
    layoutObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      threadsOverlay.value = width <= THREADS_OVERLAY_BREAKPOINT;
    });
    layoutObserver.observe(layoutRoot.value);
  });

  onBeforeUnmount(() => {
    layoutObserver?.disconnect();
    layoutObserver = null;
  });
</script>

<template>
  <div
    ref="layoutRoot"
    class="agent-surface-layout relative grid h-full min-h-0"
    :class="{ 'has-task-rail': taskRailVisible, 'is-threads-hidden': !threadSidebarVisible }"
  >
    <AgentThreadSidebar
      ref="threadSidebar"
      :open="threadDrawerOpen"
      :threads="threads"
      :next-cursor="threadNextCursor"
      :loading-more="threadListLoadingMore"
      :active-thread-count="activeThreadCount"
      :busy="busy"
      :current-thread-id="currentThread?.id ?? null"
      :thread-statuses="threadStatuses"
      :thread-delete-armed-id="threadDeleteArmedId"
      :delete-all-threads-armed="deleteAllThreadsArmed"
      @close="threadDrawerOpen = false"
      @new-thread="beginThreadCreation"
      @select="selectThread"
      @delete-thread="requestDeleteThread"
      @delete-all="requestDeleteAllConversations"
      @load-more="loadMoreThreads"
      @page-size="threadPageSize = $event"
    />

    <main class="agent-conversation-pane flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header class="shrink-0 border-b border-border/50 bg-header/40 backdrop-blur-xs">
        <div class="flex h-9 items-center justify-between gap-3 px-3.5">
          <div class="flex min-w-0 items-center gap-2">
            <button
              type="button"
              class="agent-thread-toggle flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="
                (threadsOverlay ? threadDrawerOpen : threadSidebarVisible)
                  ? 'border-border bg-card text-foreground shadow-xs ring-1 ring-border/20'
                  : 'border-border/70 bg-card/60 text-text-secondary hover:border-border hover:bg-header hover:text-foreground'
              "
              :aria-expanded="threadsOverlay ? threadDrawerOpen : threadSidebarVisible"
              aria-controls="agent-thread-sidebar"
              :aria-label="$t('agent.operations.openThreads')"
              :title="$t('agent.operations.openThreads')"
              @click="
                threadsOverlay ? (threadDrawerOpen = !threadDrawerOpen) : (threadSidebarVisible = !threadSidebarVisible)
              "
            >
              <i class="fa-regular fa-comments text-xs" aria-hidden="true"></i>
            </button>
            <div class="min-w-0 flex items-center gap-2">
              <i class="fa-regular fa-message text-[11px] text-text-secondary/60 shrink-0" aria-hidden="true"></i>
              <span class="truncate text-xs font-semibold text-foreground tracking-tight">{{
                currentThread?.title || $t('agent.operations.untitledThread')
              }}</span>
              <span
                v-if="run"
                class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none"
                :class="
                  run.status === 'running'
                    ? 'bg-success/10 text-success'
                    : run.status === 'awaiting_approval' || run.status === 'awaiting_budget'
                      ? 'bg-warning/10 text-warning'
                      : run.status === 'failed'
                        ? 'bg-error/10 text-error'
                        : 'bg-header text-text-secondary'
                "
              >
                {{ $t(`agent.tasks.runStatus.${run.status}`) }}
              </span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              v-if="currentThread"
              type="button"
              class="agent-header-thread-delete hidden h-7.5 w-7.5 items-center justify-center rounded-lg border transition-all disabled:cursor-not-allowed disabled:opacity-50"
              :class="
                threadDeleteArmedId === currentThread.id
                  ? 'border-error/30 bg-error/10 text-error'
                  : 'border-border/70 bg-card/60 text-text-secondary hover:border-error/30 hover:bg-error/10 hover:text-error'
              "
              :aria-label="
                threadDeleteArmedId === currentThread.id
                  ? $t('agent.operations.confirmDeleteThread')
                  : $t('agent.operations.deleteThread')
              "
              :title="
                run && isAgentRunNonTerminal(run.status)
                  ? $t('agent.operations.deleteThreadActiveHint')
                  : threadDeleteArmedId === currentThread.id
                    ? $t('agent.operations.confirmDeleteThread')
                    : $t('agent.operations.deleteThread')
              "
              :disabled="busy || Boolean(run && isAgentRunNonTerminal(run.status))"
              @click="requestDeleteThread(currentThread)"
            >
              <i class="fa-solid fa-trash-can text-[10px]" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="relative flex h-7.5 w-7.5 items-center justify-center rounded-lg border transition-all"
              :class="
                taskRailVisible
                  ? 'border-border bg-card text-foreground shadow-xs ring-1 ring-border/20'
                  : 'border-border/70 bg-card/60 text-text-secondary hover:border-border hover:bg-header hover:text-foreground'
              "
              :aria-expanded="taskRailVisible"
              aria-controls="agent-task-rail"
              :aria-label="$t('agent.ui.toggleTasks')"
              :title="$t('agent.ui.toggleTasks')"
              @click="taskRailVisible = !taskRailVisible"
            >
              <i class="fa-solid fa-table-columns text-xs" aria-hidden="true"></i>
              <span
                v-if="pendingApprovals.length || backgroundRuns.length"
                class="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white shadow-xs"
                :class="pendingApprovals.length ? 'bg-warning' : 'bg-primary'"
              >
                {{ pendingApprovals.length || backgroundRuns.length }}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div class="relative min-h-0 flex-1">
        <div v-if="loading || (selectingThread && !threadContentReady)" class="flex h-full items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-text-secondary">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground"
            >
              <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
            </div>
            <span class="text-xs">{{ $t('agent.operations.loading') }}</span>
          </div>
        </div>
        <div v-else-if="error && entries.length === 0" class="flex h-full items-center justify-center p-6 text-sm">
          <div class="max-w-sm rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-error" role="alert">
            <div class="flex items-start gap-2">
              <i class="fa-solid fa-circle-exclamation mt-1" aria-hidden="true"></i>
              <div class="min-w-0 flex-1 break-words text-left" :title="errorCode">
                <div v-if="errorDomainLabel" class="text-[11px] font-semibold text-error/80">
                  {{ errorDomainLabel }}
                </div>
                <div>{{ error }}</div>
              </div>
            </div>
            <div v-if="errorRetry" class="mt-2 flex justify-end">
              <UiButton
                appearance="soft"
                tone="neutral"
                density="compact"
                :title="$t('agent.operations.retryHint')"
                @click="retryFailedOperation"
              >
                {{ errorRetryLabel }}
              </UiButton>
            </div>
          </div>
        </div>
        <div v-else class="relative h-full min-h-0">
          <div
            v-if="!appExecutable"
            class="pointer-events-none absolute left-1/2 top-3 z-20 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning shadow-sm backdrop-blur-sm"
            role="status"
          >
            <div class="font-medium">{{ $t('agent.operations.appUnavailable') }}</div>
            <div v-if="appHealthReason" class="mt-0.5 break-words text-[11px] text-warning/80">
              {{ $t('agent.operations.appUnavailableReason', { reason: appHealthReason }) }}
            </div>
          </div>
          <AgentConversation
            :app-id="appId"
            :error="error"
            :error-domain="errorDomainLabel"
            :error-code="errorCode"
            :can-retry="errorRetry !== null"
            :retry-label="errorRetryLabel"
            :reconciliation="run?.needsReconciliation === true || runtimeOperation.phase.value === 'reconciling'"
            :reconciliation-details="reconciliationDetails"
            :reconciliation-busy="reconciliationBusy"
            @dismiss-error="clearCurrentError"
            @retry-error="retryFailedOperation"
            :entries="entries"
            :next-cursor="nextCursor"
            :run="run"
            :input-request="pendingInputRequest"
            :streaming-text="streamingText"
            :draft="draft"
            :busy="mutationLocked"
            :can-send="canSend"
            :attachments="attachments"
            :command-result="commandResult"
            @load-older="loadOlder"
            @send="send"
            @cancel="cancel"
            @update-draft="updateDraft"
            @update-attachments="attachments = $event"
            @dismiss-command-result="commandResult = null"
            @resolve-reconciliation="resolveReconciliation"
          >
            <template #approvals>
              <div
                v-if="approvalBatch?.clock && pendingApprovals.length"
                class="mx-auto mb-5 w-full max-w-3xl rounded-2xl border border-warning/25 bg-warning/[0.035] p-2.5 shadow-sm"
              >
                <div class="mb-2 flex items-center gap-2 px-1 text-[11px] text-text-secondary">
                  <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-warning/12 text-warning">
                    <i class="fa-solid fa-shield-halved text-[9px]" aria-hidden="true"></i>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="font-semibold text-foreground">{{ $t('agent.conversation.approvalRequestTitle') }}</div>
                    <div class="mt-0.5 text-[11px] leading-4 text-text-secondary/75">
                      {{ $t('agent.conversation.approvalRequestHint') }}
                    </div>
                  </div>
                </div>
                <div class="space-y-2">
                  <ApprovalCard
                    v-for="approval in pendingApprovals"
                    :key="approval.id"
                    :approval="approval"
                    :clock="approvalBatch.clock"
                    :busy="mutationLocked"
                    @resolve="resolveApproval"
                  />
                </div>
              </div>
            </template>
            <template #configuration>
              <div class="agent-run-config flex min-h-7 items-center gap-1">
                <div
                  v-if="modelSelectionLocked && run"
                  class="agent-config-summary flex h-[26px] items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 text-[11px] font-medium text-text-secondary transition-colors duration-150 select-none hover:border-border/50 hover:bg-header/70 hover:text-foreground"
                  :title="`${$t('agent.operations.runModelLocked')}: ${run.definition.model.modelId}`"
                >
                  <i class="fa-solid fa-microchip shrink-0 text-[9px] text-text-secondary" aria-hidden="true"></i>
                  <span class="agent-config-verbose max-w-28 truncate whitespace-nowrap text-foreground text-left">
                    {{ run.definition.model.modelId }}
                  </span>
                  <i class="fa-solid fa-lock shrink-0 text-[7px] text-text-secondary" aria-hidden="true"></i>
                </div>
                <AgentConfigPopover
                  v-else-if="modelOptions.length"
                  :ariaLabel="$t('agent.operations.runModel')"
                  :title="`${$t('agent.operations.runModelHint')}: ${providerSelection?.model.id ?? ''}`"
                  panel-class="w-72"
                >
                  <template #trigger>
                    <i class="fa-solid fa-microchip text-[9px] text-text-secondary" aria-hidden="true"></i>
                    <span class="agent-config-verbose max-w-28 truncate whitespace-nowrap text-left">{{
                      providerSelection?.model.id
                    }}</span>
                    <i
                      class="agent-config-affordance fa-solid fa-chevron-down text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <span class="text-xs font-semibold">{{ $t('agent.operations.runModel') }}</span>
                    </div>
                    <div class="max-h-72 space-y-1 overflow-y-auto">
                      <button
                        v-for="option in modelOptions"
                        :key="option.key"
                        type="button"
                        class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors"
                        :class="[
                          option.key === selectedModelKey
                            ? 'bg-primary/8 font-medium text-foreground'
                            : 'text-text-secondary hover:bg-card/70',
                          option.compatible ? '' : 'cursor-not-allowed opacity-55',
                        ]"
                        :disabled="busy || !option.compatible"
                        @click="
                          setModelSelection(option.key);
                          close(true);
                        "
                      >
                        <span
                          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                          :class="
                            option.key === selectedModelKey
                              ? 'bg-primary/10 text-primary'
                              : 'bg-header text-text-secondary'
                          "
                        >
                          <i class="fa-solid fa-microchip text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs font-medium text-foreground">{{ option.model.id }}</span>
                          <span class="mt-0.5 block truncate text-[11px] text-text-secondary">
                            {{ modelOptionHint(option) }}
                          </span>
                        </span>
                        <i
                          v-if="option.key === selectedModelKey"
                          class="fa-solid fa-check text-[10px] text-primary"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </template>
                </AgentConfigPopover>
                <div
                  v-else
                  class="agent-config-summary flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 text-[11px] font-medium text-text-secondary select-none"
                  :title="$t('agent.operations.providerMissing')"
                >
                  <i class="fa-solid fa-microchip shrink-0 text-[9px] text-text-secondary" aria-hidden="true"></i>
                  <span class="agent-config-verbose max-w-28 truncate whitespace-nowrap text-left">{{
                    $t('agent.operations.providerMissing')
                  }}</span>
                </div>
                <!-- 思考强度：GPT 官方饱满胶囊滑块卡片 -->
                <AgentConfigPopover
                  v-if="reasoningCapabilityAvailable || (modelSelectionLocked && reasoningValue)"
                  :ariaLabel="$t('agent.ui.reasoning')"
                  :title="`${$t('agent.ui.reasoning')}: ${reasoningDisplayLabel}`"
                  panel-class="w-56"
                >
                  <template #trigger>
                    <i class="fa-solid fa-bolt text-[9px] text-primary" aria-hidden="true"></i>
                    <span class="agent-config-reasoning min-w-4 whitespace-nowrap text-center">{{
                      reasoningDisplayLabel
                    }}</span>
                    <i
                      v-if="modelSelectionLocked"
                      class="fa-solid fa-lock text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                    <i
                      v-else
                      class="agent-config-affordance fa-solid fa-chevron-down text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel>
                    <div class="p-1">
                      <!-- 胶囊条上方纯净居中展示当前强度 -->
                      <div
                        class="mb-1.5 flex items-center justify-center gap-1 text-center text-xs font-semibold text-foreground select-none"
                      >
                        <span>{{ reasoningDisplayLabel }}</span>
                        <i
                          v-if="modelSelectionLocked"
                          class="fa-solid fa-lock text-[9px] text-text-secondary"
                          :title="$t('agent.operations.frozen')"
                          aria-hidden="true"
                        ></i>
                      </div>

                      <!-- 核心主体：精致小巧的 GPT 胶囊滑块条（支持平滑拖拽与吸附） -->
                      <div class="relative my-1.5 px-0.5">
                        <div
                          ref="reasoningTrackRef"
                          class="relative flex h-[26px] w-full items-center rounded-full bg-header/80 px-2 cursor-pointer select-none overflow-hidden border border-border/40 shadow-inner touch-none"
                          @pointerdown="onTrackPointerDown"
                          @pointermove="onTrackPointerMove"
                          @pointerup="onTrackPointerUp"
                          @pointercancel="onTrackPointerCancel"
                        >
                          <!-- 动态填充色带 -->
                          <div
                            class="absolute left-0 top-0 h-full rounded-full pointer-events-none"
                            :class="[
                              isDraggingReasoning ? '' : 'transition-[width] duration-150 ease-out',
                              isUltraOrMax
                                ? 'bg-gradient-to-r from-info via-primary to-warning shadow-[0_0_8px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]'
                                : 'bg-gradient-to-r from-info to-primary',
                            ]"
                            :style="{ width: `${trackFillPercent}%` }"
                          ></div>

                          <!-- 微小精致刻度点 -->
                          <div
                            class="relative z-10 flex w-full items-center justify-between pointer-events-none px-0.5"
                          >
                            <span
                              v-for="(level, idx) in reasoningLevels"
                              :key="level"
                              class="h-1 w-1 rounded-full transition-colors"
                              :class="idx <= activeReasoningIndex ? 'bg-white/90 shadow-2xs' : 'bg-foreground/20'"
                            ></span>
                          </div>

                          <!-- 纯白精致圆形滑钮手柄 -->
                          <div
                            class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-[18px] w-[18px] rounded-full bg-background text-foreground shadow-sm flex items-center justify-center cursor-grab active:cursor-grabbing z-20 ring-1 ring-border/70"
                            :class="
                              isDraggingReasoning
                                ? 'scale-110 shadow-md cursor-grabbing'
                                : 'transition-[left,transform] duration-150 ease-out'
                            "
                            :style="{ left: `${thumbLeftPercent}%` }"
                          >
                            <span
                              class="h-1.5 w-1.5 rounded-full transition-colors"
                              :class="isDraggingReasoning ? 'bg-primary' : 'bg-primary/50'"
                            ></span>
                          </div>
                        </div>
                      </div>

                      <!-- 底部说明文案 -->
                      <div class="mt-1.5 text-center text-[11px] text-text-secondary/80 leading-normal px-1">
                        {{ currentReasoningDescription }}
                      </div>
                    </div>
                  </template>
                </AgentConfigPopover>

                <!-- Run 执行模式：与批准策略正交；plan 模式在 model surface 前移除 mutation Tool -->
                <AgentConfigPopover
                  :ariaLabel="$t('agent.operations.executionMode')"
                  :title="`${$t('agent.operations.executionModeHint')}: ${
                    executionModeValue === 'plan'
                      ? $t('agent.operations.executionPlan')
                      : $t('agent.operations.executionExecute')
                  }`"
                  panel-class="w-72"
                >
                  <template #trigger>
                    <i
                      :class="
                        executionModeValue === 'plan'
                          ? 'fa-solid fa-list-check text-primary'
                          : 'fa-solid fa-play text-success'
                      "
                      class="text-[11px]"
                      aria-hidden="true"
                    ></i>
                    <span class="agent-config-verbose max-w-24 truncate whitespace-nowrap text-left">
                      {{
                        executionModeValue === 'plan'
                          ? $t('agent.operations.executionPlan')
                          : $t('agent.operations.executionExecute')
                      }}
                    </span>
                    <i
                      :class="modelSelectionLocked ? 'fa-solid fa-lock' : 'fa-solid fa-chevron-down'"
                      class="agent-config-affordance text-[11px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-semibold">{{ $t('agent.operations.executionMode') }}</span>
                        <UiInfoHint trigger="click" :text="$t('agent.operations.executionModeHint')" />
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                    </div>
                    <div class="space-y-1">
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          executionModeValue === 'execute'
                            ? 'border-success/25 bg-success/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setExecutionMode('execute');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
                        >
                          <i class="fa-solid fa-play text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.executionExecute')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.executionExecuteDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="executionModeValue === 'execute'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-success"
                          aria-hidden="true"
                        ></i>
                      </button>
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          executionModeValue === 'plan'
                            ? 'border-primary/25 bg-primary/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setExecutionMode('plan');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                        >
                          <i class="fa-solid fa-list-check text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.executionPlan')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.executionPlanDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="executionModeValue === 'plan'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-primary"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </template>
                </AgentConfigPopover>

                <!-- Run 级批准策略：新 Run 创建时冻结，运行中只读 -->
                <AgentConfigPopover
                  :ariaLabel="$t('agent.operations.approvalMode')"
                  :title="`${$t('agent.operations.approvalModeHint')}: ${
                    approvalModeValue === 'full_access'
                      ? $t('agent.operations.approvalFullAccess')
                      : $t('agent.operations.approvalAsk')
                  }`"
                  panel-class="w-72"
                >
                  <template #trigger>
                    <i
                      class="fa-solid fa-shield-halved text-[9px]"
                      :class="approvalModeValue === 'full_access' ? 'text-warning' : 'text-success'"
                      aria-hidden="true"
                    ></i>
                    <span class="agent-config-verbose max-w-24 truncate whitespace-nowrap text-left">
                      {{
                        approvalModeValue === 'full_access'
                          ? $t('agent.operations.approvalFullAccess')
                          : $t('agent.operations.approvalAsk')
                      }}
                    </span>
                    <i
                      :class="modelSelectionLocked ? 'fa-solid fa-lock' : 'fa-solid fa-chevron-down'"
                      class="agent-config-affordance text-[11px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-semibold">{{ $t('agent.operations.approvalMode') }}</span>
                        <UiInfoHint trigger="click" :text="$t('agent.operations.approvalModeHint')" />
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                    </div>
                    <div class="space-y-1">
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          approvalModeValue === 'ask'
                            ? 'border-success/25 bg-success/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setApprovalMode('ask');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
                        >
                          <i class="fa-solid fa-hand text-[9px] text-success" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.approvalAsk')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.approvalAskDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="approvalModeValue === 'ask'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-success"
                          aria-hidden="true"
                        ></i>
                      </button>
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          approvalModeValue === 'full_access'
                            ? 'border-warning/25 bg-warning/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setApprovalMode('full_access');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
                        >
                          <i class="fa-solid fa-bolt text-[9px] text-warning" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.approvalFullAccess')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.approvalFullAccessDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="approvalModeValue === 'full_access'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-warning"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </template>
                </AgentConfigPopover>

                <!-- SSH 主机 -->
                <AgentConfigPopover
                  :ariaLabel="$t('agent.operations.targets')"
                  :title="$t('agent.operations.targetsHint')"
                  panel-class="ui-popover__panel--list w-[min(320px,calc(100vw-24px))] !rounded-xl !p-3 !shadow-xl"
                >
                  <template #trigger>
                    <i
                      class="fa-solid fa-server text-[8px]"
                      :class="displayedConnectionIds.length ? 'text-primary' : 'text-text-secondary'"
                      aria-hidden="true"
                    ></i>
                    <span class="agent-config-verbose whitespace-nowrap">SSH</span>
                    <span class="agent-config-compact hidden whitespace-nowrap">SSH</span>
                    <span
                      class="agent-ssh-count inline-flex min-w-[0.6rem] items-center justify-center text-[11px] font-semibold leading-none"
                      :class="displayedConnectionIds.length ? 'text-success' : 'text-error/80'"
                      >{{ displayedConnectionIds.length }}</span
                    >
                    <i
                      v-if="modelSelectionLocked"
                      class="fa-solid fa-lock text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                    <i
                      v-else
                      class="agent-config-affordance fa-solid fa-chevron-down text-[7px] text-text-secondary/70"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel>
                    <div class="shrink-0 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 px-1">
                      <div class="min-w-0 flex-1 text-[11px] font-semibold leading-none text-foreground">
                        {{ $t('agent.operations.targets') }}
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="shrink-0 rounded-md bg-header/70 px-1.5 py-1 text-[11px] leading-none text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                      <div v-if="connections.length > 0" class="ml-auto flex shrink-0 items-center gap-2">
                        <div class="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary/70">
                          <span
                            class="shrink-0 font-semibold tabular-nums"
                            :class="displayedConnectionIds.length ? 'text-success' : 'text-error/80'"
                          >
                            {{ displayedConnectionIds.length }}/{{ connections.length }}
                          </span>
                        </div>
                        <label
                          class="inline-flex min-h-7 cursor-pointer items-center gap-1.5 text-[11px] font-medium leading-none text-text-secondary"
                        >
                          <UiCheckbox
                            density="compact"
                            :model-value="connectionSelectionState === 'on'"
                            :indeterminate="connectionSelectionState === 'mixed'"
                            :disabled="modelSelectionLocked"
                            :aria-label="$t('agent.operations.targetsBulkToggle')"
                            :title="
                              connectionSelectionState === 'on'
                                ? $t('agent.operations.disableAllTargets')
                                : $t('agent.operations.enableAllTargets')
                            "
                            @update:model-value="toggleAllConnectionSelections"
                          />
                          <span class="whitespace-nowrap">{{ $t('agent.operations.enableAllTargets') }}</span>
                        </label>
                      </div>
                    </div>

                    <div
                      class="ui-popover__list min-h-0 overflow-y-auto overscroll-contain rounded-lg p-1"
                      role="group"
                      :aria-label="$t('agent.operations.targets')"
                    >
                      <button
                        v-for="connection in connections"
                        :key="connection.id"
                        type="button"
                        class="group mb-1 flex min-h-12 w-full items-center gap-3 rounded-lg border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          displayedConnectionIds.includes(connection.id)
                            ? 'border-primary/25 bg-primary/8 text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-header/60 hover:text-foreground'
                        "
                        :disabled="modelSelectionLocked"
                        :aria-pressed="displayedConnectionIds.includes(connection.id)"
                        @click="
                          toggleConnectionSelection(connection.id, !displayedConnectionIds.includes(connection.id))
                        "
                      >
                        <span
                          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
                          :class="
                            displayedConnectionIds.includes(connection.id)
                              ? 'bg-primary/10 text-primary'
                              : 'bg-header/65 text-text-secondary/70 group-hover:text-foreground'
                          "
                        >
                          <i class="fa-solid fa-server text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-[11px] font-medium leading-tight text-foreground">{{
                            connection.name || connection.host
                          }}</span>
                          <span class="mt-1 block truncate font-mono text-[11px] leading-none text-text-secondary/60"
                            >{{ connection.host }}:{{ connection.port }}</span
                          >
                        </span>
                        <span
                          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all"
                          :class="
                            displayedConnectionIds.includes(connection.id)
                              ? 'bg-primary text-white shadow-xs'
                              : 'bg-transparent text-transparent ring-1 ring-inset ring-border/55 group-hover:ring-border'
                          "
                          aria-hidden="true"
                        >
                          <i class="fa-solid fa-check text-[8px]"></i>
                        </span>
                      </button>

                      <div
                        v-if="connections.length === 0"
                        class="flex items-center gap-2 rounded-lg px-2.5 py-3 text-[11px] text-text-secondary"
                      >
                        <i class="fa-solid fa-server text-[10px] text-text-secondary/45" aria-hidden="true"></i>
                        <span>{{ $t('agent.operations.noTargets') }}</span>
                      </div>
                    </div>
                  </template>
                </AgentConfigPopover>
              </div>
            </template>
          </AgentConversation>
        </div>
      </div>
    </main>

    <button
      v-if="taskRailVisible"
      type="button"
      class="agent-task-backdrop absolute inset-0 z-20 hidden bg-background/50"
      :aria-label="$t('common.close')"
      @click="taskRailVisible = false"
    ></button>
    <div v-if="taskRailVisible" id="agent-task-rail" class="agent-task-rail min-h-0">
      <TaskRail
        :current="run"
        :background-runs="backgroundRuns"
        :thread-runs="threadRuns"
        :thread-titles="threadTitles"
        :hard-limits="hardLimits"
        :approvals="approvals"
        :approval-clock="approvalBatch?.clock ?? null"
        :current-checkpoints="currentRunCheckpoints"
        :detail-snapshot="detailVisible ? detailSnapshot : null"
        :detail-checkpoints="detailCheckpoints"
        :detail-approvals="detailApprovalBatch?.items ?? []"
        :detail-approval-clock="detailApprovalBatch?.clock ?? null"
        :detail-subagents="detailSubagents"
        :selected-subagent-id="selectedSubagentId"
        :detail-subagent-messages="detailSubagentMessages"
        :busy="mutationLocked"
        @close="taskRailVisible = false"
        @back="closeRunDetail"
        @increase-budget="increaseBudget"
        @resolve-approval="resolveApproval"
        @open-run="openRunDetail"
        @save-checkpoint="saveCheckpoint"
        @resume-checkpoint="resumeCheckpoint"
        @select-subagent="selectSubagent"
        @cancel-subagent="cancelSubagent"
        @delete-run="deleteRun"
      />
    </div>
  </div>
</template>

<style scoped src="./AgentAppSurface.css"></style>
