<script setup lang="ts">
  import { ref, watch } from 'vue';
  import type {
    AgentApprovalView,
    AgentCheckpointView,
    AgentRunSnapshot,
    AgentServerClockAnchor,
    AgentSubagentMessage,
    AgentSubagentView,
  } from '../api/agent-api';
  import WorkspaceRuntimePanel from './WorkspaceRuntimePanel.vue';
  import SubagentTree from './SubagentTree.vue';
  import ToolTimeline from './ToolTimeline.vue';

  const props = defineProps<{
    snapshot: AgentRunSnapshot | null;
    checkpoints: AgentCheckpointView[];
    approvals: AgentApprovalView[];
    approvalClock: AgentServerClockAnchor | null;
    subagents: AgentSubagentView[];
    selectedSubagentId: string | null;
    subagentMessages: AgentSubagentMessage[];
    busy: boolean;
  }>();
  const emit = defineEmits<{
    close: [];
    closeRail: [];
    saveCheckpoint: [snapshot: AgentRunSnapshot];
    resumeCheckpoint: [snapshot: AgentRunSnapshot, checkpoint: AgentCheckpointView];
    selectSubagent: [delegation: AgentSubagentView];
    cancelSubagent: [delegation: AgentSubagentView];
    resolveApproval: [approval: AgentApprovalView, decision: 'approved' | 'denied'];
    deleteRun: [snapshot: AgentRunSnapshot];
  }>();

  const deleteArmed = ref(false);
  watch(
    () => props.snapshot?.id,
    () => {
      deleteArmed.value = false;
    },
  );

  const terminal = new Set(['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted']);
  const canSave = () =>
    Boolean(props.snapshot && props.snapshot.status !== 'cancelling' && !props.snapshot.needsReconciliation);
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-full flex-col border-l border-border/60 bg-card/70 select-none"
    :aria-label="$t('agent.tasks.detail')"
  >
    <!-- 第三栏头部：就地返回与快速关闭 -->
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium text-text-secondary hover:border-border hover:bg-header hover:text-foreground active:scale-95 transition-all shadow-2xs"
          :title="$t('agent.tasks.backToTasks')"
          :aria-label="$t('agent.tasks.backToTasks')"
          @click="emit('close')"
        >
          <i class="fa-solid fa-arrow-left text-[10px]" aria-hidden="true"></i>
          <span class="text-[11px]">{{ $t('agent.tasks.backToTasks') }}</span>
        </button>
        <span v-if="snapshot" class="truncate font-mono text-[10px] text-text-secondary font-medium">
          #{{ snapshot.id.slice(-6) }}
        </span>
      </div>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-header hover:text-foreground"
        :title="$t('common.close')"
        :aria-label="$t('common.close')"
        @click="emit('closeRail')"
      >
        <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3 text-xs space-y-3">
      <template v-if="snapshot">
        <!-- 运行概览卡片 -->
        <section class="rounded-xl border border-border/70 bg-card p-3 shadow-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                {{ $t('agent.tasks.runOverview') }}
              </div>
              <div class="mt-1 flex items-center gap-1.5">
                <span
                  class="h-2 w-2 rounded-full"
                  :class="
                    snapshot.status === 'running'
                      ? 'bg-success'
                      : snapshot.status === 'awaiting_approval' || snapshot.status === 'awaiting_budget'
                        ? 'bg-warning'
                        : snapshot.status === 'failed'
                          ? 'bg-error'
                          : 'bg-text-secondary/50'
                  "
                ></span>
                <strong class="text-xs truncate">{{ $t(`agent.tasks.runStatus.${snapshot.status}`) }}</strong>
              </div>
            </div>
            <span class="rounded-md bg-header px-2 py-0.5 text-[10px] text-text-secondary shrink-0">
              {{ $t(`agent.tasks.verificationStatus.${snapshot.verificationStatus}`) }}
            </span>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-2.5 text-[10px]">
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.steps') }}</div>
              <div class="mt-0.5 font-mono font-medium text-foreground">{{ snapshot.usage.steps }}</div>
            </div>
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.tokens') }}</div>
              <div class="mt-0.5 font-mono font-medium text-foreground">
                {{ snapshot.usage.inputTokens + snapshot.usage.outputTokens }}
              </div>
            </div>
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.activeTime') }}</div>
              <div class="mt-0.5 font-mono font-medium text-foreground">{{ snapshot.activeExecutionSeconds }}s</div>
            </div>
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.goal') }}</div>
              <div class="mt-0.5 truncate font-medium text-foreground">{{ snapshot.goalStatus }}</div>
            </div>
          </div>

          <div
            class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-[10px] text-text-secondary"
          >
            <span class="rounded-md bg-header px-2 py-0.5 font-mono">
              <i class="fa-solid fa-microchip mr-1 text-[8px]" aria-hidden="true"></i
              >{{ snapshot.definition.model.modelId }}
            </span>
            <span v-if="snapshot.definition.reasoningEffort" class="rounded-md bg-header px-2 py-0.5">
              <i class="fa-solid fa-brain mr-1 text-[8px]" aria-hidden="true"></i
              >{{ $t(`agent.ui.reasoningLevels.${snapshot.definition.reasoningEffort}`) }}
            </span>
          </div>

          <!-- 删除运行按键 -->
          <div
            v-if="terminal.has(snapshot.status)"
            class="mt-2.5 flex items-center justify-between gap-2 border-t border-border/50 pt-2"
          >
            <span class="text-[10px] text-text-secondary">{{ $t('agent.tasks.deleteRunHint') }}</span>
            <div class="flex shrink-0 items-center gap-1">
              <button
                v-if="deleteArmed"
                type="button"
                class="rounded-md border border-border/70 px-2 py-1 text-[10px] font-medium text-text-secondary hover:bg-header"
                :disabled="busy"
                @click="deleteArmed = false"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-md border border-error/40 px-2 py-1 text-[10px] font-semibold text-error hover:bg-error/10 disabled:opacity-50"
                :disabled="busy"
                @click="deleteArmed ? $emit('deleteRun', snapshot) : (deleteArmed = true)"
              >
                {{ deleteArmed ? $t('agent.tasks.confirmDeleteRun') : $t('agent.tasks.deleteRun') }}
              </button>
            </div>
          </div>
        </section>

        <!-- 审批时间线 -->
        <ToolTimeline
          v-if="approvals.some((item) => item.status === 'requested')"
          class="rounded-xl border border-border/70 bg-card p-3"
          :approvals="approvals.filter((item) => item.status === 'requested')"
          :clock="approvalClock"
          :busy="busy"
          @resolve="(approval, decision) => $emit('resolveApproval', approval, decision)"
        />

        <details
          v-if="approvals.some((item) => item.status !== 'requested')"
          class="rounded-xl border border-border/70 bg-card p-3"
        >
          <summary class="cursor-pointer text-[11px] font-medium text-text-secondary hover:text-foreground">
            {{ $t('agent.ui.approvalHistory') }}
          </summary>
          <ToolTimeline
            class="mt-2"
            :approvals="approvals.filter((item) => item.status !== 'requested')"
            :clock="approvalClock"
            :busy="busy"
          />
        </details>

        <!-- 检查点卡片 -->
        <details class="rounded-xl border border-border/70 bg-card p-3" open>
          <summary class="cursor-pointer text-xs font-semibold text-foreground">
            {{ $t('agent.tasks.checkpoints') }} · {{ checkpoints.length }}
          </summary>
          <div class="mt-2.5 flex items-center justify-between gap-1">
            <span class="text-[10px] text-text-secondary leading-tight">{{ $t('agent.tasks.checkpointHint') }}</span>
            <button
              type="button"
              class="shrink-0 rounded-md border border-border/70 bg-background px-2 py-1 text-[10px] font-medium hover:bg-header disabled:opacity-50"
              :disabled="busy || !canSave()"
              @click="$emit('saveCheckpoint', snapshot)"
            >
              <i class="fa-solid fa-plus mr-1 text-[8px]" aria-hidden="true"></i>
              {{ $t('agent.tasks.saveCheckpoint') }}
            </button>
          </div>
          <div
            v-if="checkpoints.length === 0"
            class="mt-2 rounded-lg bg-background/60 px-2.5 py-2 text-[10px] text-text-secondary"
          >
            {{ $t('agent.tasks.noCheckpoints') }}
          </div>
          <article
            v-for="checkpoint in checkpoints"
            :key="checkpoint.id"
            class="mt-2 rounded-lg border border-border/40 bg-background/60 p-2"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate font-mono text-[10px] font-medium text-foreground">
                  #{{ checkpoint.id.slice(-8) }}
                </div>
                <div class="mt-0.5 text-[9px] text-text-secondary">
                  {{
                    $t('agent.tasks.checkpointWatermark', {
                      ledger: checkpoint.ledgerThrough,
                      event: checkpoint.eventThrough,
                    })
                  }}
                </div>
              </div>
              <button
                v-if="terminal.has(snapshot.status)"
                type="button"
                class="shrink-0 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                :disabled="busy || snapshot.needsReconciliation"
                @click="$emit('resumeCheckpoint', snapshot, checkpoint)"
              >
                {{ $t('agent.tasks.resumeCheckpoint') }}
              </button>
            </div>
          </article>
        </details>

        <!-- 运行时面板 -->
        <details class="rounded-xl border border-border/70 bg-card p-3">
          <summary class="cursor-pointer text-xs font-semibold text-foreground">
            {{ $t('agent.ui.optionalRuntime') }}
          </summary>
          <WorkspaceRuntimePanel class="mt-2" :app-id="snapshot.appId" :run-id="snapshot.id" :busy="busy" />
        </details>

        <!-- 子智能体树 -->
        <SubagentTree
          v-if="subagents.length"
          :items="subagents"
          :selected-id="selectedSubagentId"
          :messages="subagentMessages"
          :busy="busy"
          @select="$emit('selectSubagent', $event)"
          @cancel="$emit('cancelSubagent', $event)"
        />

        <!-- 最近事实 -->
        <details class="rounded-xl border border-border/70 bg-card p-3">
          <summary class="cursor-pointer text-xs font-semibold text-foreground">
            <i class="fa-solid fa-wave-square mr-1.5 text-[10px] text-text-secondary" aria-hidden="true"></i>
            {{ $t('agent.tasks.recentFacts') }} · {{ snapshot.recentEntries.length }}
          </summary>
          <article v-for="entry in snapshot.recentEntries" :key="entry.id" class="mt-2 rounded-lg bg-background/60 p-2">
            <div class="text-[10px] text-text-secondary">#{{ entry.sequence }} · {{ entry.kind }}</div>
            <pre
              class="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-snug"
              >{{ JSON.stringify(entry.payload, null, 2) }}</pre>
          </article>
        </details>
      </template>
    </div>
  </aside>
</template>
