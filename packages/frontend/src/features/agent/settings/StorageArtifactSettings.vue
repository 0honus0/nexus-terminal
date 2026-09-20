<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import type { AgentSettingsView, ArtifactStorageSummary } from '../api/agent-api';
  import QuantityInput from './QuantityInput.vue';
  import { formatQuantity, type QuantityType } from './quantity-format';

  const props = defineProps<{ settings: AgentSettingsView; storage: ArtifactStorageSummary; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const draft = ref<Record<string, number | null>>({});

  watch(
    () => props.settings.revision,
    () => {
      draft.value = Object.fromEntries(
        Object.entries(props.settings.requestedSettings.storage).map(([key, value]) => [key, Number(value)]),
      );
    },
    { immediate: true },
  );

  const storageFieldMeta: Record<string, { label: string; hint: string; type: QuantityType; placeholder: string }> = {
    maxArtifactBytes: {
      label: '单 Run 产物配额',
      hint: '单个 Run 产生的所有产物总容量上限',
      type: 'bytes',
      placeholder: '例: 50M, 100M',
    },
    maxSingleArtifactBytes: {
      label: '单文件产物上限',
      hint: '单个交付产物文件的最大允许大小',
      type: 'bytes',
      placeholder: '例: 10M, 25M',
    },
    maxGlobalArtifactBytes: {
      label: '全局产物存储配额',
      hint: '系统所有智能体产物累计占用的总上限',
      type: 'bytes',
      placeholder: '例: 500M, 2G',
    },
    unretainedArtifactTtlSeconds: {
      label: '临时产物生命周期 (TTL)',
      hint: '未标记保留的临时构建物保留时长',
      type: 'seconds',
      placeholder: '例: 1d, 12h, 86400',
    },
  };

  const isDirty = computed(() => {
    const original = props.settings.requestedSettings.storage;
    return Object.entries(draft.value).some(([key, val]) => {
      const origVal = (original as Record<string, number>)[key];
      return origVal !== val;
    });
  });

  const hasInvalidDraft = computed(() => Object.values(draft.value).some((value) => value === null || value < 1));

  const save = () => {
    if (hasInvalidDraft.value) return;
    emit('save', draft.value);
  };
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.storage.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.storage.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-full border border-border/80 bg-background px-2.5 py-0.5 text-xs text-text-secondary">
          当前占用
          <strong class="font-mono text-foreground">{{
            formatQuantity(storage.totalBytes + storage.reservedBytes, 'bytes')
          }}</strong>
        </span>
      </div>
    </div>

    <div class="space-y-4 p-4 sm:p-5">
      <!-- 4 维存储指标总览卡片 -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-xl border border-border/60 bg-card p-3 shadow-2xs">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.used') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-foreground">
            {{ formatQuantity(storage.totalBytes + storage.reservedBytes, 'bytes') }}
          </div>
        </div>
        <div class="rounded-xl border border-border/60 bg-card p-3 shadow-2xs">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.reclaimable') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-emerald-500">
            {{ formatQuantity(storage.reclaimableBytes, 'bytes') }}
          </div>
        </div>
        <div class="rounded-xl border border-border/60 bg-card p-3 shadow-2xs">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.protected') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-foreground">
            {{ formatQuantity(storage.protectedBytes + storage.retainedBytes, 'bytes') }}
          </div>
        </div>
        <div class="rounded-xl border border-border/60 bg-card p-3 shadow-2xs">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.limit') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-foreground">
            {{ formatQuantity(storage.limitBytes, 'bytes') }}
          </div>
        </div>
      </div>

      <!-- 配额参数输入网格：支持 K、M、G 单位输入与实时换算 -->
      <div class="rounded-xl border border-border/60 bg-background/50 p-4">
        <div class="flex items-center justify-between pb-3 mb-3 border-b border-border/40">
          <span class="text-xs font-semibold text-foreground">产物存储上限与保留策略</span>
          <span class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.inputHelp') }}</span>
        </div>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="(_, key) in settings.requestedSettings.storage" :key="key" class="space-y-1.5">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">
                {{ storageFieldMeta[key]?.label || key }}
              </span>
              <p class="mb-1.5 text-[10px] text-text-secondary line-clamp-1">
                {{ storageFieldMeta[key]?.hint || '' }}
              </p>
              <QuantityInput
                v-model="draft[String(key)]"
                :type="storageFieldMeta[key]?.type || 'bytes'"
                :placeholder="storageFieldMeta[key]?.placeholder"
                :min="1"
                :disabled="busy"
              />
            </label>
          </div>
        </div>
      </div>

      <p class="text-xs text-text-secondary">{{ $t('agent.settings.storage.hardLimitHint') }}</p>

      <div class="flex items-center justify-between border-t border-border/40 pt-3">
        <span v-if="isDirty" class="text-xs text-warning">
          <i class="fa-solid fa-circle-exclamation mr-1"></i>有尚未保存的存储配额变更
        </span>
        <span v-else class="text-xs text-text-secondary">
          保存后，容量配额作用于后续创建/Run 关联；TTL 在产物 ready 或取消保留时确定
        </span>

        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 cursor-pointer"
          :disabled="busy || !isDirty || hasInvalidDraft"
          @click="save"
        >
          <i v-if="busy" class="fa-solid fa-circle-notch fa-spin text-xs"></i>
          <i v-else class="fa-solid fa-check text-xs"></i>
          <span>{{ busy ? $t('agent.ui.working') : $t('common.save') }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
