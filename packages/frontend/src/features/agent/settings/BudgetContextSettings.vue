<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { AgentSettingsView } from '../api/agent-api';
  import QuantityInput from './QuantityInput.vue';
  import {
    parseQuantity,
    formatQuantity,
    toCompactQuantityString,
    areQuantitiesEquivalent,
    type QuantityType,
  } from './quantity-format';

  const props = defineProps<{ settings: AgentSettingsView; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const { t } = useI18n();

  type PresetId = 'light' | 'balanced' | 'deep' | 'custom';

  interface BudgetPreset {
    id: PresetId;
    icon: string;
    label: string;
    description: string;
    badge?: string;
    values: {
      maxContextTokens: number;
      maxOutputTokens: number;
      maxRunTokens: number;
      maxRunSteps: number;
      maxRunCostMicros: number | null;
      maxActiveExecutionSeconds: number;
      toolTimeoutSeconds: number;
      maxToolOutputBytes: number;
      maxRawToolBytes: number;
      maxRecallItems: number;
      maxRecallBytes: number;
    };
  }

  const presets = computed<BudgetPreset[]>(() => [
    {
      id: 'light',
      icon: 'fa-solid fa-bolt',
      label: t('agent.settings.budget.presetLight'),
      description: t('agent.settings.budget.presetLightDesc'),
      values: {
        maxContextTokens: 16384,
        maxOutputTokens: 2048,
        maxRunTokens: 30000,
        maxRunSteps: 25,
        maxRunCostMicros: null,
        maxActiveExecutionSeconds: 600,
        toolTimeoutSeconds: 30,
        maxToolOutputBytes: 32768,
        maxRawToolBytes: 2097152,
        maxRecallItems: 3,
        maxRecallBytes: 4096,
      },
    },
    {
      id: 'balanced',
      icon: 'fa-solid fa-scale-balanced',
      label: t('agent.settings.budget.presetBalanced'),
      description: t('agent.settings.budget.presetBalancedDesc'),
      badge: t('agent.settings.budget.recommendedBadge'),
      values: {
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
        maxRunTokens: 100000,
        maxRunSteps: 80,
        maxRunCostMicros: null,
        maxActiveExecutionSeconds: 1800,
        toolTimeoutSeconds: 60,
        maxToolOutputBytes: 65536,
        maxRawToolBytes: 10485760,
        maxRecallItems: 5,
        maxRecallBytes: 8192,
      },
    },
    {
      id: 'deep',
      icon: 'fa-solid fa-rocket',
      label: t('agent.settings.budget.presetDeep'),
      description: t('agent.settings.budget.presetDeepDesc'),
      values: {
        maxContextTokens: 64000,
        maxOutputTokens: 8192,
        maxRunTokens: 300000,
        maxRunSteps: 150,
        maxRunCostMicros: null,
        maxActiveExecutionSeconds: 3600,
        toolTimeoutSeconds: 120,
        maxToolOutputBytes: 131072,
        maxRawToolBytes: 20971520,
        maxRecallItems: 10,
        maxRecallBytes: 16384,
      },
    },
    {
      id: 'custom',
      icon: 'fa-solid fa-sliders',
      label: t('agent.settings.budget.presetCustom'),
      description: t('agent.settings.budget.presetCustomDesc'),
      badge: t('agent.settings.budget.customBadge'),
      values: {
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
        maxRunTokens: 100000,
        maxRunSteps: 80,
        maxRunCostMicros: null,
        maxActiveExecutionSeconds: 1800,
        toolTimeoutSeconds: 60,
        maxToolOutputBytes: 65536,
        maxRawToolBytes: 10485760,
        maxRecallItems: 5,
        maxRecallBytes: 8192,
      },
    },
  ]);

  const getFieldType = (key: string): QuantityType => {
    if (['maxRunTokens', 'maxContextTokens', 'maxOutputTokens'].includes(key)) return 'tokens';
    if (['maxToolOutputBytes', 'maxRawToolBytes', 'maxRecallBytes'].includes(key)) return 'bytes';
    if (['maxActiveExecutionSeconds', 'toolTimeoutSeconds'].includes(key)) return 'seconds';
    return 'number';
  };

  const getParsedValue = (key: string, raw: string | number | null): number | null => {
    if (key === 'maxRunCostMicros' && (raw === null || String(raw).trim() === '')) return null;
    const type = getFieldType(key);
    return parseQuantity(raw, type);
  };
  const draft = ref<Record<string, string | number | null>>({});

  const syncFromProps = () => {
    draft.value = Object.fromEntries(
      Object.entries(props.settings.requestedSettings.budget).map(([key, value]) => [
        key,
        value === null ? '' : toCompactQuantityString(value, getFieldType(key)),
      ]),
    );
  };

  watch(() => props.settings.revision, syncFromProps, { immediate: true });

  const activePreset = computed<PresetId>(() => {
    for (const preset of presets.value) {
      if (preset.id === 'custom') continue;
      const isMatch = Object.entries(preset.values).every(([key, expected]) => {
        const currentRaw = draft.value[key];
        const type = getFieldType(key);
        return areQuantitiesEquivalent(currentRaw, expected, type);
      });
      if (isMatch) return preset.id;
    }
    return 'custom';
  });

  const activePresetMeta = computed(
    () => presets.value.find((candidate) => candidate.id === activePreset.value) ?? presets.value[1],
  );

  const applyPreset = (preset: BudgetPreset) => {
    if (preset.id === 'custom') return;
    const limits = props.settings.hardLimits as unknown as Record<string, number | null>;
    const nextDraft: Record<string, string | number | null> = { ...draft.value };
    for (const [key, rawValue] of Object.entries(preset.values)) {
      if (rawValue === null) {
        nextDraft[key] = '';
      } else {
        const hardLimit = limits[key];
        const safeVal = typeof hardLimit === 'number' ? Math.min(rawValue, hardLimit) : rawValue;
        nextDraft[key] = toCompactQuantityString(safeVal, getFieldType(key));
      }
    }
    draft.value = nextDraft;
  };

  const isDirty = computed(() => {
    const current = props.settings.requestedSettings.budget as Record<string, number | null>;
    return Object.entries(draft.value).some(([key, raw]) => {
      const orig = current[key];
      const type = getFieldType(key);
      return !areQuantitiesEquivalent(orig, raw, type);
    });
  });

  const hasInvalidDraft = computed(() =>
    Object.entries(draft.value).some(([key, raw]) => {
      const parsed = getParsedValue(key, raw);
      if (key === 'maxRunCostMicros')
        return raw !== null && String(raw).trim() !== '' && (parsed === null || parsed < 0);
      return parsed === null || parsed < 1;
    }),
  );

  const save = () => {
    if (hasInvalidDraft.value) return;
    const patch: Record<string, number | null> = {};
    const current = props.settings.requestedSettings.budget as Record<string, number | null>;
    for (const [key, raw] of Object.entries(draft.value)) {
      const parsed = getParsedValue(key, raw);
      const orig = current[key];
      const type = getFieldType(key);
      if (orig !== null && parsed !== null && areQuantitiesEquivalent(orig, parsed, type)) {
        patch[key] = orig;
      } else {
        patch[key] = parsed;
      }
    }
    emit('save', patch);
  };

  interface FieldGroup {
    id: string;
    title: string;
    keys: string[];
  }

  const fieldGroups: FieldGroup[] = [
    {
      id: 'tokens_steps',
      title: '执行步数与 Token 预算',
      keys: ['maxRunSteps', 'maxRunTokens', 'maxContextTokens', 'maxOutputTokens'],
    },
    {
      id: 'time_cost',
      title: '超时与成本控制',
      keys: ['maxActiveExecutionSeconds', 'toolTimeoutSeconds', 'maxRunCostMicros'],
    },
    {
      id: 'tools_data',
      title: '工具截断与上下文记忆',
      keys: ['maxToolOutputBytes', 'maxRawToolBytes', 'maxRecallItems', 'maxRecallBytes'],
    },
  ];
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.budget.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.budget.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
          :class="
            activePreset === 'custom'
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border/80 bg-background text-foreground'
          "
        >
          <i :class="activePresetMeta.icon" class="text-[10px]" aria-hidden="true"></i>
          <span>{{ activePresetMeta.label }}</span>
        </span>
      </div>
    </div>

    <div class="space-y-5 p-4 sm:p-5">
      <div>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold text-foreground">{{ $t('agent.settings.budget.presetsTitle') }}</span>
          <span class="text-[11px] text-text-secondary">{{ $t('agent.settings.budget.presetsHint') }}</span>
        </div>
        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <button
            v-for="preset in presets"
            :key="preset.id"
            type="button"
            class="group relative flex flex-col justify-between rounded-xl border p-3 text-left transition-all focus:outline-none"
            :class="
              activePreset === preset.id
                ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20'
                : 'border-border/70 bg-background/70 hover:border-border hover:bg-header/50'
            "
            @click="applyPreset(preset)"
          >
            <div>
              <div class="flex items-center justify-between gap-1">
                <div class="flex items-center gap-2">
                  <i
                    :class="[preset.icon, activePreset === preset.id ? 'text-primary' : 'text-text-secondary']"
                    class="text-xs"
                    aria-hidden="true"
                  ></i>
                  <span class="text-xs font-semibold text-foreground">{{ preset.label }}</span>
                </div>
                <span
                  v-if="preset.badge"
                  class="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-medium text-primary"
                >
                  {{ preset.badge }}
                </span>
              </div>
              <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">{{ preset.description }}</p>
            </div>
            <div
              class="mt-2.5 flex items-center justify-between border-t border-border/40 pt-1.5 text-[10px] text-text-secondary"
            >
              <span v-if="preset.id !== 'custom'"
                >{{ preset.values.maxRunSteps }} 步 · {{ Math.round(preset.values.maxRunTokens / 1000) }}k Tokens</span
              >
              <span v-else>自定义微调</span>
              <span
                class="text-primary opacity-0 transition-opacity group-hover:opacity-100"
                :class="{ '!opacity-100': activePreset === preset.id }"
              >
                <i class="fa-solid fa-check text-[10px]" aria-hidden="true"></i>
              </span>
            </div>
          </button>
        </div>
      </div>

      <div class="space-y-4">
        <div
          v-for="group in fieldGroups"
          :key="group.id"
          class="rounded-xl border border-border/60 bg-background/50 p-3.5"
        >
          <h4 class="mb-3 text-xs font-semibold tracking-wide text-foreground uppercase">
            {{ group.title }}
          </h4>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div v-for="key in group.keys" :key="key" class="space-y-1">
              <label class="block">
                <div class="flex items-center justify-between gap-1">
                  <span class="text-xs font-medium text-foreground">
                    {{ $t(`agent.settings.budget.fields.${key}`) }}
                  </span>
                  <span
                    v-if="
                      (settings.requestedSettings.budget as any)[key] !==
                      (settings.effectiveSettings.budget as any)[key]
                    "
                    class="text-[10px] text-warning"
                  >
                    有效: {{ formatQuantity((settings.effectiveSettings.budget as any)[key], getFieldType(key)) }}
                  </span>
                </div>
                <p class="mb-1.5 text-[10px] text-text-secondary">
                  {{ $t(`agent.settings.budget.fields.${key}Hint`) }}
                </p>
                <QuantityInput
                  v-model="draft[key]"
                  :type="getFieldType(key)"
                  :placeholder="key === 'maxRunCostMicros' ? $t('agent.settings.hardLimits.unlimited') : undefined"
                  :min="key === 'maxRunCostMicros' ? 0 : 1"
                  :disabled="busy"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-header/20 px-4 py-3 sm:px-5"
    >
      <div class="text-xs text-text-secondary">
        <span v-if="isDirty" class="text-warning">
          <i class="fa-solid fa-circle-exclamation mr-1" aria-hidden="true"></i>
          有尚未保存的预算变更
        </span>
        <span v-else class="text-text-secondary">
          {{ $t('agent.settings.budget.readyNotice') }}
        </span>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy || !isDirty || hasInvalidDraft"
        @click="save"
      >
        <i v-if="busy" class="fa-solid fa-spinner fa-spin text-xs" aria-hidden="true"></i>
        <span>{{ busy ? $t('agent.ui.working') : $t('common.save') }}</span>
      </button>
    </div>
  </section>
</template>
