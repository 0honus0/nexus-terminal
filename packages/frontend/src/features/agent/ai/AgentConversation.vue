<script setup lang="ts">
  import { computed, nextTick, ref, watch } from 'vue';
  import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
  import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
  import type { AgentArtifactRef, AgentLedgerEntry, AgentRunView } from '../api/agent-api';
  import type { ConversationCommandResult } from './conversation-command-executor';
  import ArtifactPicker from '../files/ArtifactPicker.vue';
  import AgentMessageBody from './AgentMessageBody.vue';
  import ConversationMessage from './ConversationMessage.vue';
  import { conversationCommandSuggestions, type ConversationCommandSuggestion } from './conversation-commands';

  const props = defineProps<{
    appId: string;
    error?: string;
    reconciliation?: boolean;
    entries: AgentLedgerEntry[];
    nextCursor: string | null;
    run: AgentRunView | null;
    streamingText: string;
    draft: string;
    busy: boolean;
    canSend: boolean;
    attachments: AgentArtifactRef[];
    commandResult: ConversationCommandResult | null;
  }>();
  const emit = defineEmits<{
    dismissError: [];
    loadOlder: [];
    send: [text: string, attachments: AgentArtifactRef[]];
    cancel: [];
    updateDraft: [value: string];
    updateAttachments: [value: AgentArtifactRef[]];
    dismissCommandResult: [];
  }>();

  const visibleEntries = computed(() =>
    props.entries.filter((entry) => {
      if (entry.kind !== 'assistant_message') return true;
      const payload = entry.payload;
      if (typeof payload === 'string') return Boolean(payload.trim());
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const text = (payload as Record<string, unknown>).text;
        if (typeof text === 'string') return Boolean(text.trim());
      }
      return true;
    }),
  );
  const showJumpToLatest = ref(false);
  const scroller = ref<{ scrollToBottom?: () => void; $el?: HTMLElement } | null>(null);
  let keepPinnedToBottom = true;
  const commandSuggestions = computed(() => conversationCommandSuggestions(props.draft));
  const applyCommandSuggestion = (suggestion: ConversationCommandSuggestion): void => {
    const needsArgument = suggestion.command === '/goal' || suggestion.command === '/interrupt';
    emit('updateDraft', needsArgument ? `${suggestion.command} ` : suggestion.command);
  };
  const send = () => {
    const text = props.draft.trim();
    if (!text || !props.canSend || props.busy) return;
    emit('send', text, props.attachments);
  };

  const onComposerEnter = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  const isNearBottom = (): boolean => {
    const element = scroller.value?.$el;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 96;
  };

  const scrollToBottom = async (): Promise<void> => {
    await nextTick();
    scroller.value?.scrollToBottom?.();
  };

  const handleScroll = (): void => {
    keepPinnedToBottom = isNearBottom();
    showJumpToLatest.value = !keepPinnedToBottom;
  };

  const handleItemResize = (): void => {
    if (!keepPinnedToBottom) return;
    void scrollToBottom();
  };

  watch(
    () => [props.entries.length, props.streamingText] as const,
    () => {
      keepPinnedToBottom = isNearBottom();
      if (keepPinnedToBottom) void scrollToBottom();
    },
  );

  const totalRunTokens = computed(() => {
    if (!props.run) return 0;
    return props.run.usage.inputTokens + props.run.usage.outputTokens;
  });

  const runCacheRate = computed(() => {
    if (!props.run || props.run.usage.inputTokens <= 0) return 0;
    const rate = (props.run.usage.cachedInputTokens / props.run.usage.inputTokens) * 100;
    return Math.min(100, Math.max(0, Math.round(rate * 10) / 10));
  });

  const formatTokens = (num: number): string => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
  };
</script>

<template>
  <section class="relative flex h-full min-h-0 flex-col bg-background overflow-hidden">
    <!-- 背景极轻环境弥散微光层 -->
    <div class="agent-conversation-ambient pointer-events-none absolute inset-0 z-0 opacity-70"></div>

    <div class="relative z-10 min-h-0 flex-1">
      <DynamicScroller
        ref="scroller"
        class="h-full overflow-y-auto overscroll-contain px-5 py-3.5"
        :items="visibleEntries"
        :min-item-size="64"
        key-field="id"
        @scroll.passive="handleScroll"
      >
        <template #before>
          <div class="mx-auto mb-4 flex max-w-3xl justify-center">
            <button
              v-if="nextCursor"
              type="button"
              class="rounded-full bg-card/80 px-3.5 py-2 text-xs text-text-secondary shadow-sm hover:bg-header hover:text-foreground"
              :disabled="busy"
              @click="emit('loadOlder')"
            >
              <i class="fa-solid fa-clock-rotate-left mr-1.5" aria-hidden="true"></i>
              {{ $t('agent.conversation.loadOlder') }}
            </button>
          </div>
          <div
            v-if="entries.length === 0 && !streamingText"
            class="relative z-10 mx-auto flex min-h-[460px] max-w-3xl flex-col items-center justify-center px-4 py-4 text-center select-none"
          >
            <!-- 顶端微胶囊标识 -->
            <div
              class="mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3.5 py-0.5 text-[10px] font-semibold tracking-wider text-primary shadow-2xs"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></span>
              <span>{{ $t('agent.conversation.heroTag') }}</span>
            </div>

            <!-- 柔和环境光晕与现代卡片图标 -->
            <div class="relative flex items-center justify-center">
              <div class="absolute -inset-4 rounded-3xl bg-primary/20 blur-2xl pointer-events-none"></div>
              <div
                class="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-b from-card to-card/90 text-primary shadow-xl shadow-primary/15 backdrop-blur-xs ring-1 ring-border/30"
              >
                <i class="fa-solid fa-wand-magic-sparkles text-2xl" aria-hidden="true"></i>
              </div>
            </div>

            <h2 class="mt-4 text-xl font-bold tracking-tight text-foreground">
              {{ $t('agent.conversation.emptyTitle') }}
            </h2>
            <p class="mt-1.5 max-w-sm text-xs leading-relaxed text-text-secondary/80">
              {{ $t('agent.conversation.emptyDescription') }}
            </p>

            <!-- 现代化便当盒磁贴 (Bento Grid) -->
            <div class="mt-6.5 grid w-full grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button
                type="button"
                class="group relative flex items-center rounded-2xl border border-border/75 bg-gradient-to-br from-primary/[0.04] via-card to-card p-3.5 text-left shadow-[0_1px_3px_rgba(0,0,0,0.03),0_4px_12px_rgba(0,0,0,0.02)] backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_8px_24px_rgba(160,108,213,0.12)] active:scale-[0.99]"
                @click="emit('updateDraft', $t('agent.ui.promptExplain'))"
              >
                <div class="flex items-start gap-3.5 w-full">
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs group-hover:scale-105 group-hover:bg-primary/15 transition-all"
                  >
                    <i class="fa-solid fa-code text-sm" aria-hidden="true"></i>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between">
                      <span
                        class="text-[13px] font-bold tracking-tight text-foreground group-hover:text-primary transition-colors"
                      >
                        {{ $t('agent.conversation.bentoExplainTitle') }}
                      </span>
                      <span
                        class="text-xs text-text-secondary/40 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
                        aria-hidden="true"
                        >↗</span
                      >
                    </div>
                    <p class="mt-1 text-xs leading-relaxed text-text-secondary/75">
                      {{ $t('agent.conversation.bentoExplainDesc') }}
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                class="group relative flex items-center rounded-2xl border border-border/75 bg-gradient-to-br from-emerald-500/[0.04] via-card to-card p-3.5 text-left shadow-[0_1px_3px_rgba(0,0,0,0.03),0_4px_12px_rgba(0,0,0,0.02)] backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/45 hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)] active:scale-[0.99]"
                @click="emit('updateDraft', $t('agent.ui.promptDiagnose'))"
              >
                <div class="flex items-start gap-3.5 w-full">
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-2xs group-hover:scale-105 group-hover:bg-emerald-500/15 transition-all"
                  >
                    <i class="fa-solid fa-shield-halved text-sm" aria-hidden="true"></i>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between">
                      <span
                        class="text-[13px] font-bold tracking-tight text-foreground group-hover:text-emerald-500 transition-colors"
                      >
                        {{ $t('agent.conversation.bentoDiagnoseTitle') }}
                      </span>
                      <span
                        class="text-xs text-text-secondary/40 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-emerald-500"
                        aria-hidden="true"
                        >↗</span
                      >
                    </div>
                    <p class="mt-1 text-xs leading-relaxed text-text-secondary/75">
                      {{ $t('agent.conversation.bentoDiagnoseDesc') }}
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </template>
        <template #default="{ item, index, active }">
          <DynamicScrollerItem
            :item="item"
            :active="active"
            :index="index"
            :emit-resize="true"
            :size-dependencies="[item.payload]"
            class="mb-4"
            @resize="handleItemResize"
          >
            <ConversationMessage :entry="item" />
          </DynamicScrollerItem>
        </template>
        <template #after>
          <div v-if="streamingText" class="mx-auto mb-4 flex w-full max-w-3xl gap-3">
            <div
              class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs text-primary"
            >
              <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            </div>
            <div class="min-w-0 flex-1 px-1 py-1 text-sm leading-6">
              <div class="mb-1 flex items-center gap-2 text-xs font-semibold text-text-secondary">
                <span>{{ $t('agent.conversation.streaming') }}</span>
                <span class="flex gap-0.5" aria-hidden="true"><span>·</span><span>·</span><span>·</span></span>
              </div>
              <AgentMessageBody :text="streamingText" />
            </div>
          </div>
        </template>
      </DynamicScroller>
    </div>

    <footer class="relative z-10 shrink-0 bg-background/90 backdrop-blur-xs px-4 pb-4 pt-2">
      <div class="mx-auto max-w-3xl">
        <div
          v-if="error || reconciliation"
          class="mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5"
          :class="
            reconciliation ? 'border-warning/40 bg-warning/5 text-warning' : 'border-error/30 bg-error/5 text-error'
          "
          role="alert"
        >
          <i class="fa-solid fa-circle-exclamation mt-1" aria-hidden="true"></i>
          <span class="min-w-0 flex-1 break-words">{{
            reconciliation ? $t('agent.operations.reconciliationRequired') : error
          }}</span>
          <button v-if="!reconciliation" type="button" :aria-label="$t('common.close')" @click="emit('dismissError')">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <div
          v-if="commandResult"
          class="mb-2 rounded-xl border px-3 py-2.5 text-xs shadow-sm"
          :class="
            commandResult.tone === 'error'
              ? 'border-error/30 bg-error/5 text-error'
              : 'border-primary/20 bg-primary/5 text-foreground'
          "
          :role="commandResult.tone === 'error' ? 'alert' : 'status'"
          :aria-label="$t('agent.conversation.commands.resultLabel')"
          aria-live="polite"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <strong class="block font-semibold">{{ commandResult.title }}</strong>
              <div v-for="(line, index) in commandResult.lines" :key="index" class="mt-1 break-words leading-4">
                {{ line }}
              </div>
            </div>
            <button
              type="button"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-header hover:text-foreground"
              :aria-label="$t('agent.conversation.commands.dismiss')"
              @click="emit('dismissCommandResult')"
            >
              <i class="fa-solid fa-xmark text-[9px]" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div
          v-if="commandSuggestions.length"
          class="mb-2 overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm"
          role="listbox"
          :aria-label="$t('agent.conversation.commands.suggestionsLabel')"
        >
          <button
            v-for="suggestion in commandSuggestions"
            :key="suggestion.command"
            type="button"
            class="flex w-full items-center gap-3 border-b border-border/40 px-3 py-2 text-left last:border-b-0 hover:bg-header/70"
            @click="applyCommandSuggestion(suggestion)"
          >
            <code class="shrink-0 text-xs font-semibold text-primary">{{ suggestion.usage }}</code>
            <span class="truncate text-xs text-text-secondary">{{ $t(suggestion.descriptionKey) }}</span>
          </button>
        </div>

        <div v-if="attachments.length" class="mb-2 flex flex-wrap gap-1.5">
          <button
            v-for="artifact in attachments"
            :key="artifact.id"
            type="button"
            class="max-w-56 truncate rounded-full bg-background/80 px-3 py-1.5 text-xs hover:bg-header"
            :title="artifact.originalName"
            @click="
              emit(
                'updateAttachments',
                attachments.filter((item) => item.id !== artifact.id),
              )
            "
          >
            <i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>{{ artifact.originalName }}
            <span class="ml-1 opacity-60">×</span>
          </button>
        </div>

        <!-- 会话状态与 Token 统计指示条（始终保持整行可见，回到最新消息作为行内局部操作项） -->
        <div
          v-if="showJumpToLatest || (run && (totalRunTokens > 0 || run.usage.steps > 0))"
          class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/60 px-3 py-1.5 text-[11px] text-text-secondary shadow-2xs select-none"
        >
          <div v-if="run && (totalRunTokens > 0 || run.usage.steps > 0)" class="flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center gap-1.5 font-medium text-foreground">
              <i class="fa-solid fa-coins text-[10px] text-foreground/70" aria-hidden="true"></i>
              <span>{{ $t('agent.tasks.totalTokens') || '会话总消耗' }}</span>
              <span class="font-mono font-semibold text-foreground">{{ formatTokens(totalRunTokens) }}</span>
            </span>

            <span class="text-border/70">|</span>

            <span
              class="inline-flex items-center gap-1 text-[10px] text-text-secondary"
              :title="`输入: ${run.usage.inputTokens} · 输出: ${run.usage.outputTokens}`"
            >
              <span
                >入
                <strong class="font-mono font-normal text-foreground/80">{{
                  formatTokens(run.usage.inputTokens)
                }}</strong></span
              >
              <span>·</span>
              <span
                >出
                <strong class="font-mono font-normal text-foreground/80">{{
                  formatTokens(run.usage.outputTokens)
                }}</strong></span
              >
            </span>

            <span
              v-if="run.usage.cachedInputTokens > 0 || runCacheRate > 0"
              class="inline-flex items-center gap-1 rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success"
              :title="`命中缓存: ${run.usage.cachedInputTokens} tokens`"
            >
              <i class="fa-solid fa-bolt text-[9px]" aria-hidden="true"></i>
              <span>缓存率 {{ runCacheRate }}%</span>
            </span>

            <span v-if="run.usage.steps > 0" class="inline-flex items-center gap-1 text-[10px] text-text-secondary">
              <span
                >步数: <strong class="font-mono font-normal text-foreground/80">{{ run.usage.steps }}</strong></span
              >
            </span>
          </div>
          <div v-else class="text-[11px] text-text-secondary flex items-center gap-1.5">
            <i class="fa-solid fa-clock-rotate-left text-[10px]" aria-hidden="true"></i>
            <span>{{ $t('agent.ui.latest') }}</span>
          </div>

          <div class="flex items-center gap-2">
            <!-- 回到最新消息按钮：行内局部显示/隐藏，触发后仅按钮隐藏，整行保持完全可见 -->
            <button
              v-if="showJumpToLatest"
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-foreground px-2.5 py-0.5 text-[10px] font-medium text-background shadow-xs transition hover:bg-foreground/90 active:scale-95"
              :title="$t('agent.ui.latest')"
              @click="scrollToBottom"
            >
              <span>{{ $t('agent.ui.latest') }}</span>
              <i class="fa-solid fa-arrow-down text-[8px]" aria-hidden="true"></i>
            </button>

            <div v-if="run?.budget?.maxRunTokens" class="flex items-center gap-1.5 text-[10px] text-text-secondary">
              <span
                >预算:
                {{ Math.min(100, Math.round((totalRunTokens / Math.max(1, run.budget.maxRunTokens)) * 100)) }}%</span
              >
              <div class="h-1.5 w-16 overflow-hidden rounded-full bg-header">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="totalRunTokens > run.budget.maxRunTokens * 0.9 ? 'bg-warning' : 'bg-foreground'"
                  :style="{
                    width: `${Math.min(100, Math.round((totalRunTokens / Math.max(1, run.budget.maxRunTokens)) * 100))}%`,
                  }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <div
          class="agent-composer-shell rounded-2xl border border-border/80 bg-card/85 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.04)] ring-1 ring-border/20 transition-all duration-200 hover:border-border-hover focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:shadow-[0_8px_32px_rgba(160,108,213,0.12)] overflow-hidden"
        >
          <textarea
            id="agent-composer"
            :aria-label="$t('agent.conversation.placeholder')"
            :value="draft"
            rows="3"
            class="max-h-48 min-h-24 w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[13px] leading-relaxed text-foreground placeholder:text-text-secondary/50 outline-none"
            :placeholder="$t('agent.conversation.placeholder')"
            @input="emit('updateDraft', ($event.target as HTMLTextAreaElement).value)"
            @keydown.enter.exact="onComposerEnter"
          ></textarea>
          <div
            class="agent-composer-toolbar flex min-h-11 items-center justify-between gap-2 border-t border-border/40 bg-card/40 backdrop-blur-xs px-2.5 py-1.5"
          >
            <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
              <ArtifactPicker
                :app-id="appId"
                :model-value="attachments"
                :disabled="busy"
                @update:model-value="emit('updateAttachments', $event)"
              />
              <slot name="configuration" />
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                v-if="run && ['created', 'running', 'awaiting_approval', 'awaiting_budget'].includes(run.status)"
                type="button"
                class="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-error hover:bg-error/10 transition-colors"
                :disabled="busy || run.status === 'cancelling'"
                @click="emit('cancel')"
              >
                <i class="fa-solid fa-stop text-xs" aria-hidden="true"></i>
                <span class="hidden sm:inline">{{ $t('agent.conversation.cancelRun') }}</span>
              </button>
              <button
                type="button"
                class="agent-send-button flex h-8 items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary-hover px-3.5 text-xs font-semibold text-white shadow-sm shadow-primary/25 transition-all hover:brightness-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-25 disabled:bg-foreground/20 disabled:text-text-secondary disabled:shadow-none"
                :aria-label="$t('agent.conversation.send')"
                :title="$t('agent.conversation.send')"
                :disabled="busy || !canSend || !draft.trim()"
                @click="send"
              >
                <span class="agent-send-label">{{ $t('agent.conversation.send') }}</span>
                <i class="fa-solid fa-arrow-up text-xs" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
  .agent-conversation-ambient {
    background: radial-gradient(
      circle at 50% 30%,
      color-mix(in srgb, var(--color-primary) 10%, transparent) 0%,
      color-mix(in srgb, var(--color-primary) 2%, transparent) 40%,
      transparent 70%
    );
  }

  @container agent-hub-window (max-width: 760px) {
    .agent-composer-shell {
      border-radius: 12px;
    }

    #agent-composer {
      min-height: 72px;
      padding: 10px 12px 6px;
      font-size: 12px;
      line-height: 1.55;
    }

    .agent-composer-toolbar {
      min-height: 36px;
      gap: 4px;
      padding: 4px 6px;
    }

    .agent-composer-toolbar > div:first-child {
      gap: 4px;
    }

    .agent-send-button {
      width: 28px;
      height: 28px;
      padding-inline: 0;
      justify-content: center;
      border-radius: 8px;
    }

    .agent-send-label {
      display: none;
    }
  }

  #agent-composer,
  #agent-composer:focus,
  #agent-composer:focus-visible {
    border: 0 !important;
    border-color: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  }
</style>
