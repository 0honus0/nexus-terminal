<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import type { AgentHardLimits, AgentSettingsView, HardLimitPreview } from '../api/agent-api';
  import QuantityInput from './QuantityInput.vue';
  import {
    areQuantitiesEquivalent,
    formatQuantity,
    parseQuantity,
    toCompactQuantityString,
    type QuantityType,
  } from './quantity-format';

  const props = defineProps<{
    settings: AgentSettingsView;
    preview: HardLimitPreview | null;
    busy: boolean;
  }>();
  const emit = defineEmits<{
    preview: [proposed: Partial<AgentHardLimits>];
    confirm: [confirmationId: string, expectedVersion: number];
    dismiss: [];
  }>();

  type HardLimitKey = keyof AgentHardLimits;

  const getFieldType = (key: HardLimitKey): QuantityType => {
    if (
      [
        'maxToolOutputBytes',
        'maxArtifactBytes',
        'maxSingleArtifactBytes',
        'maxGlobalArtifactBytes',
        'maxRecallBytes',
        'maxSubagentMessageBytesPerRun',
      ].includes(key)
    )
      return 'bytes';
    if (['maxActiveExecutionSeconds', 'toolTimeoutSeconds', 'unretainedArtifactTtlSeconds'].includes(key))
      return 'seconds';
    return 'number';
  };

  const fieldGroups: Array<{ id: string; keys: HardLimitKey[] }> = [
    {
      id: 'execution',
      keys: ['maxRunSteps'],
    },
    {
      id: 'timeouts',
      keys: ['maxActiveExecutionSeconds', 'toolTimeoutSeconds', 'unretainedArtifactTtlSeconds'],
    },
    {
      id: 'storage',
      keys: [
        'maxToolOutputBytes',
        'maxArtifactBytes',
        'maxSingleArtifactBytes',
        'maxGlobalArtifactBytes',
        'maxRecallBytes',
        'maxSubagentMessageBytesPerRun',
      ],
    },
    {
      id: 'concurrency',
      keys: [
        'maxRecallItems',
        'maxConcurrentRuntimes',
        'maxConcurrentModelCalls',
        'maxDelegationDepth',
        'maxSubagentMessagesPerRun',
        'maxActiveWorkspaces',
      ],
    },
  ];

  const draft = ref<Record<string, string | number | null>>({});
  const reset = () => {
    draft.value = Object.fromEntries(
      Object.entries(props.settings.hardLimits).map(([rawKey, value]) => {
        const key = rawKey as HardLimitKey;
        return [key, value === null ? '' : toCompactQuantityString(value, getFieldType(key))];
      }),
    );
  };
  watch(() => props.settings.revision, reset, { immediate: true });

  const parsedDraftValue = (key: HardLimitKey): number | null => {
    const raw = draft.value[key] ?? '';
    return parseQuantity(raw, getFieldType(key));
  };

  const hasInvalidDraft = computed(() =>
    fieldGroups.some((group) =>
      group.keys.some((key) => {
        const parsed = parsedDraftValue(key);
        return parsed === null || parsed < 1;
      }),
    ),
  );

  const proposedChanges = computed<Partial<AgentHardLimits>>(() => {
    if (hasInvalidDraft.value) return {};
    const result: Partial<AgentHardLimits> = {};
    for (const group of fieldGroups) {
      for (const key of group.keys) {
        const current = props.settings.hardLimits[key];
        const next = parsedDraftValue(key);
        if (!areQuantitiesEquivalent(current, next, getFieldType(key))) {
          (result as Record<string, number | null>)[key] = next;
        }
      }
    }
    return result;
  });

  const canPreview = computed(
    () => !hasInvalidDraft.value && Object.keys(proposedChanges.value).length > 0 && !props.busy,
  );

  const formatHardLimitValue = (key: string, value: number | null): string =>
    formatQuantity(value, getFieldType(key as HardLimitKey));

  const artifactUsage = computed(() =>
    props.preview
      ? formatQuantity(
          props.preview.impact.usage.artifactUsedBytes + props.preview.impact.usage.artifactReservedBytes,
          'bytes',
        )
      : '',
  );
</script>

<template>
  <section class="px-3 py-3 sm:px-4 sm:py-4">
    <div class="flex flex-wrap items-start justify-between gap-3 px-1">
      <p class="max-w-3xl text-xs leading-5 text-text-secondary">
        {{ $t('agent.settings.hardLimits.description') }}
      </p>
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="!canPreview"
        @click="emit('preview', proposedChanges)"
      >
        <i class="fa-solid fa-shield-halved text-[10px]" aria-hidden="true"></i>
        {{ $t('agent.settings.hardLimits.review') }}
      </button>
    </div>

    <div class="mt-4 space-y-3">
      <section
        v-for="group in fieldGroups"
        :key="group.id"
        class="rounded-xl border border-border/55 bg-background/45 p-3.5"
      >
        <div class="mb-3">
          <h4 class="text-xs font-semibold text-foreground">
            {{ $t(`agent.settings.hardLimits.groups.${group.id}`) }}
          </h4>
          <p class="mt-0.5 text-[10px] leading-4 text-text-secondary">
            {{ $t(`agent.settings.hardLimits.groups.${group.id}Desc`) }}
          </p>
        </div>

        <div class="grid gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          <label v-for="key in group.keys" :key="key" class="min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <span class="block text-xs font-medium text-foreground">
                  {{ $t(`agent.settings.hardLimits.fields.${key}.label`) }}
                </span>
                <span class="mt-0.5 block text-[10px] leading-4 text-text-secondary">
                  {{ $t(`agent.settings.hardLimits.fields.${key}.hint`) }}
                </span>
              </div>
              <span
                v-if="settings.requestedSettings.hardLimits[key] !== settings.effectiveSettings.hardLimits[key]"
                class="shrink-0 text-[9px] leading-4 text-warning"
                :title="
                  $t('agent.settings.hardLimits.effective', { value: settings.effectiveSettings.hardLimits[key] })
                "
              >
                {{ formatHardLimitValue(key, settings.effectiveSettings.hardLimits[key]) }}
              </span>
            </div>
            <div class="mt-1.5">
              <QuantityInput v-model="draft[key]" :type="getFieldType(key)" :min="1" :disabled="busy" compact />
            </div>
          </label>
        </div>
      </section>
    </div>

    <div v-if="preview" class="mt-4 rounded-xl border border-primary/35 bg-primary/5 p-3.5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-xs font-semibold text-foreground">
            {{ $t('agent.settings.hardLimits.confirmTitle') }}
          </h3>
          <p class="mt-1 text-[11px] leading-5 text-text-secondary">
            {{
              $t('agent.settings.hardLimits.confirmDescription', {
                count: preview.impact.changes.length,
                runtimes: preview.impact.usage.executingRuntimes,
              })
            }}
          </p>
        </div>
        <span v-if="preview.impact.hasIncrease" class="rounded-md bg-warning/12 px-2 py-1 text-[10px] text-warning">
          {{ $t('agent.settings.hardLimits.increaseWarning') }}
        </span>
      </div>

      <div class="mt-3 max-h-60 space-y-1.5 overflow-y-auto">
        <div
          v-for="change in preview.impact.changes"
          :key="change.key"
          class="flex items-center justify-between gap-3 rounded-lg bg-background/80 px-3 py-2 text-xs"
        >
          <span class="min-w-0 truncate">{{ $t(`agent.settings.hardLimits.fields.${change.key}.label`) }}</span>
          <span class="shrink-0 font-mono text-[10px] text-text-secondary">
            {{ formatHardLimitValue(change.key, change.current) }} →
            {{ formatHardLimitValue(change.key, change.proposed) }}
          </span>
        </div>
      </div>

      <p class="mt-3 text-[10px] text-text-secondary">
        {{ $t('agent.settings.hardLimits.usage', { bytes: artifactUsage }) }}
      </p>
      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-header hover:text-foreground"
          :disabled="busy"
          @click="emit('dismiss')"
        >
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          :disabled="busy"
          @click="emit('confirm', preview.confirmationId, preview.expectedVersion)"
        >
          {{ $t('agent.settings.hardLimits.confirm') }}
        </button>
      </div>
    </div>
  </section>
</template>
