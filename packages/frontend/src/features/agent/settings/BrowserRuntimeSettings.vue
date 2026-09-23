<script setup lang="ts">
  import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
  import { ref, watch } from 'vue';
  import type { AgentSettingsViewDto } from '../api/agent-api';

  type BrowserTarget = AgentSettingsViewDto['requestedSettings']['browser']['targets'][number];
  type BrowserEndpoint = BrowserTarget['endpoints'][number];

  const props = defineProps<{ settings: AgentSettingsViewDto; busy: boolean }>();
  const emit = defineEmits<{ save: [patch: AgentSettingsViewDto['requestedSettings']['browser']] }>();

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
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.browserRuntime.title') }}</h3>
        <UiInfoHint :text="$t('agent.settings.browserRuntime.description')" />
      </div>
      <UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="addTarget">
        <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
        <span>{{ $t('agent.settings.browserRuntime.addTarget') }}</span>
      </UiButton>
    </div>
    <div class="space-y-4 p-4 sm:p-5">
      <p v-if="targets.length === 0" class="mt-4 rounded bg-background p-3 text-xs text-text-secondary">
        {{ $t('agent.settings.browserRuntime.empty') }}
      </p>

      <article
        v-for="(target, targetIndex) in targets"
        :key="targetIndex"
        class="mt-4 rounded border border-border p-4"
      >
        <div class="flex items-start justify-between gap-3">
          <label class="min-w-0 flex-1 text-xs text-text-secondary">
            {{ $t('agent.settings.browserRuntime.targetId') }}
            <input
              v-model="target.id"
              class="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <UiButton appearance="soft" tone="danger" type="button" :disabled="busy" @click="removeTarget(targetIndex)">
            {{ $t('agent.settings.browserRuntime.remove') }}
          </UiButton>
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
          <UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="addEndpoint(target)">
            {{ $t('agent.settings.browserRuntime.addEndpoint') }}
          </UiButton>
        </div>

        <div
          v-for="(endpoint, endpointIndex) in target.endpoints"
          :key="endpointIndex"
          class="mt-2 rounded bg-background p-3"
        >
          <div class="grid gap-2 md:grid-cols-4">
            <label class="text-[11px] text-text-secondary">
              {{ $t('agent.settings.browserRuntime.scope') }}
              <select
                v-model="endpoint.scope"
                class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
              >
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
              <UiButton
                appearance="soft"
                tone="danger"
                type="button"
                :disabled="busy"
                @click="removeEndpoint(target, endpointIndex)"
              >
                {{ $t('agent.settings.browserRuntime.removeEndpoint') }}
              </UiButton>
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
            <label class="flex items-center gap-2">
              <UiCheckbox v-model="endpoint.allowPlaintext" />
              <span>{{ $t('agent.settings.browserRuntime.allowPlaintext') }}</span>
            </label>
            <label class="flex items-center gap-2">
              <UiCheckbox v-model="endpoint.verifyTls" />
              <span>{{ $t('agent.settings.browserRuntime.verifyTls') }}</span>
            </label>
          </div>
        </div>
      </article>

      <UiButton appearance="solid" tone="primary" type="button" :disabled="busy" @click="save" class="mt-4">
        {{ $t('agent.settings.browserRuntime.save') }}
      </UiButton>
    </div>
  </section>
</template>
