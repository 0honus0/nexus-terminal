<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { RecycleScroller } from 'vue-virtual-scroller';
  import { agentApi, formatAgentApiError, type AgentArtifactRef } from '../api/agent-api';

  const props = defineProps<{
    appId: string;
    modelValue: AgentArtifactRef[];
    disabled?: boolean;
  }>();
  const emit = defineEmits<{ 'update:modelValue': [value: AgentArtifactRef[]] }>();

  const open = ref(false);
  const items = ref<AgentArtifactRef[]>([]);
  const nextCursor = ref<string | null>(null);
  const query = ref('');
  const busy = ref(false);
  const error = ref('');
  const input = ref<HTMLInputElement | null>(null);
  const selectedIds = computed(() => new Set(props.modelValue.map((item) => item.id)));

  const explain = (cause: unknown): string => formatAgentApiError(cause, 'AGENT_REQUEST_FAILED');

  const load = async (): Promise<void> => {
    busy.value = true;
    error.value = '';
    try {
      const page = await agentApi.files(query.value.trim() ? { q: query.value.trim() } : {});
      items.value = page.items.filter((item) => item.status === 'ready');
      nextCursor.value = page.nextCursor;
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const loadMore = async (): Promise<void> => {
    if (!nextCursor.value || busy.value) return;
    busy.value = true;
    try {
      const page = await agentApi.files({
        ...(query.value.trim() ? { q: query.value.trim() } : {}),
        before: nextCursor.value,
      });
      const known = new Set(items.value.map((item) => item.id));
      items.value.push(...page.items.filter((item) => item.status === 'ready' && !known.has(item.id)));
      nextCursor.value = page.nextCursor;
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const toggle = (artifact: AgentArtifactRef): void => {
    if (props.disabled) return;
    const existing = props.modelValue.find((item) => item.id === artifact.id);
    if (existing) {
      emit(
        'update:modelValue',
        props.modelValue.filter((item) => item.id !== artifact.id),
      );
      return;
    }
    if (props.modelValue.length >= 10) {
      error.value = 'ARTIFACT_REF_LIMIT';
      return;
    }
    emit('update:modelValue', [...props.modelValue, artifact]);
  };

  const upload = async (event: Event): Promise<void> => {
    const target = event.target as HTMLInputElement;
    const files = [...(target.files ?? [])];
    target.value = '';
    if (files.length === 0 || props.disabled) return;
    busy.value = true;
    error.value = '';
    try {
      const available = Math.max(0, 10 - props.modelValue.length);
      const uploaded: AgentArtifactRef[] = [];
      for (const file of files.slice(0, available)) uploaded.push(await agentApi.uploadArtifact(props.appId, file));
      if (uploaded.length) {
        items.value = [...uploaded, ...items.value.filter((item) => !uploaded.some((next) => next.id === item.id))];
        emit('update:modelValue', [...props.modelValue, ...uploaded]);
      }
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  onMounted(load);
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="rounded-lg border border-border px-3 py-2 text-sm hover:bg-header disabled:opacity-50"
      :disabled="disabled"
      @click="open = !open"
    >
      <i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>
      {{ $t('agent.attachments.button', { count: modelValue.length }) }}
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-30 mb-2 flex h-[360px] w-[min(520px,80vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
    >
      <div class="flex shrink-0 gap-2 border-b border-border p-2">
        <input
          v-model="query"
          type="search"
          class="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
          :placeholder="$t('agent.attachments.search')"
          @keydown.enter="load"
        />
        <button type="button" class="rounded-md px-2 py-1.5 text-sm hover:bg-header" :disabled="busy" @click="load">
          {{ $t('agent.attachments.searchAction') }}
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1.5 text-sm hover:bg-header"
          :disabled="busy"
          @click="input?.click()"
        >
          {{ $t('agent.attachments.upload') }}
        </button>
        <input ref="input" type="file" multiple class="hidden" @change="upload" />
      </div>
      <p v-if="error" class="shrink-0 px-3 py-2 text-xs text-error">{{ error }}</p>
      <RecycleScroller class="min-h-0 flex-1 overflow-y-auto" :items="items" :item-size="58" key-field="id">
        <template #default="{ item }">
          <button
            type="button"
            class="flex h-[58px] w-full items-center gap-3 border-b border-border px-3 text-left hover:bg-header"
            :class="selectedIds.has(item.id) ? 'bg-primary/10' : ''"
            @click="toggle(item)"
          >
            <i
              :class="selectedIds.has(item.id) ? 'fa-solid fa-square-check text-primary' : 'fa-regular fa-square'"
              aria-hidden="true"
            ></i>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm">{{ item.originalName }}</span>
              <span class="block truncate text-[11px] text-text-secondary"
                >{{ item.appId }} · {{ item.mediaType }}</span
              >
            </span>
          </button>
        </template>
      </RecycleScroller>
      <button
        v-if="nextCursor"
        type="button"
        class="shrink-0 border-t border-border px-3 py-2 text-xs hover:bg-header"
        :disabled="busy"
        @click="loadMore"
      >
        {{ $t('agent.attachments.loadMore') }}
      </button>
    </div>
  </div>
</template>
