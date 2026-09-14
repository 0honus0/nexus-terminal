<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import draggable from 'vuedraggable';
  import type { AgentApprovalView, AgentHardLimits, AgentRunView, AgentServerClockAnchor } from '../api/agent-api';
  import ApprovalCard from './ApprovalCard.vue';

  const props = defineProps<{
    current: AgentRunView | null;
    backgroundRuns: AgentRunView[];
    threadRuns: AgentRunView[];
    threadTitles: Record<string, string>;
    hardLimits: AgentHardLimits | null;
    approvals: AgentApprovalView[];
    approvalClock: AgentServerClockAnchor | null;
    busy?: boolean;
  }>();
  const emit = defineEmits<{
    openRun: [run: AgentRunView];
    resolveApproval: [approval: AgentApprovalView, decision: 'approved' | 'denied'];
    increaseBudget: [
      increase: Partial<{
        maxRunTokens: number;
        maxRunSteps: number;
        maxActiveExecutionSeconds: number;
        maxCostMicros: number | null;
      }>,
    ];
  }>();

  const tokenUsage = computed(() =>
    props.current ? props.current.usage.inputTokens + props.current.usage.outputTokens : 0,
  );
  const tokenPercent = computed(() =>
    props.current
      ? Math.min(100, Math.round((tokenUsage.value / Math.max(1, props.current.budget.maxRunTokens)) * 100))
      : 0,
  );
  const stepPercent = computed(() =>
    props.current
      ? Math.min(100, Math.round((props.current.usage.steps / Math.max(1, props.current.budget.maxRunSteps)) * 100))
      : 0,
  );
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
      maxRunTokens: number;
      maxRunSteps: number;
      maxActiveExecutionSeconds: number;
      maxCostMicros: number | null;
    }> = {};
    const raise = (current: number, ceiling: number): number | undefined => {
      if (current >= ceiling) return undefined;
      return Math.min(ceiling, Math.max(current + 1, Math.ceil(current * 1.5)));
    };
    const tokens = raise(run.budget.maxRunTokens, hard.maxRunTokens);
    const steps = raise(run.budget.maxRunSteps, hard.maxRunSteps);
    const seconds = raise(run.budget.maxActiveExecutionSeconds, hard.maxActiveExecutionSeconds);
    if (tokens !== undefined) next.maxRunTokens = tokens;
    if (steps !== undefined) next.maxRunSteps = steps;
    if (seconds !== undefined) next.maxActiveExecutionSeconds = seconds;
    if (run.budget.maxRunCostMicros !== null && hard.maxRunCostMicros !== null) {
      const cost = raise(run.budget.maxRunCostMicros, hard.maxRunCostMicros);
      if (cost !== undefined) next.maxCostMicros = cost;
    }
    if (Object.keys(next).length) emit('increaseBudget', next);
  };
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-l border-border/60 bg-card/70">
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-border/60 pl-3.5 pr-11">
      <div class="flex min-w-0 items-center gap-2">
        <div
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] text-primary"
        >
          <i class="fa-solid fa-list-check" aria-hidden="true"></i>
        </div>
        <div class="min-w-0">
          <strong class="block truncate text-xs leading-none">{{ $t('agent.tasks.title') }}</strong>
          <span class="mt-1 block truncate text-[10px] text-text-secondary">{{ $t('agent.tasks.dragHint') }}</span>
        </div>
      </div>
      <span
        v-if="requestedApprovals.length || backgroundRuns.length"
        class="rounded-full bg-header px-2 py-0.5 text-[10px] text-text-secondary"
      >
        {{ requestedApprovals.length + backgroundRuns.length }}
      </span>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <draggable
        v-if="visibleCards.length"
        v-model="visibleCards"
        item-key="id"
        handle=".agent-rail-drag-handle"
        ghost-class="agent-rail-card-ghost"
        chosen-class="agent-rail-card-chosen"
        drag-class="agent-rail-card-drag"
        :animation="160"
        class="space-y-2.5"
      >
        <template #item="{ element }">
          <section
            class="agent-rail-card rounded-2xl border border-border/60 bg-background/80 p-3 shadow-sm"
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
                  <div v-if="planItems.length" class="mt-1 text-[10px] text-text-secondary">
                    {{ completedPlanItems }}/{{ planItems.length }} · {{ planPercent }}%
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] text-text-secondary hover:bg-header hover:text-foreground"
                    @click="emit('openRun', current)"
                  >
                    {{ $t('agent.tasks.openDetail') }}
                  </button>
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
                    <div class="text-[9px] text-text-secondary">{{ $t('agent.tasks.currentFocus') }}</div>
                    <div class="mt-0.5 line-clamp-2 text-xs font-medium leading-4">{{ currentPlanItem.title }}</div>
                  </div>
                </div>
              </div>

              <div
                v-if="attentionKey && attentionKey !== 'reconciliation'"
                class="mt-3 rounded-xl border border-warning/25 bg-warning/5 px-2.5 py-2 text-[10px] leading-4 text-warning"
              >
                <i class="fa-solid fa-triangle-exclamation mr-1 text-[8px]" aria-hidden="true"></i>
                {{ $t(`agent.tasks.attention.${attentionKey}`) }}
              </div>

              <details class="mt-3 border-t border-border/50 pt-2.5">
                <summary class="cursor-pointer text-[10px] text-text-secondary">
                  {{ $t('agent.ui.usageDetails') }}
                </summary>
                <div class="mt-2.5 space-y-2.5">
                  <div>
                    <div class="mb-1 flex items-center justify-between text-[10px] text-text-secondary">
                      <span>{{ $t('agent.tasks.tokens') }}</span>
                      <span>{{ tokenUsage }} / {{ current.budget.maxRunTokens }}</span>
                    </div>
                    <div class="h-1 overflow-hidden rounded-full bg-header">
                      <div class="h-full rounded-full bg-primary" :style="{ width: `${tokenPercent}%` }"></div>
                    </div>
                  </div>
                  <div>
                    <div class="mb-1 flex items-center justify-between text-[10px] text-text-secondary">
                      <span>{{ $t('agent.tasks.steps') }}</span>
                      <span>{{ current.usage.steps }} / {{ current.budget.maxRunSteps }}</span>
                    </div>
                    <div class="h-1 overflow-hidden rounded-full bg-header">
                      <div class="h-full rounded-full bg-primary/70" :style="{ width: `${stepPercent}%` }"></div>
                    </div>
                  </div>
                </div>
                <div class="mt-2.5 grid grid-cols-2 gap-2 border-t border-border/50 pt-2.5 text-[10px]">
                  <div>
                    <div class="text-text-secondary">{{ $t('agent.tasks.verification') }}</div>
                    <div class="mt-0.5 truncate font-medium">
                      {{ $t(`agent.tasks.verificationStatus.${current.verificationStatus}`) }}
                    </div>
                  </div>
                  <div>
                    <div class="text-text-secondary">{{ $t('agent.tasks.activeTime') }}</div>
                    <div class="mt-0.5 font-medium">{{ current.activeExecutionSeconds }}s</div>
                  </div>
                </div>
              </details>

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
                  <span class="rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
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
                  @resolve="(item, decision) => emit('resolveApproval', item, decision)"
                />
              </div>
            </template>

            <template v-else-if="element.id === 'plan' && current">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <strong class="text-xs">{{ $t('agent.tasks.plan') }}</strong>
                  <span class="text-[9px] text-text-secondary">r{{ current.plan.revision }}</span>
                  <span
                    v-if="blockedPlanItems"
                    class="rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning"
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
                    class="absolute left-0 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border text-[7px]"
                    :class="
                      item.status === 'completed'
                        ? 'border-success/40 bg-success/10 text-success'
                        : item.status === 'in_progress'
                          ? 'border-primary/40 bg-primary/10 text-primary'
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
                  <p v-if="item.detail" class="mt-0.5 line-clamp-2 text-[10px] leading-4 text-text-secondary">
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
                  class="rounded-lg bg-header px-2 py-1 text-[10px] text-text-secondary"
                  >#{{ id }}</span
                >
              </div>
            </template>

            <template v-else-if="element.id === 'history'">
              <div class="mb-2 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <strong class="text-xs">{{ $t('agent.tasks.history') }}</strong>
                  <span class="text-[9px] text-text-secondary">{{ historyRuns.length }}</span>
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
                  <span class="block truncate text-[10px] font-medium">{{
                    $t(`agent.tasks.runStatus.${item.status}`)
                  }}</span>
                  <span class="mt-0.5 block truncate text-[9px] text-text-secondary">
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
                  <span class="text-[9px] text-text-secondary">{{ backgroundRuns.length }}</span>
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
                  <span class="block truncate text-[10px] font-medium">{{
                    $t(`agent.tasks.runStatus.${item.status}`)
                  }}</span>
                  <span class="mt-0.5 block truncate text-[9px] text-text-secondary">
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
