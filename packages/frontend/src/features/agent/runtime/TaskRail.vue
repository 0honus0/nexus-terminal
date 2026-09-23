<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import draggable from 'vuedraggable';
  import type {
    AgentApprovalViewDto,
    AgentCheckpointViewDto,
    AgentHardLimitsDto,
    AgentRunSnapshotDto,
    AgentRunViewDto,
    AgentServerClockAnchorViewModel,
    AgentSubagentMessageDto,
    AgentSubagentViewDto,
  } from '../api/agent-api';
  import ApprovalCard from './ApprovalCard.vue';
  import WorkspaceRuntimePanel from './WorkspaceRuntimePanel.vue';
  import SubagentTree from './SubagentTree.vue';
  import ApprovalTimeline from './ApprovalTimeline.vue';

  const props = withDefaults(
    defineProps<{
      current: AgentRunViewDto | null;
      backgroundRuns: AgentRunViewDto[];
      threadRuns: AgentRunViewDto[];
      threadTitles: Record<string, string>;
      hardLimits: AgentHardLimitsDto | null;
      approvals: AgentApprovalViewDto[];
      approvalClock: AgentServerClockAnchorViewModel | null;
      currentCheckpoints?: AgentCheckpointViewDto[];
      detailSnapshot?: AgentRunSnapshotDto | null;
      detailCheckpoints?: AgentCheckpointViewDto[];
      detailApprovals?: AgentApprovalViewDto[];
      detailApprovalClock?: AgentServerClockAnchorViewModel | null;
      detailSubagents?: AgentSubagentViewDto[];
      selectedSubagentId?: string | null;
      detailSubagentMessages?: AgentSubagentMessageDto[];
      busy?: boolean;
    }>(),
    {
      currentCheckpoints: () => [],
      detailSnapshot: null,
      detailCheckpoints: () => [],
      detailApprovals: () => [],
      detailApprovalClock: null,
      detailSubagents: () => [],
      selectedSubagentId: null,
      detailSubagentMessages: () => [],
      busy: false,
    },
  );
  const emit = defineEmits<{
    close: [];
    back: [];
    openRun: [run: AgentRunViewDto];
    selectSubagent: [delegation: AgentSubagentViewDto];
    cancelSubagent: [delegation: AgentSubagentViewDto];
    deleteRun: [snapshot: AgentRunSnapshotDto];
    resolveApproval: [approval: AgentApprovalViewDto, decision: 'approved' | 'denied', feedback?: string];
    saveCheckpoint: [snapshot: AgentRunViewDto | AgentRunSnapshotDto];
    resumeCheckpoint: [snapshot: AgentRunViewDto | AgentRunSnapshotDto, checkpoint: AgentCheckpointViewDto];
    increaseBudget: [
      increase: Partial<{
        maxRunSteps: number;
        maxActiveExecutionSeconds: number;
      }>,
    ];
  }>();

  const showInlineDetails = ref(false);
  const deleteArmed = ref(false);
  const terminal = new Set(['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted']);
  watch(
    () => props.detailSnapshot?.id,
    () => {
      deleteArmed.value = false;
    },
  );
  const canSaveDetail = (): boolean =>
    Boolean(
      props.detailSnapshot && props.detailSnapshot.status !== 'cancelling' && !props.detailSnapshot.needsReconciliation,
    );

  const contextUsage = computed(() => props.current?.usage.context ?? null);
  const contextPercent = computed(() => {
    const context = contextUsage.value;
    if (!context) return 0;
    return Math.min(100, Math.round((context.inputTokens / Math.max(1, context.contextWindowTokens)) * 100));
  });
  const planItems = computed(() => props.current?.plan.items ?? []);
  const completedPlanItems = computed(() => planItems.value.filter((item) => item.status === 'completed').length);
  const planPercent = computed(() =>
    planItems.value.length ? Math.round((completedPlanItems.value / planItems.value.length) * 100) : 0,
  );
  const currentPlanItem = computed(
    () =>
      planItems.value.find((item) => item.status === 'in_progress') ??
      planItems.value.find((item) => item.status === 'blocked') ??
      planItems.value.find((item) => item.status === 'pending') ??
      null,
  );
  const blockedPlanItems = computed(() => planItems.value.filter((item) => item.status === 'blocked').length);
  const attentionKey = computed(() => {
    if (!props.current) return null;
    if (props.current.needsReconciliation) return 'reconciliation';
    if (props.current.status === 'awaiting_approval') return 'approval';
    if (props.current.status === 'awaiting_budget') return 'budget';
    if (props.current.status === 'awaiting_input') return 'input';
    return null;
  });
  const historyRuns = computed(() => props.threadRuns.filter((item) => item.id !== props.current?.id).slice(0, 8));
  const requestedApprovals = computed(() => props.approvals.filter((approval) => approval.status === 'requested'));

  type RailCardId = 'progress' | 'approvals' | 'plan' | 'targets' | 'history' | 'background';
  interface RailCard {
    id: RailCardId;
  }

  const defaultCardOrder: RailCard[] = [
    { id: 'progress' },
    { id: 'approvals' },
    { id: 'plan' },
    { id: 'targets' },
    { id: 'background' },
    { id: 'history' },
  ];
  const railStorageKey = 'nexus.agent.task-rail-order.v1';
  const loadCardOrder = (): RailCard[] => {
    try {
      const stored = JSON.parse(localStorage.getItem(railStorageKey) ?? '[]') as unknown;
      if (!Array.isArray(stored)) return defaultCardOrder;
      const known = new Set(defaultCardOrder.map((card) => card.id));
      const ids = stored.filter((id): id is RailCardId => typeof id === 'string' && known.has(id as RailCardId));
      const missing = defaultCardOrder.map((card) => card.id).filter((id) => !ids.includes(id));
      return [...ids, ...missing].map((id) => ({ id }));
    } catch {
      return defaultCardOrder;
    }
  };
  const railCards = ref<RailCard[]>(loadCardOrder());
  const cardVisible = (id: RailCardId): boolean => {
    if (id === 'progress') return Boolean(props.current);
    if (id === 'approvals') return requestedApprovals.value.length > 0;
    if (id === 'plan') return planItems.value.length > 0;
    if (id === 'targets') return Boolean(props.current?.definition.connectionIds.length);
    if (id === 'history') return historyRuns.value.length > 0;
    return props.backgroundRuns.length > 0;
  };
  const visibleCards = computed<RailCard[]>({
    get: () => railCards.value.filter((card) => cardVisible(card.id)),
    set: (next) => {
      const visibleIds = new Set(next.map((card) => card.id));
      let visibleIndex = 0;
      railCards.value = railCards.value.map((card) =>
        visibleIds.has(card.id) ? (next[visibleIndex++] ?? card) : card,
      );
    },
  });
  watch(railCards, (cards) => localStorage.setItem(railStorageKey, JSON.stringify(cards.map((card) => card.id))), {
    deep: true,
  });

  const increase = (): void => {
    const run = props.current;
    const hard = props.hardLimits;
    if (!run || !hard) return;
    const next: Partial<{
      maxRunSteps: number;
      maxActiveExecutionSeconds: number;
    }> = {};
    const raise = (current: number, ceiling: number): number | undefined => {
      if (current >= ceiling) return undefined;
      return Math.min(ceiling, Math.max(current + 1, Math.ceil(current * 1.5)));
    };
    const steps = raise(run.budget.maxRunSteps, hard.maxRunSteps);
    const seconds = raise(run.budget.maxActiveExecutionSeconds, hard.maxActiveExecutionSeconds);
    if (steps !== undefined) next.maxRunSteps = steps;
    if (seconds !== undefined) next.maxActiveExecutionSeconds = seconds;
    if (Object.keys(next).length) emit('increaseBudget', next);
  };
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-l border-border/60 bg-card/70">
    <header
      v-if="detailSnapshot"
      class="flex h-[37px] shrink-0 items-center justify-between border-b border-border/60 px-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium text-text-secondary shadow-2xs transition-all hover:border-border hover:bg-header hover:text-foreground active:scale-95"
          :title="$t('agent.tasks.backToTasks')"
          :aria-label="$t('agent.tasks.backToTasks')"
          @click="emit('back')"
        >
          <i class="fa-solid fa-arrow-left text-[10px]" aria-hidden="true"></i>
          <span class="text-[11px]">{{ $t('agent.tasks.backToTasks') }}</span>
        </button>
        <span class="truncate font-mono text-[11px] font-medium text-text-secondary">
          #{{ detailSnapshot.id.slice(-6) }}
        </span>
      </div>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-header hover:text-foreground"
        :title="$t('common.close')"
        :aria-label="$t('common.close')"
        @click="emit('close')"
      >
        <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
      </button>
    </header>
    <header v-else class="flex h-[37px] shrink-0 items-center justify-between border-b border-border/60 px-3">
      <div class="flex min-w-0 items-center gap-2">
        <div
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] text-primary"
        >
          <i class="fa-solid fa-list-check" aria-hidden="true"></i>
        </div>
        <div class="min-w-0">
          <strong class="block truncate text-xs leading-none">{{ $t('agent.tasks.title') }}</strong>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <span
          v-if="requestedApprovals.length || backgroundRuns.length"
          class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary"
        >
          {{ requestedApprovals.length + backgroundRuns.length }}
        </span>
        <button
          type="button"
          class="agent-rail-close-btn flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-header hover:text-foreground"
          :title="$t('common.close')"
          :aria-label="$t('common.close')"
          @click="emit('close')"
        >
          <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3" :class="detailSnapshot ? 'space-y-3 text-xs' : ''">
      <template v-if="detailSnapshot">
        <!-- 运行概览卡片 -->
        <section class="rounded-xl border border-border/70 bg-card p-3 shadow-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                {{ $t('agent.tasks.runOverview') }}
              </div>
              <div class="mt-1 flex items-center gap-1.5">
                <span
                  class="h-2 w-2 rounded-full"
                  :class="
                    detailSnapshot.status === 'running'
                      ? 'bg-success'
                      : detailSnapshot.status === 'awaiting_approval' || detailSnapshot.status === 'awaiting_budget'
                        ? 'bg-warning'
                        : detailSnapshot.status === 'failed'
                          ? 'bg-error'
                          : 'bg-text-secondary/50'
                  "
                ></span>
                <strong class="text-xs truncate">{{ $t(`agent.tasks.runStatus.${detailSnapshot.status}`) }}</strong>
              </div>
            </div>
            <span class="rounded-md bg-header px-2 py-0.5 text-[11px] text-text-secondary shrink-0">
              {{ $t(`agent.tasks.verificationStatus.${detailSnapshot.verificationStatus}`) }}
            </span>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-2.5 text-[11px]">
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.steps') }}</div>
              <div class="mt-0.5 font-mono font-medium text-foreground">{{ detailSnapshot.usage.steps }}</div>
            </div>
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.tokens') }}</div>
              <div class="mt-0.5 font-mono font-medium text-foreground">
                {{ detailSnapshot.usage.inputTokens + detailSnapshot.usage.outputTokens }}
              </div>
              <div class="mt-1 truncate font-mono text-[11px] text-text-secondary/80">
                {{
                  $t('agent.tasks.tokenBreakdown', {
                    input: detailSnapshot.usage.inputTokens,
                    output: detailSnapshot.usage.outputTokens,
                    cached: detailSnapshot.usage.cachedInputTokens,
                  })
                }}
              </div>
            </div>
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.activeTime') }}</div>
              <div class="mt-0.5 font-mono font-medium text-foreground">
                {{ detailSnapshot.activeExecutionSeconds }}s
              </div>
            </div>
            <div class="rounded-lg border border-border/40 bg-background/50 p-2">
              <div class="text-text-secondary">{{ $t('agent.tasks.goal') }}</div>
              <div class="mt-0.5 truncate font-medium text-foreground">{{ detailSnapshot.goalStatus }}</div>
            </div>
          </div>

          <div
            class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-[11px] text-text-secondary"
          >
            <span class="rounded-md bg-header px-2 py-0.5 font-mono">
              <i class="fa-solid fa-microchip mr-1 text-[8px]" aria-hidden="true"></i
              >{{ detailSnapshot.definition.model.modelId }}
            </span>
            <span v-if="detailSnapshot.definition.reasoningEffort" class="rounded-md bg-header px-2 py-0.5">
              <i class="fa-solid fa-brain mr-1 text-[8px]" aria-hidden="true"></i
              >{{ $t(`agent.ui.reasoningLevels.${detailSnapshot.definition.reasoningEffort}`) }}
            </span>
          </div>

          <!-- 删除运行按键 -->
          <div
            v-if="terminal.has(detailSnapshot.status)"
            class="mt-2.5 flex items-center justify-between gap-2 border-t border-border/50 pt-2"
          >
            <span class="text-[11px] text-text-secondary">{{ $t('agent.tasks.deleteRunHint') }}</span>
            <div class="flex shrink-0 items-center gap-1">
              <button
                v-if="deleteArmed"
                type="button"
                class="rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-header"
                :disabled="busy"
                @click="deleteArmed = false"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-md border border-error/40 px-2 py-1 text-[11px] font-semibold text-error hover:bg-error/10 disabled:opacity-50"
                :disabled="busy"
                @click="deleteArmed ? $emit('deleteRun', detailSnapshot) : (deleteArmed = true)"
              >
                {{ deleteArmed ? $t('agent.tasks.confirmDeleteRun') : $t('agent.tasks.deleteRun') }}
              </button>
            </div>
          </div>
        </section>

        <!-- 审批时间线 -->
        <ApprovalTimeline
          v-if="detailApprovals.some((item) => item.status === 'requested')"
          class="rounded-xl border border-border/70 bg-card p-3"
          :approvals="detailApprovals.filter((item) => item.status === 'requested')"
          :clock="detailApprovalClock"
          :busy="busy"
          @resolve="(approval, decision, feedback) => $emit('resolveApproval', approval, decision, feedback)"
        />

        <details
          v-if="detailApprovals.some((item) => item.status !== 'requested')"
          class="rounded-xl border border-border/70 bg-card p-3"
        >
          <summary class="cursor-pointer text-[11px] font-medium text-text-secondary hover:text-foreground">
            {{ $t('agent.ui.approvalHistory') }}
          </summary>
          <ApprovalTimeline
            class="mt-2"
            :approvals="detailApprovals.filter((item) => item.status !== 'requested')"
            :clock="detailApprovalClock"
            :busy="busy"
          />
        </details>

        <!-- 检查点卡片 -->
        <details class="rounded-xl border border-border/70 bg-card p-3" open>
          <summary class="cursor-pointer text-xs font-semibold text-foreground">
            {{ $t('agent.tasks.checkpoints') }} · {{ detailCheckpoints.length }}
          </summary>
          <div class="mt-2.5 flex items-center justify-between gap-1">
            <span class="text-[11px] text-text-secondary leading-tight">{{ $t('agent.tasks.checkpointHint') }}</span>
            <button
              type="button"
              class="shrink-0 rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] font-medium hover:bg-header disabled:opacity-50"
              :disabled="busy || !canSaveDetail()"
              @click="$emit('saveCheckpoint', detailSnapshot)"
            >
              <i class="fa-solid fa-plus mr-1 text-[8px]" aria-hidden="true"></i>
              {{ $t('agent.tasks.saveCheckpoint') }}
            </button>
          </div>
          <div
            v-if="detailCheckpoints.length === 0"
            class="mt-2 rounded-lg bg-background/60 px-2.5 py-2 text-[11px] text-text-secondary"
          >
            {{ $t('agent.tasks.noCheckpoints') }}
          </div>
          <article
            v-for="checkpoint in detailCheckpoints"
            :key="checkpoint.id"
            class="mt-2 rounded-lg border border-border/40 bg-background/60 p-2"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-1.5">
                  <div class="truncate font-mono text-[11px] font-medium text-foreground">
                    #{{ checkpoint.id.slice(-8) }}
                  </div>
                  <span class="shrink-0 rounded bg-header px-1.5 py-0.5 text-[11px] text-text-secondary">
                    {{
                      $t(
                        checkpoint.kind === 'recovery'
                          ? 'agent.tasks.autoRecoveryCheckpoint'
                          : 'agent.tasks.userCheckpoint',
                      )
                    }}
                  </span>
                </div>
                <div class="mt-0.5 text-[11px] text-text-secondary">
                  {{
                    $t('agent.tasks.checkpointWatermark', {
                      ledger: checkpoint.ledgerThrough,
                      event: checkpoint.eventThrough,
                    })
                  }}
                </div>
              </div>
              <button
                v-if="terminal.has(detailSnapshot.status) && checkpoint.kind === 'user'"
                type="button"
                class="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                :disabled="busy || detailSnapshot.needsReconciliation"
                @click="$emit('resumeCheckpoint', detailSnapshot, checkpoint)"
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
          <WorkspaceRuntimePanel class="mt-2" :app-id="detailSnapshot.appId" :run-id="detailSnapshot.id" :busy="busy" />
        </details>

        <!-- 子智能体树 -->
        <SubagentTree
          v-if="detailSubagents.length"
          :items="detailSubagents"
          :selected-id="selectedSubagentId"
          :messages="detailSubagentMessages"
          :busy="busy"
          @select="$emit('selectSubagent', $event)"
          @cancel="$emit('cancelSubagent', $event)"
        />

        <!-- 最近事实 -->
        <details class="rounded-xl border border-border/70 bg-card p-3">
          <summary class="cursor-pointer text-xs font-semibold text-foreground">
            <i class="fa-solid fa-wave-square mr-1.5 text-[10px] text-text-secondary" aria-hidden="true"></i>
            {{ $t('agent.tasks.recentFacts') }} · {{ detailSnapshot.recentEntries.length }}
          </summary>
          <article
            v-for="entry in detailSnapshot.recentEntries"
            :key="entry.id"
            class="mt-2 rounded-lg bg-background/60 p-2"
          >
            <div class="text-[11px] text-text-secondary">#{{ entry.sequence }} · {{ entry.kind }}</div>
            <pre
              class="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug"
              >{{ JSON.stringify(entry.payload, null, 2) }}</pre>
          </article>
        </details>
      </template>

      <template v-else>
        <draggable
          v-if="visibleCards.length"
          v-model="visibleCards"
          item-key="id"
          handle=".agent-rail-drag-handle"
          ghost-class="agent-rail-card-ghost"
          chosen-class="agent-rail-card-chosen"
          drag-class="agent-rail-card-drag"
          :animation="160"
          class="space-y-3"
        >
          <template #item="{ element }">
            <section
              class="agent-rail-card rounded-xl border border-border/70 bg-card p-3.5 shadow-xs transition-shadow hover:shadow-sm"
              :data-rail-card="element.id"
            >
              <template v-if="element.id === 'progress' && current">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span
                        class="h-2 w-2 rounded-full"
                        :class="
                          current.status === 'running'
                            ? 'bg-success'
                            : current.status === 'awaiting_approval' || current.status === 'awaiting_budget'
                              ? 'bg-warning'
                              : current.status === 'failed'
                                ? 'bg-error'
                                : 'bg-text-secondary/50'
                        "
                      ></span>
                      <strong class="truncate text-xs">{{ $t(`agent.tasks.runStatus.${current.status}`) }}</strong>
                    </div>
                    <div v-if="planItems.length" class="mt-1 text-[11px] text-text-secondary">
                      {{ completedPlanItems }}/{{ planItems.length }} · {{ planPercent }}%
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="agent-rail-drag-handle flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-text-secondary hover:bg-header active:cursor-grabbing"
                      :aria-label="$t('agent.tasks.dragCard')"
                    >
                      <i class="fa-solid fa-grip-vertical text-[10px]" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>

                <div v-if="planItems.length" class="mt-3">
                  <div class="h-1.5 overflow-hidden rounded-full bg-header">
                    <div class="h-full rounded-full bg-primary" :style="{ width: `${planPercent}%` }"></div>
                  </div>
                  <div v-if="currentPlanItem" class="mt-2 flex items-start gap-2">
                    <span
                      class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      :class="currentPlanItem.status === 'blocked' ? 'bg-warning' : 'bg-primary'"
                    ></span>
                    <div class="min-w-0">
                      <div class="text-[11px] text-text-secondary">{{ $t('agent.tasks.currentFocus') }}</div>
                      <div class="mt-0.5 line-clamp-2 text-xs font-medium leading-4">{{ currentPlanItem.title }}</div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="attentionKey && attentionKey !== 'reconciliation'"
                  class="mt-3 rounded-xl border border-warning/25 bg-warning/5 px-2.5 py-2 text-[11px] leading-4 text-warning"
                >
                  <i class="fa-solid fa-triangle-exclamation mr-1 text-[8px]" aria-hidden="true"></i>
                  {{ $t(`agent.tasks.attention.${attentionKey}`) }}
                </div>

                <div class="mt-3 border-t border-border/50 pt-2.5 space-y-2.5">
                  <div>
                    <div class="mb-1 flex items-center justify-between text-[11px] text-text-secondary">
                      <span class="font-medium">{{ $t('agent.tasks.contextUsage') }}</span>
                      <span v-if="contextUsage" class="font-mono">
                        {{ contextUsage.inputTokens }} / {{ contextUsage.contextWindowTokens }} · {{ contextPercent }}%
                      </span>
                      <span v-else class="font-mono">—</span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-header">
                      <div
                        class="h-full rounded-full bg-primary/75 transition-all duration-300"
                        :style="{ width: `${contextPercent}%` }"
                      ></div>
                    </div>
                    <div v-if="contextUsage" class="mt-1 font-mono text-[11px] text-text-secondary/75">
                      {{ $t('agent.tasks.contextReserved', { value: contextUsage.reservedOutputTokens }) }} ·
                      {{ $t(`agent.tasks.contextSource.${contextUsage.source}`) }}
                    </div>
                    <div class="mt-1 font-mono text-[11px] text-text-secondary/75">
                      {{
                        $t('agent.tasks.tokenBreakdown', {
                          input: current.usage.inputTokens,
                          output: current.usage.outputTokens,
                          cached: current.usage.cachedInputTokens,
                        })
                      }}
                    </div>
                  </div>
                  <div>
                    <div class="mb-1 flex items-center justify-between text-[11px] text-text-secondary">
                      <span class="font-medium">{{ $t('agent.tasks.steps') }}</span>
                      <span class="font-mono">{{ current.usage.steps }} / {{ current.budget.maxRunSteps }}</span>
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-[11px]">
                    <div class="rounded-lg border border-border/40 bg-background/50 px-2 py-1.5">
                      <div class="text-text-secondary">{{ $t('agent.tasks.activeTime') }}</div>
                      <div class="mt-0.5 font-medium font-mono">{{ current.activeExecutionSeconds }}s</div>
                    </div>
                    <div class="rounded-lg border border-border/40 bg-background/50 px-2 py-1.5">
                      <div class="text-text-secondary">{{ $t('agent.tasks.verification') }}</div>
                      <div class="mt-0.5 truncate font-medium">
                        {{ $t(`agent.tasks.verificationStatus.${current.verificationStatus}`) }}
                      </div>
                    </div>
                  </div>

                  <!-- 内联手风琴折叠展开：检查点与调试信息就地查看 -->
                  <div class="border-t border-border/40 pt-2">
                    <button
                      type="button"
                      class="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[11px] font-medium text-text-secondary hover:bg-header/60 hover:text-foreground transition-all select-none"
                      @click="showInlineDetails = !showInlineDetails"
                    >
                      <span class="flex items-center gap-1.5">
                        <i class="fa-solid fa-layer-group text-[10px] text-primary" aria-hidden="true"></i>
                        <span>{{ $t('agent.tasks.advancedDetails') }}</span>
                        <span
                          v-if="currentCheckpoints.length"
                          class="rounded-full bg-header px-1.5 py-0.5 text-[11px] text-text-secondary font-mono"
                        >
                          {{ currentCheckpoints.length }}
                        </span>
                      </span>
                      <i
                        class="fa-solid fa-chevron-down text-[8px] text-text-secondary/70 transition-transform duration-200"
                        :class="showInlineDetails ? 'rotate-180' : ''"
                        aria-hidden="true"
                      ></i>
                    </button>

                    <div v-if="showInlineDetails" class="mt-2 space-y-2.5 pt-0.5">
                      <!-- 模型与思考强度 -->
                      <div class="flex flex-wrap items-center gap-1 text-[11px] text-text-secondary">
                        <span class="rounded-md bg-header px-2 py-0.5 font-mono">
                          <i class="fa-solid fa-microchip mr-1 text-[8px]" aria-hidden="true"></i
                          >{{ current.definition.model.modelId }}
                        </span>
                        <span v-if="current.definition.reasoningEffort" class="rounded-md bg-header px-2 py-0.5">
                          <i class="fa-solid fa-brain mr-1 text-[8px]" aria-hidden="true"></i
                          >{{ $t(`agent.ui.reasoningLevels.${current.definition.reasoningEffort}`) }}
                        </span>
                      </div>

                      <!-- 检查点 -->
                      <div class="rounded-lg border border-border/50 bg-background/50 p-2.5">
                        <div class="flex items-center justify-between gap-1 mb-1.5">
                          <span class="text-[11px] font-semibold text-foreground flex items-center gap-1">
                            <i class="fa-solid fa-bookmark text-[8px] text-primary" aria-hidden="true"></i>
                            {{ $t('agent.tasks.checkpoints') }}
                          </span>
                          <button
                            type="button"
                            class="flex items-center gap-1 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-header disabled:opacity-50"
                            :disabled="busy || current.status === 'cancelling' || current.needsReconciliation"
                            @click="emit('saveCheckpoint', current)"
                          >
                            <i class="fa-solid fa-plus text-[7px]" aria-hidden="true"></i>
                            {{ $t('agent.tasks.saveCheckpoint') }}
                          </button>
                        </div>

                        <div v-if="currentCheckpoints.length === 0" class="py-1 text-[11px] text-text-secondary">
                          {{ $t('agent.tasks.noCheckpoints') }}
                        </div>
                        <div v-else class="space-y-1.5 max-h-32 overflow-y-auto">
                          <div
                            v-for="cp in currentCheckpoints"
                            :key="cp.id"
                            class="flex items-center justify-between gap-1 rounded-md border border-border/40 bg-card/80 px-2 py-1 text-[11px]"
                          >
                            <div class="flex min-w-0 items-center gap-1">
                              <div class="truncate font-mono text-foreground">#{{ cp.id.slice(-6) }}</div>
                              <span class="shrink-0 rounded bg-header px-1 py-0.5 text-[11px] text-text-secondary">
                                {{
                                  $t(
                                    cp.kind === 'recovery'
                                      ? 'agent.tasks.autoRecoveryCheckpoint'
                                      : 'agent.tasks.userCheckpoint',
                                  )
                                }}
                              </span>
                            </div>
                            <button
                              v-if="terminal.has(current.status) && cp.kind === 'user'"
                              type="button"
                              class="shrink-0 rounded bg-primary/10 px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
                              :disabled="busy || current.needsReconciliation"
                              @click="emit('resumeCheckpoint', current, cp)"
                            >
                              {{ $t('agent.tasks.resumeCheckpoint') }}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  v-if="current.status === 'awaiting_budget'"
                  type="button"
                  class="mt-3 w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  :disabled="busy || !hardLimits"
                  @click="increase"
                >
                  {{ $t('agent.tasks.increaseBudget') }}
                </button>
              </template>

              <template v-else-if="element.id === 'approvals'">
                <div class="mb-2.5 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5">
                    <i class="fa-solid fa-shield-halved text-[10px] text-warning" aria-hidden="true"></i>
                    <strong class="text-xs">{{ $t('agent.approvals.timeline') }}</strong>
                    <span class="rounded-full bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
                      {{ requestedApprovals.length }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="agent-rail-drag-handle flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-text-secondary hover:bg-header active:cursor-grabbing"
                    :aria-label="$t('agent.tasks.dragCard')"
                  >
                    <i class="fa-solid fa-grip-vertical text-[10px]" aria-hidden="true"></i>
                  </button>
                </div>
                <div v-if="approvalClock" class="space-y-2">
                  <ApprovalCard
                    v-for="approval in requestedApprovals"
                    :key="approval.id"
                    :approval="approval"
                    :clock="approvalClock"
                    :busy="busy"
                    @resolve="(item, decision, feedback) => emit('resolveApproval', item, decision, feedback)"
                  />
                </div>
              </template>

              <template v-else-if="element.id === 'plan' && current">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <strong class="text-xs">{{ $t('agent.tasks.plan') }}</strong>
                    <span class="text-[11px] text-text-secondary">r{{ current.plan.revision }}</span>
                    <span
                      v-if="blockedPlanItems"
                      class="rounded-full bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning"
                    >
                      {{ blockedPlanItems }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="agent-rail-drag-handle flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-text-secondary hover:bg-header active:cursor-grabbing"
                    :aria-label="$t('agent.tasks.dragCard')"
                  >
                    <i class="fa-solid fa-grip-vertical text-[10px]" aria-hidden="true"></i>
                  </button>
                </div>
                <ol class="mt-2.5 space-y-2">
                  <li v-for="item in planItems" :key="item.id" class="relative pl-5">
                    <span
                      class="absolute left-0 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border text-[9px]"
                      :class="
                        item.status === 'completed'
                          ? 'border-success/40 bg-success/10 text-success'
                          : item.status === 'in_progress'
                            ? 'border-border bg-foreground text-background font-semibold'
                            : item.status === 'blocked'
                              ? 'border-warning/40 bg-warning/10 text-warning'
                              : 'border-border bg-card text-text-secondary'
                      "
                    >
                      <i
                        :class="item.status === 'completed' ? 'fa-solid fa-check' : 'fa-solid fa-circle'"
                        aria-hidden="true"
                      ></i>
                    </span>
                    <div class="text-xs font-medium leading-4">{{ item.title }}</div>
                    <p v-if="item.detail" class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-text-secondary">
                      {{ item.detail }}
                    </p>
                  </li>
                </ol>
              </template>

              <template v-else-if="element.id === 'targets' && current">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5 text-xs font-medium">
                    <i class="fa-solid fa-server text-[10px] text-text-secondary" aria-hidden="true"></i>
                    {{ $t('agent.tasks.targets') }}
                  </div>
                  <button
                    type="button"
                    class="agent-rail-drag-handle flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-text-secondary hover:bg-header active:cursor-grabbing"
                    :aria-label="$t('agent.tasks.dragCard')"
                  >
                    <i class="fa-solid fa-grip-vertical text-[10px]" aria-hidden="true"></i>
                  </button>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    v-for="id in current.definition.connectionIds"
                    :key="id"
                    class="rounded-lg bg-header px-2 py-1 text-[11px] text-text-secondary"
                    >#{{ id }}</span
                  >
                </div>
              </template>

              <template v-else-if="element.id === 'history'">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <strong class="text-xs">{{ $t('agent.tasks.history') }}</strong>
                    <span class="text-[11px] text-text-secondary">{{ historyRuns.length }}</span>
                  </div>
                  <button
                    type="button"
                    class="agent-rail-drag-handle flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-text-secondary hover:bg-header active:cursor-grabbing"
                    :aria-label="$t('agent.tasks.dragCard')"
                  >
                    <i class="fa-solid fa-grip-vertical text-[10px]" aria-hidden="true"></i>
                  </button>
                </div>
                <button
                  v-for="item in historyRuns"
                  :key="item.id"
                  type="button"
                  class="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-header/70 last:mb-0"
                  @click="emit('openRun', item)"
                >
                  <span
                    class="h-1.5 w-1.5 shrink-0 rounded-full"
                    :class="
                      item.status === 'completed' || item.status === 'completed_unverified'
                        ? 'bg-success'
                        : item.status === 'failed'
                          ? 'bg-error'
                          : 'bg-text-secondary/50'
                    "
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[11px] font-medium">{{
                      $t(`agent.tasks.runStatus.${item.status}`)
                    }}</span>
                    <span class="mt-0.5 block truncate text-[11px] text-text-secondary">
                      {{ item.definition.model.modelId }} · {{ item.usage.steps }}
                    </span>
                  </span>
                  <i class="fa-solid fa-chevron-right text-[8px] text-text-secondary" aria-hidden="true"></i>
                </button>
              </template>

              <template v-else-if="element.id === 'background'">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <strong class="text-xs">{{ $t('agent.tasks.background') }}</strong>
                    <span class="text-[11px] text-text-secondary">{{ backgroundRuns.length }}</span>
                  </div>
                  <button
                    type="button"
                    class="agent-rail-drag-handle flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-text-secondary hover:bg-header active:cursor-grabbing"
                    :aria-label="$t('agent.tasks.dragCard')"
                  >
                    <i class="fa-solid fa-grip-vertical text-[10px]" aria-hidden="true"></i>
                  </button>
                </div>
                <button
                  v-for="item in backgroundRuns"
                  :key="item.id"
                  type="button"
                  class="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-header/70 last:mb-0"
                  @click="emit('openRun', item)"
                >
                  <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[11px] font-medium">{{
                      $t(`agent.tasks.runStatus.${item.status}`)
                    }}</span>
                    <span class="mt-0.5 block truncate text-[11px] text-text-secondary">
                      {{ threadTitles[item.threadId] || item.threadId }} · {{ item.definition.model.modelId }}
                    </span>
                  </span>
                  <i class="fa-solid fa-chevron-right text-[8px] text-text-secondary" aria-hidden="true"></i>
                </button>
              </template>
            </section>
          </template>
        </draggable>

        <div
          v-else
          class="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 px-4 text-center"
        >
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-header text-text-secondary">
            <i class="fa-regular fa-circle-play" aria-hidden="true"></i>
          </div>
          <p class="mt-3 text-xs leading-5 text-text-secondary">{{ $t('agent.tasks.empty') }}</p>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
  .agent-rail-card {
    transition:
      box-shadow 140ms ease,
      border-color 140ms ease,
      transform 140ms ease;
  }

  .agent-rail-card-ghost {
    opacity: 0.45;
    border-style: dashed;
  }

  .agent-rail-card-chosen {
    border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
  }

  .agent-rail-card-drag {
    box-shadow: 0 16px 36px rgb(0 0 0 / 0.14);
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-rail-card {
      transition: none;
    }
  }
</style>
