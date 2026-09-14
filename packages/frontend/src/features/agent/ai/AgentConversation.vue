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
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background">
    <div class="min-h-0 flex-1">
      <DynamicScroller
        ref="scroller"
        class="h-full overflow-y-auto overscroll-contain px-5 py-6"
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
            class="mx-auto flex min-h-[300px] max-w-2xl flex-col items-center justify-center px-6 text-center"
          >
            <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-lg text-primary">
              <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            </div>
            <h2 class="mt-4 text-base font-semibold">{{ $t('agent.conversation.emptyTitle') }}</h2>
            <p class="mt-2 max-w-md text-sm leading-6 text-text-secondary">
              {{ $t('agent.conversation.emptyDescription') }}
            </p>
            <div class="mt-6 grid w-full max-w-md gap-2">
              <button
                v-for="key in ['promptExplain', 'promptDiagnose']"
                :key="key"
                type="button"
                class="rounded-xl border border-border/60 px-4 py-3 text-left text-sm text-text-secondary hover:border-primary/40 hover:bg-primary/5"
                @click="emit('updateDraft', $t(`agent.ui.${key}`))"
              >
                {{ $t(`agent.ui.${key}`) }} <span class="float-right" aria-hidden="true">↗</span>
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

    <footer class="shrink-0 bg-background px-4 pb-4 pt-2">
      <div class="mx-auto max-w-3xl">
        <div v-if="showJumpToLatest" class="mb-2 flex justify-center">
          <button
            type="button"
            class="rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-sm"
            @click="scrollToBottom"
          >
            {{ $t('agent.ui.latest') }} ↓
          </button>
        </div>
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

        <div
          class="rounded-2xl border border-border/70 bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/30 focus-within:shadow-sm focus-within:ring-2 focus-within:ring-primary/10"
        >
          <textarea
            id="agent-composer"
            :aria-label="$t('agent.conversation.placeholder')"
            :value="draft"
            rows="3"
            class="max-h-48 min-h-24 w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-sm leading-6 outline-none"
            :placeholder="$t('agent.conversation.placeholder')"
            @input="emit('updateDraft', ($event.target as HTMLTextAreaElement).value)"
            @keydown.enter.exact="onComposerEnter"
          ></textarea>
          <slot name="configuration" />
          <div class="flex items-center justify-between gap-2 px-2 pb-2">
            <div class="flex min-w-0 items-center gap-1.5">
              <ArtifactPicker
                :app-id="appId"
                :model-value="attachments"
                :disabled="busy"
                @update:model-value="emit('updateAttachments', $event)"
              />
            </div>
            <div class="flex items-center gap-1.5">
              <button
                v-if="run && ['created', 'running', 'awaiting_approval', 'awaiting_budget'].includes(run.status)"
                type="button"
                class="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-error hover:bg-error/10"
                :disabled="busy || run.status === 'cancelling'"
                @click="emit('cancel')"
              >
                <i class="fa-solid fa-stop text-xs" aria-hidden="true"></i>
                <span class="hidden sm:inline">{{ $t('agent.conversation.cancelRun') }}</span>
              </button>
              <button
                type="button"
                class="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="busy || !canSend || !draft.trim()"
                @click="send"
              >
                <span>{{ $t('agent.conversation.send') }}</span>
                <i class="fa-solid fa-arrow-up text-xs" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  </section>
</template>
