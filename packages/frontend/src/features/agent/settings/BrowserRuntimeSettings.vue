<script setup lang="ts">
  import { ref, watch } from 'vue';
  import type { AgentSettingsView } from '../api/agent-api';

  type BrowserTarget = AgentSettingsView['requestedSettings']['browser']['targets'][number];
  type BrowserEndpoint = BrowserTarget['endpoints'][number];

  const props = defineProps<{ settings: AgentSettingsView; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: AgentSettingsView['requestedSettings']['browser']] }>();

  const targets = ref<BrowserTarget[]>([]);

  const cloneTargets = (source: readonly BrowserTarget[]): BrowserTarget[] =>
    source.map((target) => ({
      ...target,
      endpoints: target.endpoints.map((endpoint) => ({ ...endpoint })),
      allowedUrlPatterns: [...target.allowedUrlPatterns],
    }));
  const sync = (): void => {
    targets.value = cloneTargets(props.settings.requestedSettings.browser.targets);
  };

  const addTarget = (): void => {
    let index = targets.value.length + 1;
    let id = `browser-${index}`;
    while (targets.value.some((target) => target.id === id)) id = `browser-${++index}`;
    targets.value.push({ id, endpoints: [], allowedUrlPatterns: ['https://example.com/*'] });
  };

  const removeTarget = (index: number): void => {
    targets.value.splice(index, 1);
  };

  const addEndpoint = (target: BrowserTarget): void => {
    const endpoint: BrowserEndpoint = {
      scope: 'external-network',
      via: 'backend',
      url: 'http://127.0.0.1:9222',
      priority: target.endpoints.length * 10 + 10,
      allowPlaintext: true,
      verifyTls: true,
    };
    target.endpoints.push(endpoint);
  };

  const removeEndpoint = (target: BrowserTarget, index: number): void => {
    target.endpoints.splice(index, 1);
  };

  const patternsText = (target: BrowserTarget): string => target.allowedUrlPatterns.join('\n');
  const updatePatterns = (target: BrowserTarget, value: string): void => {
    target.allowedUrlPatterns = value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const save = (): void => emit('save', { targets: cloneTargets(targets.value) });

  watch(() => props.settings.revision, sync, { immediate: true });
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ $t('agent.settings.browserRuntime.title') }}</h2>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.browserRuntime.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
        :disabled="busy"
        @click="addTarget"
      >
        {{ $t('agent.settings.browserRuntime.addTarget') }}
      </button>
    </div>

    <p v-if="targets.length === 0" class="mt-4 rounded bg-background p-3 text-xs text-text-secondary">
      {{ $t('agent.settings.browserRuntime.empty') }}
    </p>

    <article v-for="(target, targetIndex) in targets" :key="targetIndex" class="mt-4 rounded border border-border p-4">
      <div class="flex items-start justify-between gap-3">
        <label class="min-w-0 flex-1 text-xs text-text-secondary">
          {{ $t('agent.settings.browserRuntime.targetId') }}
          <input v-model="target.id" class="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" />
        </label>
        <button
          type="button"
          class="rounded border border-error/40 px-2 py-1 text-xs text-error disabled:opacity-50"
          :disabled="busy"
          @click="removeTarget(targetIndex)"
        >
          {{ $t('agent.settings.browserRuntime.remove') }}
        </button>
      </div>

      <label class="mt-3 block text-xs text-text-secondary">
        {{ $t('agent.settings.browserRuntime.allowedUrls') }}
        <textarea
          :value="patternsText(target)"
          rows="3"
          class="mt-1 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
          @input="updatePatterns(target, ($event.target as HTMLTextAreaElement).value)"
        />
      </label>

      <div class="mt-3 flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-medium">{{ $t('agent.settings.browserRuntime.endpoints') }}</h3>
          <p class="text-[11px] text-text-secondary">{{ $t('agent.settings.browserRuntime.endpointHint') }}</p>
        </div>
        <button
          type="button"
          class="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
          :disabled="busy"
          @click="addEndpoint(target)"
        >
          {{ $t('agent.settings.browserRuntime.addEndpoint') }}
        </button>
      </div>

      <div
        v-for="(endpoint, endpointIndex) in target.endpoints"
        :key="endpointIndex"
        class="mt-2 rounded bg-background p-3"
      >
        <div class="grid gap-2 md:grid-cols-4">
          <label class="text-[11px] text-text-secondary">
            {{ $t('agent.settings.browserRuntime.scope') }}
            <select v-model="endpoint.scope" class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs">
              <option value="docker-network">{{ $t('agent.settings.browserRuntime.scopeDocker') }}</option>
              <option value="external-network">{{ $t('agent.settings.browserRuntime.scopeExternal') }}</option>
            </select>
          </label>
          <label class="text-[11px] text-text-secondary">
            {{ $t('agent.settings.browserRuntime.via') }}
            <select v-model="endpoint.via" class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs">
              <option value="backend">{{ $t('agent.settings.browserRuntime.viaBackend') }}</option>
              <option value="runner">{{ $t('agent.settings.browserRuntime.viaRunner') }}</option>
            </select>
          </label>
          <label class="text-[11px] text-text-secondary">
            {{ $t('agent.settings.browserRuntime.priority') }}
            <input
              v-model.number="endpoint.priority"
              type="number"
              min="0"
              max="10000"
              class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
            />
          </label>
          <div class="flex items-end justify-end">
            <button
              type="button"
              class="rounded border border-error/40 px-2 py-1 text-xs text-error disabled:opacity-50"
              :disabled="busy"
              @click="removeEndpoint(target, endpointIndex)"
            >
              {{ $t('agent.settings.browserRuntime.removeEndpoint') }}
            </button>
          </div>
        </div>
        <label class="mt-2 block text-[11px] text-text-secondary">
          {{ $t('agent.settings.browserRuntime.url') }}
          <input
            v-model="endpoint.url"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
          />
        </label>
        <div class="mt-2 flex flex-wrap gap-4 text-[11px]">
          <label class="flex items-center gap-2"
            ><input v-model="endpoint.allowPlaintext" type="checkbox" />{{
              $t('agent.settings.browserRuntime.allowPlaintext')
            }}</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="endpoint.verifyTls" type="checkbox" />{{
              $t('agent.settings.browserRuntime.verifyTls')
            }}</label
          >
        </div>
      </div>
    </article>

    <button
      type="button"
      class="mt-4 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
      :disabled="busy"
      @click="save"
    >
      {{ $t('agent.settings.browserRuntime.save') }}
    </button>
  </section>
</template>
