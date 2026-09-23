<script setup lang="ts">
  import { UiBadge, UiButton, UiInfoHint } from '@/foundation/ui';
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { AgentSettingsDocumentDto, AgentSettingsViewDto } from '../api/agent-api';
  import QuantityInput from './QuantityInput.vue';
  import {
    parseQuantity,
    formatQuantity,
    toCompactQuantityString,
    areQuantitiesEquivalent,
    type QuantityType,
  } from './quantity-format';
  import { useQuantityLabels } from './use-quantity-labels';

  const props = defineProps<{ settings: AgentSettingsViewDto; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const { t } = useI18n();
  const quantityLabels = useQuantityLabels();

  type PresetId = 'light' | 'balanced' | 'deep' | 'custom';
  type BudgetSettings = AgentSettingsDocumentDto['budget'];
  type BudgetKey = keyof AgentSettingsDocumentDto['budget'];
  type BudgetDraft = Record<BudgetKey, string | number | null>;

  const budgetKeys: readonly BudgetKey[] = [
    'maxRunSteps',
    'maxActiveExecutionSeconds',
    'toolTimeoutSeconds',
    'maxToolOutputBytes',
    'maxRecallItems',
    'maxRecallBytes',
  ];

  interface BudgetPreset {
    id: PresetId;
    icon: string;
    label: string;
    description: string;
    badge?: string;
    values: BudgetSettings;
  }

  const presets = computed<BudgetPreset[]>(() => [
    {
      id: 'light',
      icon: 'fa-solid fa-bolt',
      label: t('agent.settings.budget.presetLight'),
      description: t('agent.settings.budget.presetLightDesc'),
      values: {
        maxRunSteps: 25,
        maxActiveExecutionSeconds: 600,
        toolTimeoutSeconds: 30,
        maxToolOutputBytes: 32768,
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
        maxRunSteps: 80,
        maxActiveExecutionSeconds: 1800,
        toolTimeoutSeconds: 60,
        maxToolOutputBytes: 65536,
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
        maxRunSteps: 150,
        maxActiveExecutionSeconds: 3600,
        toolTimeoutSeconds: 120,
        maxToolOutputBytes: 131072,
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
        maxRunSteps: 80,
        maxActiveExecutionSeconds: 1800,
        toolTimeoutSeconds: 60,
        maxToolOutputBytes: 65536,
        maxRecallItems: 5,
        maxRecallBytes: 8192,
      },
    },
  ]);

  const getFieldType = (key: BudgetKey): QuantityType => {
    if (key === 'maxToolOutputBytes' || key === 'maxRecallBytes') return 'bytes';
    if (key === 'maxActiveExecutionSeconds' || key === 'toolTimeoutSeconds') return 'seconds';
    return 'number';
  };

  const getParsedValue = (key: BudgetKey, raw: string | number | null): number | null =>
    parseQuantity(raw, getFieldType(key));

  const draftFromBudget = (budget: BudgetSettings): BudgetDraft => ({
    maxRunSteps: toCompactQuantityString(budget.maxRunSteps, getFieldType('maxRunSteps')),
    maxActiveExecutionSeconds: toCompactQuantityString(
      budget.maxActiveExecutionSeconds,
      getFieldType('maxActiveExecutionSeconds'),
    ),
    toolTimeoutSeconds: toCompactQuantityString(budget.toolTimeoutSeconds, getFieldType('toolTimeoutSeconds')),
    maxToolOutputBytes: toCompactQuantityString(budget.maxToolOutputBytes, getFieldType('maxToolOutputBytes')),
    maxRecallItems: toCompactQuantityString(budget.maxRecallItems, getFieldType('maxRecallItems')),
    maxRecallBytes: toCompactQuantityString(budget.maxRecallBytes, getFieldType('maxRecallBytes')),
  });

  const draft = ref<BudgetDraft>(draftFromBudget(props.settings.requestedSettings.budget));

  const syncFromProps = () => {
    draft.value = draftFromBudget(props.settings.requestedSettings.budget);
  };

  watch(() => props.settings.revision, syncFromProps, { immediate: true });

  const activePreset = computed<PresetId>(() => {
    for (const preset of presets.value) {
      if (preset.id === 'custom') continue;
      const isMatch = budgetKeys.every((key) =>
        areQuantitiesEquivalent(draft.value[key], preset.values[key], getFieldType(key)),
      );
      if (isMatch) return preset.id;
    }
    return 'custom';
  });

  const activePresetMeta = computed(
    () => presets.value.find((candidate) => candidate.id === activePreset.value) ?? presets.value[1],
  );

  const applyPreset = (preset: BudgetPreset) => {
    if (preset.id === 'custom') return;
    const nextDraft: BudgetDraft = { ...draft.value };
    for (const key of budgetKeys) {
      const rawValue = preset.values[key];
      const hardLimit = props.settings.hardLimits[key];
      const safeValue = Math.min(rawValue, hardLimit);
      nextDraft[key] = toCompactQuantityString(safeValue, getFieldType(key));
    }
    draft.value = nextDraft;
  };

  const isDirty = computed(() =>
    budgetKeys.some(
      (key) =>
        !areQuantitiesEquivalent(props.settings.requestedSettings.budget[key], draft.value[key], getFieldType(key)),
    ),
  );

  const hasInvalidDraft = computed(() =>
    budgetKeys.some((key) => {
      const parsed = getParsedValue(key, draft.value[key]);
      return parsed === null || parsed < 1;
    }),
  );

  const save = () => {
    if (hasInvalidDraft.value) return;
    const current = props.settings.requestedSettings.budget;
    const patch: BudgetSettings = { ...current };
    for (const key of budgetKeys) {
      const parsed = getParsedValue(key, draft.value[key]);
      if (parsed === null) return;
      const original = current[key];
      patch[key] = areQuantitiesEquivalent(original, parsed, getFieldType(key)) ? original : parsed;
    }
    emit('save', patch);
  };

  interface FieldGroup {
    id: string;
    title: string;
    keys: BudgetKey[];
  }

  const fieldGroups = computed<FieldGroup[]>(() => [
    {
      id: 'tokens_steps',
      title: t('agent.settings.budget.groups.steps'),
      keys: ['maxRunSteps'],
    },
    {
      id: 'time_control',
      title: t('agent.settings.budget.groups.timeControl'),
      keys: ['maxActiveExecutionSeconds', 'toolTimeoutSeconds'],
    },
    {
      id: 'tools_data',
      title: t('agent.settings.budget.groups.toolsData'),
      keys: ['maxToolOutputBytes', 'maxRecallItems', 'maxRecallBytes'],
    },
  ]);
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5 agent-settings-head"
    >
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.budget.title') }}</h3>
        <UiInfoHint :text="$t('agent.settings.budget.modelCapabilityNotice')" />
      </div>
      <div class="flex items-center gap-2">
        <UiBadge
          :tone="activePreset === 'custom' ? 'primary' : 'neutral'"
          appearance="soft"
          density="compact"
          class="gap-1.5"
        >
          <i :class="activePresetMeta.icon" class="text-[10px]" aria-hidden="true"></i>
          <span>{{ activePresetMeta.label }}</span>
        </UiBadge>
      </div>
    </div>

    <div class="space-y-5 p-4 sm:p-5">
      <div>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold text-foreground">{{ $t('agent.settings.budget.presetsTitle') }}</span>
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
                <UiBadge v-if="preset.badge" tone="primary" appearance="soft" density="compact">
                  {{ preset.badge }}
                </UiBadge>
              </div>
              <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">{{ preset.description }}</p>
            </div>
            <div
              class="mt-2.5 flex items-center justify-between border-t border-border/40 pt-1.5 text-[11px] text-text-secondary"
            >
              <span v-if="preset.id !== 'custom'">
                {{
                  $t('agent.settings.budget.presetSteps', {
                    steps: preset.values.maxRunSteps,
                    minutes: Math.round(preset.values.maxActiveExecutionSeconds / 60),
                  })
                }}
              </span>
              <span v-else>{{ $t('agent.settings.budget.customTuning') }}</span>
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
        <div v-for="group in fieldGroups" :key="group.id" class="rounded-lg bg-header/25 p-3.5">
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
                    v-if="settings.requestedSettings.budget[key] !== settings.effectiveSettings.budget[key]"
                    class="text-[11px] text-warning"
                  >
                    {{
                      $t('agent.settings.budget.effective', {
                        value: formatQuantity(
                          settings.effectiveSettings.budget[key],
                          getFieldType(key),
                          quantityLabels,
                        ),
                      })
                    }}
                  </span>
                </div>
                <p class="mb-1.5 text-[11px] text-text-secondary">
                  {{ $t(`agent.settings.budget.fields.${key}Hint`) }}
                </p>
                <QuantityInput v-model="draft[key]" :type="getFieldType(key)" :min="1" :disabled="busy" />
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
          {{ $t('agent.settings.budget.unsavedChanges') }}
        </span>
        <span v-else class="text-text-secondary">
          {{ $t('agent.settings.budget.readyNotice') }}
        </span>
      </div>
      <UiButton
        :appearance="isDirty ? 'solid' : 'soft'"
        :tone="isDirty ? 'primary' : 'neutral'"
        type="button"
        :disabled="busy || !isDirty || hasInvalidDraft"
        :title="!isDirty ? $t('agent.settings.disabledReason.noChanges') : undefined"
        @click="save"
      >
        <i v-if="busy" class="fa-solid fa-spinner fa-spin text-xs" aria-hidden="true"></i>
        <span>{{ busy ? $t('agent.ui.working') : $t('common.save') }}</span>
      </UiButton>
    </div>
  </section>
</template>
