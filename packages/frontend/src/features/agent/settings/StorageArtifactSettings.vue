<script setup lang="ts">
  import { ref, watch } from 'vue';
  import type { AgentSettingsView, ArtifactStorageSummary } from '../api/agent-api';

  const props = defineProps<{ settings: AgentSettingsView; storage: ArtifactStorageSummary; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const draft = ref<Record<string, number>>({});

  watch(
    () => props.settings.revision,
    () => {
      draft.value = Object.fromEntries(
        Object.entries(props.settings.requestedSettings.storage).map(([key, value]) => [key, Number(value)]),
      );
    },
    { immediate: true },
  );

  const formatBytes = (value: number): string => {
    if (value < 1024) return `${value} B`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let amount = value;
    let unit = -1;
    do {
      amount /= 1024;
      unit += 1;
    } while (amount >= 1024 && unit < units.length - 1);
    return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`;
  };
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <h2 class="text-base font-semibold">{{ $t('agent.settings.storage.title') }}</h2>
    <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.storage.description') }}</p>
    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-md bg-background p-3">
        <div class="text-xs text-text-secondary">{{ $t('agent.settings.storage.used') }}</div>
        <div class="mt-1 font-medium">{{ formatBytes(storage.totalBytes + storage.reservedBytes) }}</div>
      </div>
      <div class="rounded-md bg-background p-3">
        <div class="text-xs text-text-secondary">{{ $t('agent.settings.storage.reclaimable') }}</div>
        <div class="mt-1 font-medium">{{ formatBytes(storage.reclaimableBytes) }}</div>
      </div>
      <div class="rounded-md bg-background p-3">
        <div class="text-xs text-text-secondary">{{ $t('agent.settings.storage.protected') }}</div>
        <div class="mt-1 font-medium">{{ formatBytes(storage.protectedBytes + storage.retainedBytes) }}</div>
      </div>
      <div class="rounded-md bg-background p-3">
        <div class="text-xs text-text-secondary">{{ $t('agent.settings.storage.limit') }}</div>
        <div class="mt-1 font-medium">{{ formatBytes(storage.limitBytes) }}</div>
      </div>
    </div>
    <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label v-for="(_, key) in settings.requestedSettings.storage" :key="key">
        <span class="mb-1 block break-all text-xs font-medium text-text-secondary">{{ key }}</span>
        <input
          v-model.number="draft[String(key)]"
          type="number"
          min="1"
          step="1"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
    </div>
    <p class="mt-3 text-xs text-text-secondary">{{ $t('agent.settings.storage.hardLimitHint') }}</p>
    <div class="mt-4 flex justify-end">
      <button
        type="button"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="busy"
        @click="emit('save', draft)"
      >
        {{ $t('common.save') }}
      </button>
    </div>
  </section>
</template>
