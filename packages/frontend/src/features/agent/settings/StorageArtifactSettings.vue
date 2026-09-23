<script setup lang="ts">
  import { UiButton, UiInfoHint } from '@/foundation/ui';
  import { computed, ref, watch } from 'vue';
  import type { AgentSettingsViewDto, AgentArtifactStorageSummaryDto } from '../api/agent-api';
  import QuantityInput from './QuantityInput.vue';
  import { formatQuantity, type QuantityType } from './quantity-format';
  import { useQuantityLabels } from './use-quantity-labels';
  import { useI18n } from 'vue-i18n';

  const quantityLabels = useQuantityLabels();
  const { t } = useI18n();

  const props = defineProps<{
    settings: AgentSettingsViewDto;
    storage: AgentArtifactStorageSummaryDto;
    busy: boolean;
  }>();
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

  const storageFieldMeta = computed<
    Record<string, { label: string; hint: string; type: QuantityType; placeholder: string }>
  >(() => {
    const example = (examples: string) => t('agent.settings.storage.example', { examples });
    const field = (key: string, type: QuantityType, examples: string) => ({
      label: t(`agent.settings.storage.fields.${key}.label`),
      hint: t(`agent.settings.storage.fields.${key}.hint`),
      type,
      placeholder: example(examples),
    });
    return {
      maxArtifactBytes: field('maxArtifactBytes', 'bytes', '50M, 100M'),
      maxSingleArtifactBytes: field('maxSingleArtifactBytes', 'bytes', '10M, 25M'),
      maxGlobalArtifactBytes: field('maxGlobalArtifactBytes', 'bytes', '500M, 2G'),
      unretainedArtifactTtlSeconds: field('unretainedArtifactTtlSeconds', 'seconds', '1d, 12h, 86400'),
    };
  });

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
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5 agent-settings-head"
    >
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.storage.title') }}</h3>
        <UiInfoHint :text="$t('agent.settings.storage.description')" />
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-full border border-border/80 bg-background px-2.5 py-0.5 text-xs text-text-secondary">
          {{ $t('agent.settings.storage.currentUsage') }}
          <strong class="font-mono text-foreground">{{
            formatQuantity(storage.totalBytes + storage.reservedBytes, 'bytes', quantityLabels)
          }}</strong>
        </span>
      </div>
    </div>

    <div class="space-y-4 p-4 sm:p-5">
      <!-- 4 维存储指标总览卡片 -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg bg-header/25 p-3">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.used') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-foreground">
            {{ formatQuantity(storage.totalBytes + storage.reservedBytes, 'bytes', quantityLabels) }}
          </div>
        </div>
        <div class="rounded-lg bg-header/25 p-3">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.reclaimable') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-success">
            {{ formatQuantity(storage.reclaimableBytes, 'bytes', quantityLabels) }}
          </div>
        </div>
        <div class="rounded-lg bg-header/25 p-3">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.protected') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-foreground">
            {{ formatQuantity(storage.protectedBytes + storage.retainedBytes, 'bytes', quantityLabels) }}
          </div>
        </div>
        <div class="rounded-lg bg-header/25 p-3">
          <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.limit') }}</div>
          <div class="mt-1 font-mono text-sm font-semibold text-foreground">
            {{ formatQuantity(storage.limitBytes, 'bytes', quantityLabels) }}
          </div>
        </div>
      </div>

      <!-- 配额参数输入网格：支持 K、M、G 单位输入与实时换算 -->
      <div class="rounded-lg bg-header/25 p-4">
        <div class="flex items-center justify-between pb-3 mb-3 border-b border-border/40">
          <span class="text-xs font-semibold text-foreground">{{ $t('agent.settings.storage.quotaTitle') }}</span>
          <span class="text-[11px] text-text-secondary">{{ $t('agent.settings.storage.inputHelp') }}</span>
        </div>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="(_, key) in settings.requestedSettings.storage" :key="key" class="space-y-1.5">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">
                {{ storageFieldMeta[key]?.label || key }}
              </span>
              <p class="mb-1.5 text-[11px] text-text-secondary line-clamp-1">
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
          <i class="fa-solid fa-circle-exclamation mr-1"></i>{{ $t('agent.settings.storage.unsavedChanges') }}
        </span>
        <span v-else class="text-xs text-text-secondary">
          {{ $t('agent.settings.storage.savedNotice') }}
        </span>

        <UiButton
          :appearance="isDirty ? 'solid' : 'soft'"
          :tone="isDirty ? 'primary' : 'neutral'"
          type="button"
          :disabled="busy || !isDirty || hasInvalidDraft"
          :title="!isDirty ? $t('agent.settings.disabledReason.noChanges') : undefined"
          @click="save"
        >
          <i v-if="busy" class="fa-solid fa-circle-notch fa-spin text-xs"></i>
          <i v-else class="fa-solid fa-check text-xs"></i>
          <span>{{ busy ? $t('agent.ui.working') : $t('common.save') }}</span>
        </UiButton>
      </div>
    </div>
  </section>
</template>
