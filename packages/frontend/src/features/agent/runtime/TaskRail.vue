<script setup lang="ts">
  import { computed } from 'vue';
  import type { AgentApprovalView, AgentHardLimits, AgentRunView, AgentServerClockAnchor } from '../api/agent-api';
  import ToolTimeline from './ToolTimeline.vue';

  const props = defineProps<{
    current: AgentRunView | null;
    backgroundRuns: AgentRunView[];
    threadRuns: AgentRunView[];
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
  const historyRuns = computed(() => props.threadRuns.filter((item) => item.id !== props.current?.id).slice(0, 8));

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
  <aside class="flex h-full min-h-0 flex-col border-l border-border/80 bg-card/70">
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-3">
      <div class="flex items-center gap-2">
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-[10px] text-primary">
          <i class="fa-solid fa-list-check" aria-hidden="true"></i>
        </div>
        <div>
          <strong class="block text-xs leading-none">{{ $t('agent.tasks.title') }}</strong>
          <span class="mt-1 block text-[9px] text-text-secondary">{{ $t('agent.tasks.activity') }}</span>
        </div>
      </div>
      <span v-if="backgroundRuns.length" class="rounded-full bg-header px-2 py-0.5 text-[9px] text-text-secondary">
        +{{ backgroundRuns.length }}
      </span>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <div v-if="current" class="space-y-3">
        <section class="rounded-xl border border-border bg-background p-3 shadow-sm">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[9px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                {{ $t('agent.tasks.current') }}
              </div>
              <div class="mt-1 flex items-center gap-1.5">
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
            </div>
            <button
              type="button"
              class="flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[9px] font-medium text-text-secondary hover:bg-header hover:text-foreground"
              @click="emit('openRun', current)"
            >
              {{ $t('agent.tasks.openDetail') }}
              <i class="fa-solid fa-chevron-right text-[8px]" aria-hidden="true"></i>
            </button>
          </div>

          <div class="mt-3 space-y-2.5">
            <div>
              <div class="mb-1 flex items-center justify-between text-[9px] text-text-secondary">
                <span>{{ $t('agent.tasks.tokens') }}</span>
                <span>{{ tokenUsage }} / {{ current.budget.maxRunTokens }}</span>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-header">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${tokenPercent}%` }"></div>
              </div>
            </div>
            <div>
              <div class="mb-1 flex items-center justify-between text-[9px] text-text-secondary">
                <span>{{ $t('agent.tasks.steps') }}</span>
                <span>{{ current.usage.steps }} / {{ current.budget.maxRunSteps }}</span>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-header">
                <div class="h-full rounded-full bg-primary/70" :style="{ width: `${stepPercent}%` }"></div>
              </div>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2 border-t border-border/70 pt-2.5 text-[9px]">
            <div class="rounded-lg bg-card px-2 py-1.5">
              <div class="text-text-secondary">{{ $t('agent.tasks.verification') }}</div>
              <div class="mt-0.5 truncate font-medium">
                {{ $t(`agent.tasks.verificationStatus.${current.verificationStatus}`) }}
              </div>
            </div>
            <div class="rounded-lg bg-card px-2 py-1.5">
              <div class="text-text-secondary">{{ $t('agent.tasks.activeTime') }}</div>
              <div class="mt-0.5 font-medium">{{ current.activeExecutionSeconds }}s</div>
            </div>
          </div>

          <button
            v-if="current.status === 'awaiting_budget'"
            type="button"
            class="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-[10px] font-semibold text-white shadow-sm disabled:opacity-50"
            :disabled="busy || !hardLimits"
            @click="increase"
          >
            {{ $t('agent.tasks.increaseBudget') }}
          </button>
        </section>

        <ToolTimeline
          :approvals="approvals"
          :clock="approvalClock"
          :busy="busy"
          @resolve="(approval, decision) => emit('resolveApproval', approval, decision)"
        />

        <section v-if="planItems.length" class="rounded-xl border border-border bg-background p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <strong class="text-[11px]">{{ $t('agent.tasks.plan') }}</strong>
              <div class="mt-0.5 text-[9px] text-text-secondary">r{{ current.plan.revision }}</div>
            </div>
            <span class="rounded-full bg-header px-2 py-0.5 text-[9px] text-text-secondary">
              {{ completedPlanItems }}/{{ planItems.length }}
            </span>
          </div>
          <ol class="mt-3 space-y-2">
            <li v-for="item in planItems" :key="item.id" class="relative pl-5">
              <span
                class="absolute left-0 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[7px]"
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
              <div class="text-[10px] font-medium leading-4">{{ item.title }}</div>
              <p v-if="item.detail" class="mt-0.5 line-clamp-2 text-[9px] leading-4 text-text-secondary">
                {{ item.detail }}
              </p>
            </li>
          </ol>
        </section>

        <section
          v-if="current.definition.connectionIds.length"
          class="rounded-xl border border-border bg-background p-3"
        >
          <div class="flex items-center gap-1.5 text-[10px] font-medium">
            <i class="fa-solid fa-server text-[9px] text-text-secondary" aria-hidden="true"></i>
            {{ $t('agent.tasks.targets') }}
          </div>
          <div class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="id in current.definition.connectionIds"
              :key="id"
              class="rounded-md bg-header px-2 py-1 text-[9px] text-text-secondary"
              >#{{ id }}</span
            >
          </div>
        </section>
      </div>

      <div v-else class="flex min-h-44 flex-col items-center justify-center px-4 text-center">
        <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-header text-text-secondary">
          <i class="fa-regular fa-circle-play" aria-hidden="true"></i>
        </div>
        <p class="mt-3 text-[10px] leading-4 text-text-secondary">{{ $t('agent.tasks.empty') }}</p>
      </div>

      <section v-if="historyRuns.length" class="mt-4 border-t border-border/70 pt-3">
        <div class="mb-2 flex items-center justify-between">
          <strong class="text-[10px]">{{ $t('agent.tasks.history') }}</strong>
          <span class="text-[9px] text-text-secondary">{{ historyRuns.length }}</span>
        </div>
        <button
          v-for="item in historyRuns"
          :key="item.id"
          type="button"
          class="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-transparent bg-background px-2.5 py-2 text-left hover:border-border hover:bg-header"
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
            <span class="block truncate text-[10px] font-medium">{{ $t(`agent.tasks.runStatus.${item.status}`) }}</span>
            <span class="mt-0.5 block truncate text-[8px] text-text-secondary">
              {{ item.definition.model.modelId }} · {{ item.usage.steps }} {{ $t('agent.tasks.steps').toLowerCase() }}
            </span>
          </span>
          <i class="fa-solid fa-chevron-right text-[8px] text-text-secondary" aria-hidden="true"></i>
        </button>
      </section>

      <section v-if="backgroundRuns.length" class="mt-4 border-t border-border/70 pt-3">
        <div class="mb-2 flex items-center justify-between">
          <strong class="text-[10px]">{{ $t('agent.tasks.background') }}</strong>
          <span class="text-[9px] text-text-secondary">{{ backgroundRuns.length }}</span>
        </div>
        <button
          v-for="item in backgroundRuns"
          :key="item.id"
          type="button"
          class="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-transparent bg-background px-2.5 py-2 text-left hover:border-border hover:bg-header"
          @click="emit('openRun', item)"
        >
          <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[10px] font-medium">{{ $t(`agent.tasks.runStatus.${item.status}`) }}</span>
            <span class="mt-0.5 block truncate text-[8px] text-text-secondary">{{ item.threadId }}</span>
          </span>
          <i class="fa-solid fa-chevron-right text-[8px] text-text-secondary" aria-hidden="true"></i>
        </button>
      </section>
    </div>
  </aside>
</template>
