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
        class="h-full overflow-y-auto px-4 py-3"
        :items="entries"
        :min-item-size="54"
        key-field="id"
      >
        <template #before>
          <div class="mb-3 flex justify-center">
            <button
              v-if="nextCursor"
              type="button"
              class="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-header"
              :disabled="busy"
              @click="emit('loadOlder')"
            >
              {{ $t('agent.conversation.loadOlder') }}
            </button>
          </div>
        </template>
        <template #default="{ item, index, active }">
          <DynamicScrollerItem :item="item" :active="active" :index="index" class="mb-3">
            <ConversationMessage :entry="item" />
          </DynamicScrollerItem>
        </template>
        <template #after>
          <div v-if="streamingText" class="mb-3 flex justify-start">
            <div class="max-w-[88%] rounded-xl border border-border/60 bg-card px-3 py-2 text-sm shadow-sm">
              <div class="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                {{ $t('agent.conversation.streaming') }}
              </div>
              <pre class="whitespace-pre-wrap break-words font-sans">{{ streamingText }}</pre>
            </div>
          </div>
        </template>
      </DynamicScroller>
    </div>

    <footer class="shrink-0 border-t border-border bg-card p-3">
      <div v-if="run" class="mb-2 flex items-center justify-between gap-3 text-xs text-text-secondary">
        <span>{{ $t('agent.conversation.runState', { state: run.status }) }}</span>
        <button
          v-if="['created', 'running', 'awaiting_approval', 'awaiting_budget'].includes(run.status)"
          type="button"
          class="rounded-md px-2 py-1 text-error hover:bg-error/10"
          :disabled="busy || run.status === 'cancelling'"
          @click="emit('cancel')"
        >
          {{ $t('agent.conversation.cancelRun') }}
        </button>
      </div>
      <div v-if="attachments.length" class="mb-2 flex flex-wrap gap-1.5">
        <button
          v-for="artifact in attachments"
          :key="artifact.id"
          type="button"
          class="max-w-52 truncate rounded-full border border-border px-2 py-1 text-[11px] hover:bg-header"
          :title="artifact.originalName"
          @click="
            emit(
              'updateAttachments',
              attachments.filter((item) => item.id !== artifact.id),
            )
          "
        >
          <i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>{{ artifact.originalName }} ×
        </button>
      </div>
      <div class="flex items-end gap-2">
        <ArtifactPicker
          :app-id="appId"
          :model-value="attachments"
          :disabled="busy"
          @update:model-value="emit('updateAttachments', $event)"
        />
        <textarea
          :value="draft"
          rows="2"
          class="max-h-36 min-h-12 flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          :placeholder="$t('agent.conversation.placeholder')"
          @input="emit('updateDraft', ($event.target as HTMLTextAreaElement).value)"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button
          type="button"
          class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || !canSend || !draft.trim()"
          @click="send"
        >
          {{ $t('agent.conversation.send') }}
        </button>
      </div>
    </footer>
  </section>
</template>
