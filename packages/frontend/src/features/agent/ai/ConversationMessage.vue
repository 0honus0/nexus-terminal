<script setup lang="ts">
  import { computed } from 'vue';
  import type { AgentLedgerEntry } from '../api/agent-api';

  const props = defineProps<{ entry: AgentLedgerEntry }>();
  const text = computed(() => {
    const payload = props.entry.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const value = payload as Record<string, unknown>;
      if (typeof value.text === 'string') return value.text;
      if (typeof value.summary === 'string') return value.summary;
      if (typeof value.message === 'string') return value.message;
    }
    return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  });
  const roleClass = computed(() =>
    props.entry.kind === 'user_input'
      ? 'ml-auto bg-primary text-white'
      : props.entry.kind === 'tool_result'
        ? 'bg-header text-foreground'
        : 'bg-card text-foreground',
  );
</script>

<template>
  <article class="flex" :class="entry.kind === 'user_input' ? 'justify-end' : 'justify-start'">
    <div class="max-w-[88%] rounded-xl border border-border/60 px-3 py-2 text-sm shadow-sm" :class="roleClass">
      <div class="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {{ $t(`agent.conversation.kind.${entry.kind}`) }}
      </div>
      <pre class="whitespace-pre-wrap break-words font-sans">{{ text }}</pre>
    </div>
  </article>
</template>
