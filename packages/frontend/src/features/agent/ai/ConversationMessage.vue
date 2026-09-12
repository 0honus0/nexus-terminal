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
  const isUser = computed(() => props.entry.kind === 'user_input');
  const icon = computed(() => {
    if (props.entry.kind === 'user_input') return 'fa-solid fa-user';
    if (props.entry.kind === 'tool_result') return 'fa-solid fa-terminal';
    if (props.entry.kind === 'system_notice') return 'fa-solid fa-circle-info';
    return 'fa-solid fa-wand-magic-sparkles';
  });
</script>

<template>
  <article class="mx-auto flex w-full max-w-3xl gap-3" :class="isUser ? 'flex-row-reverse' : ''">
    <div
      class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px]"
      :class="isUser ? 'bg-primary text-white' : 'bg-card/80 text-text-secondary'"
    >
      <i :class="icon" aria-hidden="true"></i>
    </div>
    <div class="min-w-0" :class="isUser ? 'max-w-[82%]' : 'max-w-[calc(100%-40px)] flex-1'">
      <div
        class="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-text-secondary"
        :class="isUser ? 'justify-end' : ''"
      >
        <span>{{ $t(`agent.conversation.kind.${entry.kind}`) }}</span>
        <span class="h-1 w-1 rounded-full bg-border"></span>
        <span class="font-normal">#{{ entry.sequence }}</span>
      </div>
      <div
        class="text-sm leading-6"
        :class="
          isUser
            ? 'rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-white shadow-sm'
            : entry.kind === 'tool_result'
              ? 'rounded-2xl bg-card/70 px-4 py-3 font-mono text-[12px]'
              : entry.kind === 'system_notice'
                ? 'rounded-2xl bg-header/40 px-4 py-3 text-text-secondary'
                : 'px-1 py-1 text-foreground'
        "
      >
        <pre class="whitespace-pre-wrap break-words font-sans">{{ text }}</pre>
      </div>
    </div>
  </article>
</template>
