<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import AgentConfigPopover from './AgentConfigPopover.vue';
  import { RecycleScroller } from 'vue-virtual-scroller';
  import { agentApi, formatAgentApiError, type AgentArtifactRefDto } from '../api/agent-api';

  const props = defineProps<{
    appId: string;
    modelValue: AgentArtifactRefDto[];
    disabled?: boolean;
    compact?: boolean;
  }>();
  const emit = defineEmits<{ 'update:modelValue': [value: AgentArtifactRefDto[]] }>();

  const { t } = useI18n();
  const items = ref<AgentArtifactRefDto[]>([]);
  const nextCursor = ref<string | null>(null);
  const query = ref('');
  const busy = ref(false);
  const error = ref('');
  const input = ref<HTMLInputElement | null>(null);
  let queryGeneration = 0;
  const selectedIds = computed(() => new Set(props.modelValue.map((item) => item.id)));

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.operations.requestFailed'), t);
  const queryKey = (): string => query.value.trim();

  const load = async (): Promise<void> => {
    const generation = ++queryGeneration;
    const requestQuery = queryKey();
    busy.value = true;
    error.value = '';
    try {
      const page = await agentApi.files(requestQuery ? { q: requestQuery } : {});
      if (generation !== queryGeneration || requestQuery !== queryKey()) return;
      items.value = page.items.filter((item) => item.status === 'ready');
      nextCursor.value = page.nextCursor;
    } catch (cause) {
      if (generation !== queryGeneration || requestQuery !== queryKey()) return;
      error.value = explain(cause);
    } finally {
      if (generation === queryGeneration) busy.value = false;
    }
  };

  const loadMore = async (): Promise<void> => {
    const cursor = nextCursor.value;
    if (!cursor || busy.value) return;
    const generation = queryGeneration;
    const requestQuery = queryKey();
    busy.value = true;
    try {
      const page = await agentApi.files({
        ...(requestQuery ? { q: requestQuery } : {}),
        before: cursor,
      });
      if (generation !== queryGeneration || requestQuery !== queryKey() || cursor !== nextCursor.value) return;
      const known = new Set(items.value.map((item) => item.id));
      items.value.push(...page.items.filter((item) => item.status === 'ready' && !known.has(item.id)));
      nextCursor.value = page.nextCursor;
    } catch (cause) {
      if (generation !== queryGeneration || requestQuery !== queryKey()) return;
      error.value = explain(cause);
    } finally {
      if (generation === queryGeneration) busy.value = false;
    }
  };

  let loaded = false;
  const handleOpenChange = (open: boolean): void => {
    if (!open || loaded) return;
    loaded = true;
    void load();
  };

  const toggle = (artifact: AgentArtifactRefDto): void => {
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
      error.value = t('agent.attachments.limitReached', { count: 10 });
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
      const uploaded: AgentArtifactRefDto[] = [];
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
</script>

<template>
  <AgentConfigPopover
    :ariaLabel="$t('agent.attachments.button', { count: modelValue.length })"
    :title="$t('agent.attachments.button', { count: modelValue.length })"
    :disabled="disabled"
    panel-class="w-[min(520px,calc(100vw-24px))]"
    :trigger-variant="compact ? 'square' : 'default'"
    @open-change="handleOpenChange"
  >
    <template #trigger>
      <template v-if="compact">
        <i class="fa-solid fa-plus text-[11px]" aria-hidden="true"></i>
        <span
          v-if="modelValue.length > 0"
          class="pointer-events-none absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-white"
          aria-hidden="true"
          >{{ modelValue.length }}</span
        >
      </template>
      <template v-else>
        <i class="fa-solid fa-paperclip text-[10px]" aria-hidden="true"></i>
        <span class="agent-config-verbose whitespace-nowrap">{{
          $t('agent.attachments.button', { count: modelValue.length })
        }}</span>
        <span v-if="modelValue.length > 0" class="agent-config-compact hidden text-[11px] font-medium">{{
          modelValue.length
        }}</span>
      </template>
    </template>

    <template #panel>
      <div class="flex h-[340px] min-h-0 flex-col">
        <div class="flex shrink-0 gap-1.5 border-b border-border/60 pb-2">
          <input
            v-model="query"
            type="search"
            class="h-8 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 text-xs outline-none transition-colors focus:border-primary/50"
            :placeholder="$t('agent.attachments.search')"
            @keydown.enter="load"
          />
          <button
            type="button"
            class="h-8 rounded-lg px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-header hover:text-foreground"
            :disabled="busy"
            @click="load"
          >
            {{ $t('agent.attachments.searchAction') }}
          </button>
          <button
            type="button"
            class="h-8 rounded-lg bg-header/70 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-header"
            :disabled="busy"
            @click="input?.click()"
          >
            {{ $t('agent.attachments.upload') }}
          </button>
          <input ref="input" type="file" multiple class="hidden" @change="upload" />
        </div>
        <p v-if="error" class="shrink-0 px-1 py-2 text-xs text-error">{{ error }}</p>
        <RecycleScroller class="min-h-0 flex-1 overflow-y-auto" :items="items" :item-size="54" key-field="id">
          <template #default="{ item }">
            <button
              type="button"
              class="flex h-[54px] w-full items-center gap-2.5 border-b border-border/50 px-2 text-left transition-colors hover:bg-header/60"
              :class="selectedIds.has(item.id) ? 'bg-primary/8' : ''"
              @click="toggle(item)"
            >
              <i
                :class="
                  selectedIds.has(item.id)
                    ? 'fa-solid fa-square-check text-primary'
                    : 'fa-regular fa-square text-text-secondary'
                "
                aria-hidden="true"
              ></i>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-medium text-foreground">{{ item.originalName }}</span>
                <span class="mt-0.5 block truncate text-[11px] text-text-secondary"
                  >{{ item.appId }} · {{ item.mediaType }}</span
                >
              </span>
            </button>
          </template>
        </RecycleScroller>
        <button
          v-if="nextCursor"
          type="button"
          class="h-8 shrink-0 border-t border-border/60 text-xs font-medium text-text-secondary transition-colors hover:bg-header hover:text-foreground"
          :disabled="busy"
          @click="loadMore"
        >
          {{ $t('agent.attachments.loadMore') }}
        </button>
      </div>
    </template>
  </AgentConfigPopover>
</template>

<style scoped>
  .agent-config-summary {
    font-size: 11px;
    line-height: 1;
  }

  @container agent-hub-window (max-width: 1040px) {
    .agent-config-summary {
      min-width: 28px;
      height: 28px;
      gap: 3px;
      padding-inline: 6px;
      font-size: 11px;
    }

    .agent-config-verbose {
      display: none;
    }

    .agent-config-compact {
      display: inline;
    }
  }
</style>
