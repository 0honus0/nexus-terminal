<script setup lang="ts">
  import { UiButton, UiInfoHint } from '@/foundation/ui';
  import { computed, ref, watch } from 'vue';
  import type { AgentSettingsViewDto } from '../api/agent-api';

  const props = defineProps<{ settings: AgentSettingsViewDto; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const runtimes = ref(1);
  const modelCalls = ref<string>('auto');

  watch(
    () => props.settings.revision,
    () => {
      runtimes.value = props.settings.requestedSettings.performance.maxConcurrentRuntimes;
      modelCalls.value = String(props.settings.requestedSettings.performance.maxConcurrentModelCalls);
    },
    { immediate: true },
  );

  const isDirty = computed(() => {
    const currentRuntimes = props.settings.requestedSettings.performance.maxConcurrentRuntimes;
    const currentCalls = String(props.settings.requestedSettings.performance.maxConcurrentModelCalls);
    return runtimes.value !== currentRuntimes || modelCalls.value !== currentCalls;
  });

  const invalid = computed(() => {
    if (
      !Number.isSafeInteger(runtimes.value) ||
      runtimes.value < 1 ||
      runtimes.value > props.settings.hardLimits.maxConcurrentRuntimes
    ) {
      return true;
    }
    if (modelCalls.value === 'auto') return false;
    const parsed = Number(modelCalls.value);
    return !Number.isSafeInteger(parsed) || parsed < 1 || parsed > props.settings.hardLimits.maxConcurrentModelCalls;
  });

  const save = () => {
    if (invalid.value) return;
    const parsedModel = modelCalls.value === 'auto' ? 'auto' : Number(modelCalls.value);
    emit('save', {
      maxConcurrentRuntimes: runtimes.value,
      maxConcurrentModelCalls: parsedModel,
    });
  };
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5 agent-settings-head"
    >
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.performance.title') }}</h3>
        <UiInfoHint :text="$t('agent.settings.performance.description')" />
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] text-text-secondary"
        >
          <i class="fa-solid fa-code-branch text-[9px] text-primary/75" aria-hidden="true"></i>
          {{ $t('agent.settings.performance.sharedSlots') }}
        </span>
      </div>
    </div>

    <div class="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
      <div class="rounded-lg bg-header/25 p-4">
        <label class="block">
          <span class="text-xs font-semibold text-foreground">{{ $t('agent.settings.performance.runtimes') }}</span>
          <p class="mt-0.5 mb-2 text-[11px] text-text-secondary">{{ $t('agent.settings.performance.runtimesHint') }}</p>
          <input
            v-model.number="runtimes"
            type="number"
            min="1"
            :max="settings.hardLimits.maxConcurrentRuntimes"
            class="h-9 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none transition-colors focus:border-primary"
          />
          <span class="mt-1.5 block text-[11px] text-text-secondary">
            {{
              $t('agent.settings.performance.limit', {
                effective: settings.effectiveSettings.performance.maxConcurrentRuntimes,
                hard: settings.hardLimits.maxConcurrentRuntimes,
              })
            }}
          </span>
        </label>
      </div>

      <div class="rounded-lg bg-header/25 p-4">
        <label class="block">
          <span class="text-xs font-semibold text-foreground">{{ $t('agent.settings.performance.modelCalls') }}</span>
          <p class="mt-0.5 mb-2 text-[11px] text-text-secondary">
            {{ $t('agent.settings.performance.modelCallsHint') }}
          </p>
          <select
            v-model="modelCalls"
            class="h-9 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none transition-colors focus:border-primary"
          >
            <option value="auto">{{ $t('agent.settings.performance.auto') }}</option>
            <option v-for="value in settings.hardLimits.maxConcurrentModelCalls" :key="value" :value="String(value)">
              {{ value }}
            </option>
          </select>
          <span class="mt-1.5 block text-[11px] text-text-secondary">
            {{
              $t('agent.settings.performance.limit', {
                effective: settings.effectiveSettings.performance.maxConcurrentModelCalls,
                hard: settings.hardLimits.maxConcurrentModelCalls,
              })
            }}
          </span>
        </label>
      </div>
    </div>

    <div
      class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-header/20 px-4 py-3 sm:px-5"
    >
      <span class="text-xs text-text-secondary">
        {{ isDirty ? $t('agent.settings.performance.unsavedChanges') : $t('agent.settings.performance.activeNotice') }}
      </span>
      <UiButton
        :appearance="isDirty ? 'solid' : 'soft'"
        :tone="isDirty ? 'primary' : 'neutral'"
        type="button"
        :disabled="busy || !isDirty || invalid"
        :title="!isDirty ? $t('agent.settings.disabledReason.noChanges') : undefined"
        @click="save"
      >
        <i v-if="busy" class="fa-solid fa-spinner fa-spin text-xs" aria-hidden="true"></i>
        <span>{{ busy ? $t('agent.ui.working') : $t('common.save') }}</span>
      </UiButton>
    </div>
  </section>
</template>
