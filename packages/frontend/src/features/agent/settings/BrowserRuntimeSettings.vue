<script setup lang="ts">
  import { BaseModal, UiButton, UiCheckbox, UiInfoHint, UiSelect } from '@/foundation/ui';
  import { computed, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { pickOption } from './pick-option';
  import type { AgentSettingsViewDto } from '../api/agent-api';

  type BrowserTarget = AgentSettingsViewDto['requestedSettings']['browser']['targets'][number];
  type BrowserEndpoint = BrowserTarget['endpoints'][number];

  const props = defineProps<{
    settings: AgentSettingsViewDto;
    busy: boolean;
    save: (patch: AgentSettingsViewDto['requestedSettings']['browser'], success?: string | null) => Promise<boolean>;
  }>();

  const { t } = useI18n();

  const cloneTargets = (source: readonly BrowserTarget[]): BrowserTarget[] =>
    source.map((target) => ({
      ...target,
      endpoints: target.endpoints.map((endpoint) => ({ ...endpoint })),
      allowedUrlPatterns: [...target.allowedUrlPatterns],
    }));

  const baselineTargets = ref<BrowserTarget[]>(cloneTargets(props.settings.requestedSettings.browser.targets));
  const targets = ref<BrowserTarget[]>(cloneTargets(baselineTargets.value));
  const isDirty = computed(() => JSON.stringify(targets.value) !== JSON.stringify(baselineTargets.value));
  const remoteMatchesDraft = computed(
    () => JSON.stringify(targets.value) === JSON.stringify(props.settings.requestedSettings.browser.targets),
  );

  const sync = (): void => {
    baselineTargets.value = cloneTargets(props.settings.requestedSettings.browser.targets);
    targets.value = cloneTargets(baselineTargets.value);
  };

  const persistTargets = async (nextTargets: BrowserTarget[], success: string): Promise<boolean> => {
    const saved = await props.save({ targets: cloneTargets(nextTargets) }, success);
    if (saved) targets.value = cloneTargets(nextTargets);
    return saved;
  };

  const scopeOptions = [
    { value: 'docker-network', label: 'agent.settings.browserRuntime.scopeDocker' },
    { value: 'external-network', label: 'agent.settings.browserRuntime.scopeExternal' },
  ];
  const viaOptions = [
    { value: 'backend', label: 'agent.settings.browserRuntime.viaBackend' },
    { value: 'runner', label: 'agent.settings.browserRuntime.viaRunner' },
  ];

  // 模态弹窗 1：添加目标 (Target)
  const targetModalOpen = ref(false);
  const targetModalError = ref('');
  const targetForm = reactive({
    id: '',
    patternsText: 'https://*/*',
    includeEndpoint: true,
    endpointUrl: 'http://127.0.0.1:9222',
    endpointScope: 'external-network' as BrowserEndpoint['scope'],
    endpointVia: 'backend' as BrowserEndpoint['via'],
    endpointPriority: 10,
    endpointAllowPlaintext: true,
    endpointVerifyTls: true,
  });

  const openAddTargetModal = (): void => {
    let index = targets.value.length + 1;
    let defaultId = `browser-${index}`;
    while (targets.value.some((target) => target.id === defaultId)) defaultId = `browser-${++index}`;

    targetForm.id = defaultId;
    targetForm.patternsText = 'https://*/*';
    targetForm.includeEndpoint = true;
    targetForm.endpointUrl = 'http://127.0.0.1:9222';
    targetForm.endpointScope = 'external-network';
    targetForm.endpointVia = 'backend';
    targetForm.endpointPriority = 10;
    targetForm.endpointAllowPlaintext = true;
    targetForm.endpointVerifyTls = true;
    targetModalError.value = '';
    targetModalOpen.value = true;
  };

  const submitAddTarget = async (): Promise<void> => {
    const id = targetForm.id.trim();
    if (!id) {
      targetModalError.value = t('agent.settings.disabledReason.incompleteForm');
      return;
    }
    if (targets.value.some((candidate) => candidate.id === id)) {
      targetModalError.value = `ID "${id}" already exists.`;
      return;
    }

    const patterns = targetForm.patternsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    const endpoints: BrowserEndpoint[] = [];
    if (targetForm.includeEndpoint && targetForm.endpointUrl.trim()) {
      endpoints.push({
        scope: targetForm.endpointScope,
        via: targetForm.endpointVia,
        url: targetForm.endpointUrl.trim(),
        priority: targetForm.endpointPriority || 10,
        allowPlaintext: targetForm.endpointAllowPlaintext,
        verifyTls: targetForm.endpointVerifyTls,
      });
    }

    const nextTargets = cloneTargets(targets.value);
    nextTargets.push({ id, endpoints, allowedUrlPatterns: patterns.length > 0 ? patterns : ['https://*/*'] });
    const saved = await persistTargets(nextTargets, t('agent.settings.browserRuntime.targetCreated'));
    if (saved) targetModalOpen.value = false;
  };

  const removeTarget = async (index: number): Promise<void> => {
    const nextTargets = cloneTargets(targets.value);
    nextTargets.splice(index, 1);
    await persistTargets(nextTargets, t('agent.settings.browserRuntime.targetDeleted'));
  };

  // 模态弹窗 2：为指定目标添加端点 (Endpoint)
  const endpointModalOpen = ref(false);
  const endpointModalTarget = ref<BrowserTarget | null>(null);
  const endpointModalError = ref('');
  const endpointForm = reactive({
    url: 'http://127.0.0.1:9222',
    scope: 'external-network' as BrowserEndpoint['scope'],
    via: 'backend' as BrowserEndpoint['via'],
    priority: 10,
    allowPlaintext: true,
    verifyTls: true,
  });

  const openAddEndpointModal = (target: BrowserTarget): void => {
    endpointModalTarget.value = target;
    endpointForm.url = 'http://127.0.0.1:9222';
    endpointForm.scope = 'external-network';
    endpointForm.via = 'backend';
    endpointForm.priority = target.endpoints.length * 10 + 10;
    endpointForm.allowPlaintext = true;
    endpointForm.verifyTls = true;
    endpointModalError.value = '';
    endpointModalOpen.value = true;
  };

  const submitAddEndpoint = async (): Promise<void> => {
    if (!endpointModalTarget.value) return;
    const url = endpointForm.url.trim();
    if (!url) {
      endpointModalError.value = t('agent.settings.disabledReason.incompleteForm');
      return;
    }

    const nextTargets = cloneTargets(targets.value);
    const target = nextTargets.find((candidate) => candidate.id === endpointModalTarget.value?.id);
    if (!target) return;

    target.endpoints.push({
      scope: endpointForm.scope,
      via: endpointForm.via,
      url,
      priority: endpointForm.priority || 10,
      allowPlaintext: endpointForm.allowPlaintext,
      verifyTls: endpointForm.verifyTls,
    });

    const saved = await persistTargets(nextTargets, t('agent.settings.browserRuntime.endpointAdded'));
    if (saved) endpointModalOpen.value = false;
  };

  const removeEndpoint = async (target: BrowserTarget, endpointIndex: number): Promise<void> => {
    const nextTargets = cloneTargets(targets.value);
    const found = nextTargets.find((candidate) => candidate.id === target.id);
    if (!found) return;
    found.endpoints.splice(endpointIndex, 1);
    await persistTargets(nextTargets, t('agent.settings.browserRuntime.endpointDeleted'));
  };

  const setTargetEndpointScope = (value: unknown): void => {
    const next = pickOption(value, ['docker-network', 'external-network'] as const);
    if (next) targetForm.endpointScope = next;
  };

  const setTargetEndpointVia = (value: unknown): void => {
    const next = pickOption(value, ['backend', 'runner'] as const);
    if (next) targetForm.endpointVia = next;
  };

  const setModalEndpointScope = (value: unknown): void => {
    const next = pickOption(value, ['docker-network', 'external-network'] as const);
    if (next) endpointForm.scope = next;
  };

  const setModalEndpointVia = (value: unknown): void => {
    const next = pickOption(value, ['backend', 'runner'] as const);
    if (next) endpointForm.via = next;
  };

  watch(
    () => props.settings.revision,
    () => {
      if (!isDirty.value || remoteMatchesDraft.value) sync();
    },
    { immediate: true },
  );
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all">
    <!-- 顶栏：标题、说明与添加目标按钮 -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5 rounded-t-2xl agent-settings-head"
      :class="{ 'border-b border-border': targets.length > 0 }"
    >
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.browserRuntime.title') }}</h3>
        <span
          v-if="targets.length > 0"
          class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
        >
          {{ targets.length }}
        </span>
        <UiInfoHint :text="$t('agent.settings.browserRuntime.description')" />
      </div>
      <UiButton
        appearance="soft"
        tone="neutral"
        type="button"
        :disabled="busy"
        class="w-[88px]"
        @click="openAddTargetModal"
      >
        <span class="inline-flex items-center gap-1.5 text-xs">
          <i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
          <span>{{ $t('agent.settings.browserRuntime.addTarget') }}</span>
        </span>
      </UiButton>
    </div>

    <!-- 已添加列表：没有的话完全不显示任何占位 -->
    <div v-if="targets.length > 0" class="space-y-3.5 p-4 sm:p-5">
      <article
        v-for="(target, targetIndex) in targets"
        :key="target.id"
        class="rounded-2xl border border-border/80 bg-card/80 p-4 transition-all hover:bg-card/95 shadow-2xs space-y-3.5"
      >
        <!-- 目标主体行 -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/25 text-primary shadow-2xs"
            >
              <i class="fa-solid fa-globe text-sm" aria-hidden="true"></i>
            </div>
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center rounded-xl border border-border/90 bg-background/90 px-3 py-1 text-sm sm:text-base font-bold tracking-tight text-foreground shadow-2xs"
                >
                  {{ target.id }}
                </span>
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/50 px-2.5 py-0.5 text-[11px] font-mono text-text-secondary"
                >
                  <i class="fa-solid fa-network-wired text-[9px] text-text-secondary/60"></i>
                  <span>{{ target.endpoints.length }} {{ $t('agent.settings.browserRuntime.endpoints') }}</span>
                </span>
              </div>

              <!-- URL Patterns 预览 -->
              <div class="flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
                <span class="text-[11px] text-text-secondary/70"
                  >{{ $t('agent.settings.browserRuntime.allowedUrls') }}:</span
                >
                <span
                  v-for="(pattern, pIndex) in target.allowedUrlPatterns.slice(0, 3)"
                  :key="pIndex"
                  class="rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary truncate max-w-[200px]"
                >
                  {{ pattern }}
                </span>
                <span v-if="target.allowedUrlPatterns.length > 3" class="text-[11px] text-text-secondary/60 font-mono">
                  +{{ target.allowedUrlPatterns.length - 3 }}
                </span>
              </div>
            </div>
          </div>

          <!-- 右侧操作工具条 -->
          <div
            class="flex items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t border-border/30 sm:border-0"
          >
            <UiButton
              appearance="soft"
              tone="neutral"
              density="compact"
              type="button"
              :disabled="busy"
              @click="openAddEndpointModal(target)"
            >
              <span class="inline-flex items-center gap-1.5 text-xs">
                <i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.browserRuntime.addEndpoint') }}</span>
              </span>
            </UiButton>
            <UiButton
              appearance="soft"
              tone="danger"
              density="compact"
              icon-only
              type="button"
              :disabled="busy"
              :title="$t('agent.settings.browserRuntime.remove')"
              :aria-label="$t('agent.settings.browserRuntime.remove')"
              @click="removeTarget(targetIndex)"
            >
              <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
            </UiButton>
          </div>
        </div>

        <!-- CDP 端点卡片列表（如果有端点） -->
        <div v-if="target.endpoints.length > 0" class="pt-2 border-t border-border/40 space-y-2">
          <div
            v-for="(endpoint, endpointIndex) in target.endpoints"
            :key="endpointIndex"
            class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-border/60 bg-header/20 p-2.5 text-xs transition-all hover:bg-header/35"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <i class="fa-solid fa-link text-[10px] text-text-secondary/60 shrink-0"></i>
              <span class="font-mono text-xs text-foreground truncate max-w-[280px] sm:max-w-[360px]">{{
                endpoint.url
              }}</span>
              <span
                class="rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-[10px] text-text-secondary shrink-0"
              >
                {{ $t(scopeOptions.find((o) => o.value === endpoint.scope)?.label || '') }}
              </span>
              <span
                class="rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-[10px] text-text-secondary shrink-0"
              >
                {{ $t(viaOptions.find((o) => o.value === endpoint.via)?.label || '') }}
              </span>
              <span class="text-[10px] text-text-secondary/70 shrink-0">P{{ endpoint.priority }}</span>
            </div>

            <div class="flex items-center justify-end gap-2 shrink-0">
              <span v-if="endpoint.allowPlaintext" class="text-[10px] text-text-secondary/80">HTTP/WS</span>
              <span v-if="endpoint.verifyTls" class="text-[10px] text-success">TLS</span>
              <UiButton
                appearance="ghost"
                tone="danger"
                density="compact"
                icon-only
                type="button"
                :disabled="busy"
                :title="$t('agent.settings.browserRuntime.removeEndpoint')"
                :aria-label="$t('agent.settings.browserRuntime.removeEndpoint')"
                @click="removeEndpoint(target, endpointIndex)"
              >
                <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
              </UiButton>
            </div>
          </div>
        </div>
      </article>

      <!-- 底部轻量新增按钮 -->
      <button
        type="button"
        :disabled="busy"
        class="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-header/10 hover:bg-header/25 hover:border-border-hover py-2.5 text-xs text-text-secondary hover:text-foreground transition-all duration-200 cursor-pointer select-none active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
        @click="openAddTargetModal"
      >
        <i
          class="fa-solid fa-plus text-[10px] text-text-secondary/70 group-hover:text-foreground transition-colors"
          aria-hidden="true"
        ></i>
        <span class="font-medium">{{ $t('agent.settings.browserRuntime.addTarget') }}</span>
      </button>
    </div>

    <!-- 弹窗 1：添加浏览器目标模态弹窗 -->
    <BaseModal
      :visible="targetModalOpen"
      :title="$t('agent.settings.browserRuntime.modalTitle')"
      :aria-label="$t('agent.settings.browserRuntime.modalTitle')"
      :close-on-backdrop="!busy"
      :close-on-escape="!busy"
      :focus-on-open="true"
      :restore-focus="true"
      panel-class="max-w-xl p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
      @close="targetModalOpen = false"
    >
      <div class="space-y-4">
        <p class="text-xs text-text-secondary leading-relaxed">
          {{ $t('agent.settings.browserRuntime.modalDescription') }}
        </p>

        <div class="space-y-3.5">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">
              {{ $t('agent.settings.browserRuntime.targetId') }} <span class="text-error">*</span>
            </span>
            <div class="relative flex items-center">
              <i
                class="fa-solid fa-globe absolute left-3 text-text-secondary text-xs pointer-events-none"
                aria-hidden="true"
              ></i>
              <input
                v-model="targetForm.id"
                required
                data-no-highlight
                class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
                placeholder="browser-1"
              />
            </div>
          </label>

          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">
              {{ $t('agent.settings.browserRuntime.allowedUrls') }}
            </span>
            <textarea
              v-model="targetForm.patternsText"
              rows="2"
              data-no-highlight
              class="w-full rounded-lg border border-border/80 bg-background p-2.5 font-mono text-xs text-foreground outline-none focus:border-border-hover"
              placeholder="https://*/*"
            />
          </label>

          <!-- 初始端点配置子区块 -->
          <div class="rounded-xl border border-border/60 bg-header/15 p-3.5 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <i class="fa-solid fa-link text-primary text-[11px]" aria-hidden="true"></i>
                {{ $t('agent.settings.browserRuntime.endpoints') }}
              </span>
              <label class="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
                <UiCheckbox v-model="targetForm.includeEndpoint" />
                <span>{{ $t('agent.settings.browserRuntime.addEndpoint') }}</span>
              </label>
            </div>

            <div v-if="targetForm.includeEndpoint" class="space-y-2.5">
              <label class="block">
                <span class="mb-1 block text-[11px] text-text-secondary">
                  {{ $t('agent.settings.browserRuntime.url') }} <span class="text-error">*</span>
                </span>
                <div class="relative flex items-center">
                  <i
                    class="fa-solid fa-link absolute left-2.5 text-text-secondary text-[11px] pointer-events-none"
                    aria-hidden="true"
                  ></i>
                  <input
                    v-model="targetForm.endpointUrl"
                    data-no-highlight
                    class="h-8.5 w-full rounded-lg border border-border/80 bg-background pl-7 pr-2.5 font-mono text-xs text-foreground outline-none focus:border-border-hover"
                    placeholder="http://127.0.0.1:9222"
                  />
                </div>
              </label>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label class="block">
                  <span class="mb-1 block text-[11px] text-text-secondary">{{
                    $t('agent.settings.browserRuntime.scope')
                  }}</span>
                  <UiSelect
                    density="compact"
                    class="w-full"
                    :model-value="targetForm.endpointScope"
                    :options="scopeOptions.map((option) => ({ value: option.value, label: $t(option.label) }))"
                    @update:model-value="setTargetEndpointScope"
                  />
                </label>
                <label class="block">
                  <span class="mb-1 block text-[11px] text-text-secondary">{{
                    $t('agent.settings.browserRuntime.via')
                  }}</span>
                  <UiSelect
                    density="compact"
                    class="w-full"
                    :model-value="targetForm.endpointVia"
                    :options="viaOptions.map((option) => ({ value: option.value, label: $t(option.label) }))"
                    @update:model-value="setTargetEndpointVia"
                  />
                </label>
                <label class="block">
                  <span class="mb-1 block text-[11px] text-text-secondary">{{
                    $t('agent.settings.browserRuntime.priority')
                  }}</span>
                  <input
                    v-model.number="targetForm.endpointPriority"
                    type="number"
                    min="0"
                    max="10000"
                    data-no-highlight
                    class="h-8.5 w-full rounded-lg border border-border/80 bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-border-hover"
                  />
                </label>
              </div>

              <div class="flex flex-wrap gap-4 pt-1 text-[11px] text-text-secondary">
                <label class="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <UiCheckbox v-model="targetForm.endpointAllowPlaintext" />
                  <span>{{ $t('agent.settings.browserRuntime.allowPlaintext') }}</span>
                </label>
                <label class="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <UiCheckbox v-model="targetForm.endpointVerifyTls" />
                  <span>{{ $t('agent.settings.browserRuntime.verifyTls') }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="targetModalError"
          class="rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error flex items-center gap-2"
        >
          <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          <span>{{ targetModalError }}</span>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="targetModalOpen = false">
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="busy || !targetForm.id.trim()"
            @click="submitAddTarget"
          >
            <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.providers.saveAndAdd') }}</span>
          </UiButton>
        </div>
      </template>
    </BaseModal>

    <!-- 弹窗 2：添加端点模态弹窗 -->
    <BaseModal
      :visible="endpointModalOpen"
      :title="`${endpointModalTarget?.id || ''} · ${$t('agent.settings.browserRuntime.modalEndpointTitle')}`"
      :aria-label="$t('agent.settings.browserRuntime.modalEndpointTitle')"
      :close-on-backdrop="!busy"
      :close-on-escape="!busy"
      :focus-on-open="true"
      :restore-focus="true"
      panel-class="max-w-lg p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
      @close="endpointModalOpen = false"
    >
      <div class="space-y-4">
        <p class="text-xs text-text-secondary leading-relaxed">
          {{ $t('agent.settings.browserRuntime.endpointHint') }}
        </p>

        <div class="space-y-3">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">
              {{ $t('agent.settings.browserRuntime.url') }} <span class="text-error">*</span>
            </span>
            <div class="relative flex items-center">
              <i
                class="fa-solid fa-link absolute left-3 text-text-secondary text-xs pointer-events-none"
                aria-hidden="true"
              ></i>
              <input
                v-model="endpointForm.url"
                required
                data-no-highlight
                class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
                placeholder="http://127.0.0.1:9222"
              />
            </div>
          </label>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">{{
                $t('agent.settings.browserRuntime.scope')
              }}</span>
              <UiSelect
                density="compact"
                class="w-full"
                :model-value="endpointForm.scope"
                :options="scopeOptions.map((option) => ({ value: option.value, label: $t(option.label) }))"
                @update:model-value="setModalEndpointScope"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">{{
                $t('agent.settings.browserRuntime.via')
              }}</span>
              <UiSelect
                density="compact"
                class="w-full"
                :model-value="endpointForm.via"
                :options="viaOptions.map((option) => ({ value: option.value, label: $t(option.label) }))"
                @update:model-value="setModalEndpointVia"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">{{
                $t('agent.settings.browserRuntime.priority')
              }}</span>
              <input
                v-model.number="endpointForm.priority"
                type="number"
                min="0"
                max="10000"
                data-no-highlight
                class="h-8.5 w-full rounded-lg border border-border/80 bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-border-hover"
              />
            </label>
          </div>

          <div
            class="rounded-xl border border-border/60 bg-header/15 p-3 flex flex-wrap gap-4 text-xs text-text-secondary"
          >
            <label class="inline-flex items-center gap-1.5 cursor-pointer select-none text-foreground">
              <UiCheckbox v-model="endpointForm.allowPlaintext" />
              <span>{{ $t('agent.settings.browserRuntime.allowPlaintext') }}</span>
            </label>
            <label class="inline-flex items-center gap-1.5 cursor-pointer select-none text-foreground">
              <UiCheckbox v-model="endpointForm.verifyTls" />
              <span>{{ $t('agent.settings.browserRuntime.verifyTls') }}</span>
            </label>
          </div>
        </div>

        <div
          v-if="endpointModalError"
          class="rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error flex items-center gap-2"
        >
          <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          <span>{{ endpointModalError }}</span>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="endpointModalOpen = false">
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="busy || !endpointForm.url.trim()"
            @click="submitAddEndpoint"
          >
            <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.providers.saveAndAdd') }}</span>
          </UiButton>
        </div>
      </template>
    </BaseModal>
  </section>
</template>
