<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import type { AgentLedgerEntryDto } from '../api/agent-api';
  import AgentMessageBody from './AgentMessageBody.vue';
  const props = defineProps<{ entry: AgentLedgerEntryDto; relatedToolName?: string }>();
  const emit = defineEmits<{ layoutChange: [] }>();
  const root = ref<HTMLElement | null>(null);
  let resizeObserver: ResizeObserver | null = null;
  let resizeFrame: number | null = null;
  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || !root.value) return;
    resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        emit('layoutChange');
      });
    });
    resizeObserver.observe(root.value);
  });
  onBeforeUnmount(() => {
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeObserver?.disconnect();
  });
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const payload = computed(() => record(props.entry.payload));
  const text = computed(() => {
    const rawPayload = props.entry.payload;
    const value = record(rawPayload);
    for (const key of ['text', 'summary', 'message']) {
      if (typeof value?.[key] === 'string') return value[key] as string;
    }
    return typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload, null, 2);
  });
  const toolResult = computed(() => {
    try {
      return record(JSON.parse(text.value));
    } catch {
      return record(props.entry.payload);
    }
  });
  const formattedToolOutput = computed(() => {
    try {
      return JSON.stringify(JSON.parse(text.value), null, 2);
    } catch {
      const result = toolResult.value;
      return result ? JSON.stringify(result, null, 2) : text.value;
    }
  });
  interface ToolCallView {
    id: string;
    name: string;
    argumentsJson: string;
    formattedArguments: string;
  }
  const formatJson = (value: string): string => {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  };
  const toolCalls = computed<ToolCallView[]>(() => {
    if (!Array.isArray(payload.value?.toolCalls)) return [];
    return payload.value.toolCalls.flatMap((candidate) => {
      const call = record(candidate);
      if (!call || typeof call.name !== 'string') return [];
      const argumentsJson = typeof call.argumentsJson === 'string' ? call.argumentsJson : '{}';
      return [
        {
          id: typeof call.id === 'string' ? call.id : '',
          name: call.name,
          argumentsJson,
          formattedArguments: formatJson(argumentsJson),
        },
      ];
    });
  });
  const isToolCallEntry = computed(() => props.entry.kind === 'assistant_message' && toolCalls.value.length > 0);
  const toolSummary = computed(() => {
    for (const key of ['summary', 'message', 'error']) {
      const value = toolResult.value?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    // Keep unstructured output in the disclosure, never present a JSON dump as a summary.
    return null;
  });
  const toolName = computed(() => {
    const value = props.relatedToolName || payload.value?.toolName || toolResult.value?.toolName;
    return typeof value === 'string' ? value : '';
  });
  const failed = computed(() => toolResult.value?.ok === false || toolResult.value?.status === 'failed');
  const toolErrorCode = computed(() => {
    const value = toolResult.value?.errorCode;
    return typeof value === 'string' && value ? value : '';
  });
  const friendlyFailureByCode: Readonly<Record<string, string>> = {
    RESOURCE_QUARANTINED: '目标资源因先前修改或资源锁状态仍需对账而处于隔离状态；请先核验现场并完成对账。',
    RECONCILIATION_REQUIRED: '先前修改仍需要对账，当前修改没有执行。',
    LEASE_CONFLICT: '目标资源正被另一个操作占用，请等待该操作完成或停止后重试。',
    LEASE_LOST: '执行期间资源锁已丢失，无法确认继续执行是否安全。',
    APPROVAL_STALE: '批准后目标、输入、策略或资源状态发生变化，本次操作已作废且未执行。',
    MUTATION_ALREADY_CONFIRMED: '同一 Run 中完全相同的修改已经确认成功，本次重复提议已被安全跳过，没有再次执行。',
    ECONNREFUSED: '远端端点拒绝连接；请检查服务是否监听、地址端口是否正确以及网络路径。',
    ENOTFOUND: '无法解析目标主机名；请检查主机名或 DNS。',
    ETIMEDOUT: '连接或操作超时；目标可能不可达、响应过慢或被网络策略阻断。',
  };
  const visibleToolSummary = computed(() => {
    const summary = toolSummary.value;
    const code = toolErrorCode.value;
    if (!failed.value || !code) return summary;
    const friendly = friendlyFailureByCode[code];
    if (!friendly) return summary || code;
    if (!summary || summary === code || summary.endsWith(`: ${code}`) || summary.includes(`: ${code} `)) {
      return `${friendly} [${code}]`;
    }
    return summary;
  });
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
  <article ref="root" v-if="isToolCallEntry" class="mx-auto w-full max-w-3xl" data-testid="agent-tool-call-entry">
    <details class="group/tool-call" @toggle="emit('layoutChange')">
      <summary
        data-testid="agent-tool-call-summary"
        class="relative flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-1.5 text-[11px] text-text-secondary transition-colors select-none hover:bg-header/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        <span class="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <span class="absolute h-2 w-2 rounded-full bg-primary ring-4 ring-primary/10"></span>
        </span>
        <span class="min-w-0 truncate text-[10px] font-semibold text-foreground/90">
          {{ $t('agent.conversation.toolCall') }}
        </span>
        <span
          v-if="toolCalls.length > 1"
          data-testid="agent-tool-call-count"
          class="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-primary"
        >
          {{ toolCalls.length }}
        </span>
        <span class="ml-auto flex h-5 w-5 items-center justify-center text-text-secondary/55">
          <i
            class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150 group-open/tool-call:rotate-180"
            aria-hidden="true"
          ></i>
        </span>
      </summary>
      <div class="ml-4 mt-1.5 space-y-2 border-l border-primary/20 pl-5">
        <div
          v-for="call in toolCalls"
          :key="call.id || call.name"
          class="min-w-0"
          data-testid="agent-tool-call-detail"
          :data-tool-name="call.name"
        >
          <div class="mb-1.5 flex min-w-0 items-center gap-1.5 text-[9px] text-text-secondary/60">
            <code class="min-w-0 truncate font-mono font-semibold text-foreground/80">{{ call.name }}</code>
            <span aria-hidden="true">·</span>
            <span class="shrink-0">{{ $t('agent.conversation.toolArguments') }}</span>
          </div>
          <pre
            class="max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-header/30 px-3 py-2.5 font-mono text-[10px] leading-5 text-foreground/80 ring-1 ring-inset ring-border/30"
            >{{ call.formattedArguments }}</pre>
        </div>
      </div>
    </details>
  </article>

  <article
    ref="root"
    v-else-if="entry.kind === 'tool_result' || entry.kind === 'system_notice'"
    class="mx-auto w-full max-w-3xl"
  >
    <details class="group/result ml-4 border-l border-border/40 pl-5" @toggle="emit('layoutChange')">
      <summary
        class="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-1.5 text-[11px] transition-colors select-none hover:bg-header/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        :class="failed ? 'hover:bg-error/[0.055]' : ''"
      >
        <span
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          :class="
            failed
              ? 'bg-error/10 text-error ring-1 ring-error/15'
              : entry.kind === 'tool_result'
                ? 'bg-success/10 text-success ring-1 ring-success/15'
                : 'bg-primary/10 text-primary ring-1 ring-primary/15'
          "
        >
          <i
            class="text-[9px]"
            :class="
              failed
                ? 'fa-solid fa-triangle-exclamation'
                : entry.kind === 'tool_result'
                  ? 'fa-solid fa-check'
                  : 'fa-solid fa-circle-info'
            "
            aria-hidden="true"
          ></i>
        </span>
        <code
          v-if="toolName"
          class="shrink-0 font-mono text-[10px] font-semibold"
          :class="failed ? 'text-error' : 'text-foreground/80'"
        >
          {{ toolName }}
        </code>
        <span class="min-w-0 flex flex-1 items-baseline overflow-hidden">
          <span
            v-if="visibleToolSummary"
            class="min-w-0 truncate text-[10px] text-text-secondary/75"
            :title="visibleToolSummary"
          >
            {{ visibleToolSummary }}
          </span>
        </span>
        <span
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-secondary/65 transition-colors group-hover:bg-background/70 group-hover:text-foreground/70"
        >
          <i
            class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150 group-open/result:rotate-180"
            aria-hidden="true"
          ></i>
        </span>
      </summary>
      <div class="ml-7 mt-2 rounded-lg bg-header/25 px-3 py-2.5 ring-1 ring-inset ring-border/30">
        <div
          class="mb-2 flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.08em] text-text-secondary/55"
        >
          <i class="fa-solid fa-code text-[8px]" aria-hidden="true"></i>
          <span>{{ $t('agent.conversation.jsonLabel') }}</span>
        </div>
        <pre
          class="max-h-72 overflow-auto whitespace-pre font-mono text-[10px] leading-5 text-foreground/80 tabular-nums"
          >{{ formattedToolOutput }}</pre>
      </div>
    </details>
  </article>
  <article
    ref="root"
    v-else-if="isUser || text?.trim()"
    class="mx-auto flex w-full max-w-3xl"
    :class="isUser ? 'justify-end' : ''"
  >
    <div
      class="group/message min-w-0"
      :class="
        isUser
          ? 'max-w-[80%] rounded-2xl rounded-tr-[5px] bg-primary/[0.07] px-4 py-3.5 text-foreground ring-1 ring-inset ring-primary/10 shadow-[0_1px_2px_rgba(0,0,0,0.025)]'
          : 'w-full'
      "
    >
      <div v-if="!isUser" class="mb-2.5 flex items-center gap-2 px-1 text-[10px] font-medium text-text-secondary/70">
        <span class="h-1.5 w-1.5 rounded-full bg-primary"></span>
        <span>{{ $t('agent.conversation.kind.assistant_message') }}</span>
        <span
          v-if="messageUsage"
          class="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md bg-header/35 px-1.5 py-0.5 text-[9px] text-text-secondary/75 select-none"
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
        </span>
      </div>
      <p v-if="isUser" class="whitespace-pre-wrap break-words text-[13px] leading-[1.7]">
        <span>{{ text }}</span>
        <span
          v-if="messageUsage"
          class="ml-2 inline-flex whitespace-nowrap align-middle items-center gap-1 rounded-md bg-header/35 px-1.5 py-0.5 text-[9px] leading-none text-text-secondary/70 select-none"
          :title="`预估 Token: ${messageUsage.totalTokens}`"
        >
          <i class="fa-solid fa-coins text-[7px] text-text-secondary/65" aria-hidden="true"></i>
          <span class="font-mono">{{ formatTokens(messageUsage.totalTokens) }} tok</span>
        </span>
      </p>
      <div
        v-else
        class="rounded-xl bg-card/45 px-4 py-3.5 ring-1 ring-inset ring-border/30 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
      >
        <AgentMessageBody :text="text" />
      </div>
    </div>
  </article>
</template>
