<script setup lang="ts">
  import { nextTick, ref, watch } from 'vue';
  import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
  import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
  import type { AgentArtifactRef, AgentLedgerEntry, AgentRunView } from '../api/agent-api';
  import ArtifactPicker from '../files/ArtifactPicker.vue';
  import ConversationMessage from './ConversationMessage.vue';

  const props = defineProps<{
    appId: string;
    entries: AgentLedgerEntry[];
    nextCursor: string | null;
    run: AgentRunView | null;
    streamingText: string;
    draft: string;
    busy: boolean;
    canSend: boolean;
    attachments: AgentArtifactRef[];
  }>();
  const emit = defineEmits<{
    loadOlder: [];
    send: [text: string, attachments: AgentArtifactRef[]];
    cancel: [];
    updateDraft: [value: string];
    updateAttachments: [value: AgentArtifactRef[]];
  }>();

  const scroller = ref<{ scrollToBottom?: () => void } | null>(null);
  const send = () => {
    const text = props.draft.trim();
    if (!text || !props.canSend || props.busy) return;
    emit('send', text, props.attachments);
  };

  watch(
    () => [props.entries.length, props.streamingText] as const,
    async () => {
      await nextTick();
      scroller.value?.scrollToBottom?.();
    },
  );
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background">
    <div class="min-h-0 flex-1">
      <DynamicScroller
        ref="scroller"
        class="h-full overflow-y-auto px-4 py-4"
        :items="entries"
        :min-item-size="64"
        key-field="id"
      >
        <template #before>
          <div class="mx-auto mb-4 flex max-w-3xl justify-center">
            <button
              v-if="nextCursor"
              type="button"
              class="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-text-secondary shadow-sm hover:bg-header hover:text-foreground"
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
            <p class="mt-2 max-w-md text-xs leading-5 text-text-secondary">
              {{ $t('agent.conversation.emptyDescription') }}
            </p>
            <div class="mt-4 flex flex-wrap justify-center gap-2 text-[10px] text-text-secondary">
              <span class="rounded-full border border-border bg-card px-2.5 py-1">{{
                $t('agent.conversation.capabilityContext')
              }}</span>
              <span class="rounded-full border border-border bg-card px-2.5 py-1">{{
                $t('agent.conversation.capabilityTools')
              }}</span>
              <span class="rounded-full border border-border bg-card px-2.5 py-1">{{
                $t('agent.conversation.capabilityEvidence')
              }}</span>
            </div>
          </div>
        </template>
        <template #default="{ item, index, active }">
          <DynamicScrollerItem :item="item" :active="active" :index="index" class="mb-4">
            <ConversationMessage :entry="item" />
          </DynamicScrollerItem>
        </template>
        <template #after>
          <div v-if="streamingText" class="mx-auto mb-4 flex w-full max-w-3xl gap-3">
            <div
              class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-[10px] text-primary"
            >
              <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            </div>
            <div class="min-w-0 flex-1 px-1 py-1 text-sm leading-6">
              <div class="mb-1 flex items-center gap-2 text-[10px] font-semibold text-text-secondary">
                <span>{{ $t('agent.conversation.streaming') }}</span>
                <span class="flex gap-0.5" aria-hidden="true"><span>·</span><span>·</span><span>·</span></span>
              </div>
              <pre class="whitespace-pre-wrap break-words font-sans">{{ streamingText }}</pre>
            </div>
          </div>
        </template>
      </DynamicScroller>
    </div>

    <footer class="shrink-0 border-t border-border/70 bg-card/70 px-3 pb-3 pt-2">
      <div class="mx-auto max-w-3xl">
        <div v-if="attachments.length" class="mb-2 flex flex-wrap gap-1.5">
          <button
            v-for="artifact in attachments"
            :key="artifact.id"
            type="button"
            class="max-w-56 truncate rounded-full border border-border bg-background px-2.5 py-1 text-[10px] hover:bg-header"
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
          class="rounded-2xl border border-border bg-background shadow-sm transition-shadow focus-within:border-primary/60 focus-within:shadow-md"
        >
          <textarea
            :value="draft"
            rows="2"
            class="max-h-36 min-h-14 w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-sm leading-5 outline-none"
            :placeholder="$t('agent.conversation.placeholder')"
            @input="emit('updateDraft', ($event.target as HTMLTextAreaElement).value)"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <div class="flex items-center justify-between gap-2 px-2 pb-2">
            <div class="flex min-w-0 items-center gap-1.5">
              <ArtifactPicker
                :app-id="appId"
                :model-value="attachments"
                :disabled="busy"
                @update:model-value="emit('updateAttachments', $event)"
              />
              <span
                v-if="run"
                class="hidden max-w-44 truncate rounded-full bg-header px-2 py-1 text-[9px] font-medium text-text-secondary sm:inline"
              >
                {{ $t('agent.conversation.runState', { state: $t(`agent.tasks.runStatus.${run.status}`) }) }}
              </span>
              <span class="hidden text-[9px] text-text-secondary md:inline">{{
                $t('agent.conversation.sendHint')
              }}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                v-if="run && ['created', 'running', 'awaiting_approval', 'awaiting_budget'].includes(run.status)"
                type="button"
                class="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-medium text-error hover:bg-error/10"
                :disabled="busy || run.status === 'cancelling'"
                @click="emit('cancel')"
              >
                <i class="fa-solid fa-stop text-[9px]" aria-hidden="true"></i>
                <span class="hidden sm:inline">{{ $t('agent.conversation.cancelRun') }}</span>
              </button>
              <button
                type="button"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[11px] font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="busy || !canSend || !draft.trim()"
                @click="send"
              >
                <span>{{ $t('agent.conversation.send') }}</span>
                <i class="fa-solid fa-arrow-up text-[9px]" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  </section>
</template>
