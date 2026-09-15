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
  interface EntryUsage {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheRate: number;
    estimated?: boolean;
  }

  const messageUsage = computed<EntryUsage | null>(() => {
    const payload = record(props.entry.payload);
    const u = record(payload?.usage);
    if (u && (typeof u.inputTokens === 'number' || typeof u.outputTokens === 'number')) {
      const inTok = typeof u.inputTokens === 'number' ? u.inputTokens : 0;
      const outTok = typeof u.outputTokens === 'number' ? u.outputTokens : 0;
      const cached = typeof u.cachedInputTokens === 'number' ? u.cachedInputTokens : 0;
      const total = inTok + outTok;
      const rate = inTok > 0 ? Math.min(100, Math.round((cached / inTok) * 1000) / 10) : 0;
      return {
        totalTokens: total,
        inputTokens: inTok,
        outputTokens: outTok,
        cachedInputTokens: cached,
        cacheRate: rate,
        estimated: u.estimatedUsage === true,
      };
    }
    if (props.entry.kind === 'assistant_message' || props.entry.kind === 'user_input') {
      const content = text.value || '';
      if (!content.trim()) return null;
      const estimatedTokens = Math.max(1, Math.round(content.length * 0.8));
      return {
        totalTokens: estimatedTokens,
        inputTokens: props.entry.kind === 'user_input' ? estimatedTokens : 0,
        outputTokens: props.entry.kind === 'assistant_message' ? estimatedTokens : 0,
        cachedInputTokens: 0,
        cacheRate: 0,
        estimated: true,
      };
    }
    return null;
  });

  const formatTokens = (num: number): string => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
  };
</script>

<template>
  <article v-if="entry.kind === 'tool_result' || entry.kind === 'system_notice'" class="mx-auto w-full max-w-3xl pl-0">
    <details
      class="group rounded-xl border border-border/60 bg-header/20 transition-all hover:bg-header/30"
      :class="failed ? 'border-error/30 bg-error/5' : ''"
    >
      <summary class="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-xs select-none">
        <i
          class="shrink-0 text-xs"
          :class="
            failed
              ? 'fa-solid fa-circle-exclamation text-error'
              : entry.kind === 'tool_result'
                ? 'fa-solid fa-circle-check text-success'
                : 'fa-solid fa-circle-info text-primary'
          "
          aria-hidden="true"
        ></i>
        <span class="min-w-0 flex-1 truncate">
          <span class="font-medium" :class="failed ? 'text-error' : 'text-foreground'">{{
            toolName || $t(`agent.conversation.kind.${entry.kind}`)
          }}</span>
          <span v-if="toolSummary" class="ml-2 text-text-secondary truncate">
            {{ toolSummary }}
          </span>
        </span>
        <i
          class="fa-solid fa-chevron-down text-[9px] text-text-secondary transition-transform group-open:rotate-180"
          aria-hidden="true"
        ></i>
      </summary>
      <div class="border-t border-border/50 px-4 py-3 bg-background/50 rounded-b-xl">
        <div class="mb-2 text-xs text-text-secondary font-medium">{{ $t('agent.ui.rawOutput') }}</div>
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
      :class="
        isUser
          ? 'max-w-[88%] rounded-2xl rounded-tr-md border border-border/80 bg-card px-4 py-3 shadow-2xs text-foreground'
          : 'w-full py-2'
      "
    >
      <div v-if="!isUser" class="mb-2 flex items-center gap-2 text-xs font-medium text-text-secondary">
        <i class="fa-solid fa-wand-magic-sparkles text-primary" aria-hidden="true"></i
        >{{ $t('agent.conversation.kind.assistant_message') }}
      </div>
      <p v-if="isUser" class="whitespace-pre-wrap break-words text-sm leading-7">{{ text }}</p>
      <AgentMessageBody v-else :text="text" />
      <div v-if="messageUsage" class="mt-1 flex items-center justify-end select-none">
        <div
          class="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-header/60 px-1.5 py-0.5 text-[9px] text-text-secondary shadow-2xs transition-colors hover:border-border hover:bg-header hover:text-foreground"
          :title="
            messageUsage.estimated
              ? `预估 Token: ${messageUsage.totalTokens}`
              : `总消耗: ${messageUsage.totalTokens} (输入: ${messageUsage.inputTokens}, 输出: ${messageUsage.outputTokens})`
          "
        >
          <span class="inline-flex items-center gap-1">
            <i class="fa-solid fa-coins text-[7px] text-text-secondary/70" aria-hidden="true"></i>
            <span class="font-mono">{{ formatTokens(messageUsage.totalTokens) }} tok</span>
          </span>
          <span
            v-if="messageUsage.cacheRate > 0"
            class="inline-flex items-center gap-0.5 border-l border-border/50 pl-1 font-medium text-success"
            :title="`命中缓存: ${messageUsage.cachedInputTokens} tokens`"
          >
            <i class="fa-solid fa-bolt text-[7px]" aria-hidden="true"></i>
            <span>{{ messageUsage.cacheRate }}%</span>
          </span>
        </div>
      </div>
    </div>
  </article>
</template>
