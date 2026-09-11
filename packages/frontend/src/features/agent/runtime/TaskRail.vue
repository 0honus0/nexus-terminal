<script setup lang="ts">
  import { computed } from 'vue';
  import type { AgentApprovalView, AgentHardLimits, AgentRunView, AgentServerClockAnchor } from '../api/agent-api';
  import ToolTimeline from './ToolTimeline.vue';

  const props = defineProps<{
    current: AgentRunView | null;
    backgroundRuns: AgentRunView[];
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
  const planItems = computed(() => props.current?.plan.items ?? []);

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
  <aside class="flex h-full min-h-0 flex-col border-l border-border bg-card">
    <header class="shrink-0 border-b border-border px-3 py-2">
      <strong class="text-sm">{{ $t('agent.tasks.title') }}</strong>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <div v-if="current" class="space-y-3">
        <section class="rounded-lg border border-border bg-background p-3">
          <div class="flex items-center justify-between gap-2">
            <strong class="truncate text-sm">{{ $t('agent.tasks.current') }}</strong>
            <span class="rounded-full bg-header px-2 py-0.5 text-[10px]">
              {{ $t(`agent.tasks.runStatus.${current.status}`) }}
            </span>
          </div>
          <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text-secondary">
            <dt>{{ $t('agent.tasks.tokens') }}</dt>
            <dd class="text-right">{{ tokenUsage }} / {{ current.budget.maxRunTokens }}</dd>
            <dt>{{ $t('agent.tasks.steps') }}</dt>
            <dd class="text-right">{{ current.usage.steps }} / {{ current.budget.maxRunSteps }}</dd>
            <dt>{{ $t('agent.tasks.activeTime') }}</dt>
            <dd class="text-right">
              {{ current.activeExecutionSeconds }} / {{ current.budget.maxActiveExecutionSeconds }}s
            </dd>
            <dt>{{ $t('agent.tasks.verification') }}</dt>
            <dd class="truncate text-right">
              {{ $t(`agent.tasks.verificationStatus.${current.verificationStatus}`) }}
            </dd>
          </dl>
          <button
            v-if="current.status === 'awaiting_budget'"
            type="button"
            class="mt-3 w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
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

        <details v-if="planItems.length" open class="rounded-lg border border-border bg-background p-3">
          <summary class="cursor-pointer text-xs font-medium">
            {{ $t('agent.tasks.plan') }} · r{{ current.plan.revision }}
          </summary>
          <ol class="mt-2 space-y-2">
            <li v-for="item in planItems" :key="item.id" class="rounded border border-border bg-card p-2">
              <div class="flex items-start justify-between gap-2">
                <span class="min-w-0 text-xs font-medium">{{ item.title }}</span>
                <span class="shrink-0 rounded bg-header px-1.5 py-0.5 text-[9px]">
                  {{ $t(`agent.tasks.planStatus.${item.status}`) }}
                </span>
              </div>
              <p v-if="item.detail" class="mt-1 whitespace-pre-wrap text-[10px] text-text-secondary">
                {{ item.detail }}
              </p>
              <div
                v-if="item.dependsOn.length || item.evidenceRefs.length"
                class="mt-2 space-y-1 text-[9px] text-text-secondary"
              >
                <div v-if="item.dependsOn.length" class="break-words">
                  {{ $t('agent.tasks.planDependsOn') }}: {{ item.dependsOn.join(', ') }}
                </div>
                <div v-if="item.evidenceRefs.length" class="break-words">
                  {{ $t('agent.tasks.planEvidence') }}: {{ item.evidenceRefs.join(', ') }}
                </div>
              </div>
            </li>
          </ol>
        </details>

        <section
          v-if="current.definition.connectionIds.length"
          class="rounded-lg border border-border bg-background p-3"
        >
          <strong class="text-xs">{{ $t('agent.tasks.targets') }}</strong>
          <div class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="id in current.definition.connectionIds"
              :key="id"
              class="rounded bg-header px-2 py-1 text-[10px]"
              >#{{ id }}</span
            >
          </div>
        </section>
      </div>
      <p v-else class="text-xs text-text-secondary">{{ $t('agent.tasks.empty') }}</p>

      <section v-if="backgroundRuns.length" class="mt-4">
        <strong class="text-xs">{{ $t('agent.tasks.background') }}</strong>
        <button
          v-for="item in backgroundRuns"
          :key="item.id"
          type="button"
          class="mt-2 block w-full rounded-lg border border-border bg-background p-2 text-left hover:bg-header"
          @click="emit('openRun', item)"
        >
          <span class="block truncate text-xs font-medium">{{ $t(`agent.tasks.runStatus.${item.status}`) }}</span>
          <span class="mt-1 block truncate text-[10px] text-text-secondary">{{ item.threadId }}</span>
        </button>
      </section>
    </div>
  </aside>
</template>
