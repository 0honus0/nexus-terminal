<script setup lang="ts">
  import { computed } from 'vue';
  import type { AgentLedgerEntry } from '../api/agent-api';
  import AgentMessageBody from './AgentMessageBody.vue';
  const props = defineProps<{ entry: AgentLedgerEntry }>();
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const text = computed(() => {
    const payload = props.entry.payload;
    const value = record(payload);
    for (const key of ['text', 'summary', 'message']) {
      if (typeof value?.[key] === 'string') return value[key] as string;
    }
    return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  });
  const toolResult = computed(() => {
    try {
      return record(JSON.parse(text.value));
    } catch {
      return record(props.entry.payload);
    }
  });
  const toolSummary = computed(() => {
    for (const key of ['summary', 'message', 'error']) {
      const value = toolResult.value?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    // Keep unstructured output in the disclosure, never present a JSON dump as a summary.
    return null;
  });
  const toolName = computed(() => {
    const payload = record(props.entry.payload);
    const value = payload?.toolName ?? toolResult.value?.toolName;
    return typeof value === 'string' ? value : '';
  });
  const failed = computed(() => toolResult.value?.ok === false || toolResult.value?.status === 'failed');
  const isUser = computed(() => props.entry.kind === 'user_input');
</script>

<template>
  <article v-if="entry.kind === 'tool_result' || entry.kind === 'system_notice'" class="mx-auto w-full max-w-3xl pl-0">
    <details class="group rounded-xl border border-border/60 bg-header/20" :class="failed ? 'border-error/30' : ''">
      <summary class="flex cursor-pointer list-none items-start gap-3 px-4 py-3 text-xs">
        <i
          class="mt-1 shrink-0"
          :class="
            failed
              ? 'fa-solid fa-circle-exclamation text-error'
              : entry.kind === 'tool_result'
                ? 'fa-solid fa-terminal text-text-secondary'
                : 'fa-solid fa-circle-info text-text-secondary'
          "
          aria-hidden="true"
        ></i>
        <span class="min-w-0 flex-1">
          <span class="font-medium" :class="failed ? 'text-error' : 'text-text-secondary'">{{
            toolName || $t(`agent.conversation.kind.${entry.kind}`)
          }}</span>
          <span class="mt-1 block line-clamp-2 leading-5 text-text-secondary">{{
            toolSummary || (entry.kind === 'system_notice' ? text : $t('agent.ui.toolOutput'))
          }}</span>
        </span>
        <i
          class="fa-solid fa-chevron-down mt-1 text-[10px] text-text-secondary group-open:rotate-180"
          aria-hidden="true"
        ></i>
      </summary>
      <div class="border-t border-border/50 px-4 py-3">
        <div class="mb-2 text-xs text-text-secondary">{{ $t('agent.ui.rawOutput') }} · #{{ entry.sequence }}</div>
        <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6">{{ text }}</pre>
      </div>
    </details>
  </article>
  <article
    v-else-if="isUser || text?.trim()"
    class="mx-auto flex w-full max-w-3xl"
    :class="isUser ? 'justify-end' : ''"
  >
    <div
      class="min-w-0"
      :class="isUser ? 'max-w-[88%] rounded-2xl rounded-tr-md bg-primary/10 px-4 py-3' : 'w-full py-2'"
    >
      <div v-if="!isUser" class="mb-2 flex items-center gap-2 text-xs font-medium text-text-secondary">
        <i class="fa-solid fa-wand-magic-sparkles text-primary" aria-hidden="true"></i
        >{{ $t('agent.conversation.kind.assistant_message') }}
      </div>
      <p v-if="isUser" class="whitespace-pre-wrap break-words text-sm leading-7">{{ text }}</p>
      <AgentMessageBody v-else :text="text" />
    </div>
  </article>
</template>
