<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import type { AgentSettingsView } from '../api/agent-api';

  const props = defineProps<{ settings: AgentSettingsView; busy: boolean }>();
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
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.performance.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.performance.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-full border border-border/80 bg-background px-2.5 py-0.5 text-xs text-text-secondary">
          并发上限 {{ settings.hardLimits.maxConcurrentRuntimes }}
        </span>
      </div>
    </div>

    <div class="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
      <div class="rounded-xl border border-border/60 bg-background/50 p-4">
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

      <div class="rounded-xl border border-border/60 bg-background/50 p-4">
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
        {{ isDirty ? '并发设置已更改，请点击保存' : '当前并发设置正常生效中' }}
      </span>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy || !isDirty || invalid"
        @click="save"
      >
        <i v-if="busy" class="fa-solid fa-spinner fa-spin text-xs" aria-hidden="true"></i>
        <span>{{ busy ? $t('agent.ui.working') : $t('common.save') }}</span>
      </button>
    </div>
  </section>
</template>
