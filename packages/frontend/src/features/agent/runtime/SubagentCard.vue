<script setup lang="ts">
  import type { AgentSubagentView } from '../api/agent-api';

  const props = defineProps<{
    delegation: AgentSubagentView;
    selected: boolean;
    busy: boolean;
  }>();

  defineEmits<{
    select: [delegation: AgentSubagentView];
    cancel: [delegation: AgentSubagentView];
  }>();

  const terminal = new Set(['completed', 'failed', 'cancelled']);
  const percent = (): number => {
    const max = Math.max(1, props.delegation.budget.maxTokens);
    return Math.min(100, Math.round((props.delegation.usage.tokens / max) * 100));
  };
</script>

<template>
  <article
    class="rounded border p-3 transition-colors"
    :class="selected ? 'border-primary bg-primary/5' : 'border-border bg-background'"
  >
    <button type="button" class="w-full text-left" @click="$emit('select', delegation)">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate text-xs font-medium">{{ delegation.objective }}</div>
          <div class="mt-0.5 truncate font-mono text-[10px] text-text-secondary">
            {{ delegation.modelRef.providerId }}/{{ delegation.modelRef.modelId }}
          </div>
        </div>
        <span class="shrink-0 rounded bg-header px-1.5 py-0.5 text-[10px]">{{ delegation.status }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-secondary">
        <span>{{ $t('agent.subagents.depth', { value: delegation.depth }) }}</span>
        <span>{{
          $t('agent.subagents.steps', { used: delegation.usage.steps, max: delegation.budget.maxSteps })
        }}</span>
        <span>{{
          $t('agent.subagents.tokens', { used: delegation.usage.tokens, max: delegation.budget.maxTokens })
        }}</span>
      </div>
      <div class="mt-2 h-1 overflow-hidden rounded bg-header">
        <div class="h-full bg-primary" :style="{ width: `${percent()}%` }"></div>
      </div>
    </button>
    <div class="mt-2 flex items-center justify-between gap-2">
      <span class="truncate text-[10px] text-text-secondary"
        >{{ delegation.profileId }} · {{ delegation.failureMode }}</span
      >
      <button
        v-if="!terminal.has(delegation.status)"
        type="button"
        class="rounded border border-border px-2 py-1 text-[10px] hover:bg-header disabled:opacity-50"
        :disabled="busy"
        @click.stop="$emit('cancel', delegation)"
      >
        {{ $t('agent.subagents.cancel') }}
      </button>
    </div>
  </article>
</template>
