<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type {
    AgentArtifactRefDto,
    AgentLedgerEntryDto,
    AgentPendingUserInputRequestDto,
    AgentRunReconciliationViewDto,
    AgentRunSnapshotDto,
    AgentRunViewDto,
  } from '../api/agent-api';
  import type { ConversationCommandResult } from './conversation-command-executor';
  import ArtifactPicker from '../files/ArtifactPicker.vue';
  import AgentMessageBody from './AgentMessageBody.vue';
  import ConversationMessage from './ConversationMessage.vue';
  import { conversationCommandSuggestions, type ConversationCommandSuggestion } from './conversation-commands';

  const props = defineProps<{
    appId: string;
    error?: string;
    reconciliation?: boolean;
    reconciliationDetails?: AgentRunReconciliationViewDto | null;
    reconciliationBusy?: boolean;
    entries: AgentLedgerEntryDto[];
    nextCursor: string | null;
    run: AgentRunViewDto | null;
    inputRequest: AgentPendingUserInputRequestDto | null;
    streamingText: string;
    draft: string;
    busy: boolean;
    canSend: boolean;
    attachments: AgentArtifactRefDto[];
    commandResult: ConversationCommandResult | null;
  }>();
  const emit = defineEmits<{
    dismissError: [];
    loadOlder: [];
    send: [text: string, attachments: AgentArtifactRefDto[]];
    cancel: [];
    updateDraft: [value: string];
    updateAttachments: [value: AgentArtifactRefDto[]];
    dismissCommandResult: [];
    resolveReconciliation: [note: string];
  }>();

  const { t } = useI18n();
  const reconciliationNote = ref('');
  const reconciliationResourceReason = (reason: string): string =>
    reason === 'LEASE_STATE_UNCERTAIN_AFTER_MUTATION' ? t('agent.operations.reconciliationLeaseFinalization') : reason;
  watch(
    () => props.reconciliation,
    (required) => {
      if (!required) reconciliationNote.value = '';
    },
  );

  type HomePromptTone = 'primary' | 'emerald' | 'sky' | 'amber';

  interface HomePromptCard {
    promptKey: string;
    titleKey: string;
    descriptionKey: string;
    icon: string;
    tone: HomePromptTone;
  }

  const HOME_PROMPT_ROTATE_MS = 9_000;
  const HOME_PROMPTS_PER_PAGE = 2;
  const homePromptCards: HomePromptCard[] = [
    {
      promptKey: 'agent.ui.promptExplain',
      titleKey: 'agent.conversation.bentoExplainTitle',
      descriptionKey: 'agent.conversation.bentoExplainDesc',
      icon: 'fa-code',
      tone: 'primary',
    },
    {
      promptKey: 'agent.ui.promptDiagnose',
      titleKey: 'agent.conversation.bentoDiagnoseTitle',
      descriptionKey: 'agent.conversation.bentoDiagnoseDesc',
      icon: 'fa-shield-halved',
      tone: 'emerald',
    },
    {
      promptKey: 'agent.ui.promptProjectOverview',
      titleKey: 'agent.conversation.bentoProjectTitle',
      descriptionKey: 'agent.conversation.bentoProjectDesc',
      icon: 'fa-diagram-project',
      tone: 'sky',
    },
    {
      promptKey: 'agent.ui.promptReviewChanges',
      titleKey: 'agent.conversation.bentoReviewTitle',
      descriptionKey: 'agent.conversation.bentoReviewDesc',
      icon: 'fa-code-branch',
      tone: 'amber',
    },
    {
      promptKey: 'agent.ui.promptTroubleshoot',
      titleKey: 'agent.conversation.bentoTroubleshootTitle',
      descriptionKey: 'agent.conversation.bentoTroubleshootDesc',
      icon: 'fa-stethoscope',
      tone: 'emerald',
    },
    {
      promptKey: 'agent.ui.promptRunChecks',
      titleKey: 'agent.conversation.bentoChecksTitle',
      descriptionKey: 'agent.conversation.bentoChecksDesc',
      icon: 'fa-vial-circle-check',
      tone: 'primary',
    },
    {
      promptKey: 'agent.ui.promptAutomation',
      titleKey: 'agent.conversation.bentoAutomationTitle',
      descriptionKey: 'agent.conversation.bentoAutomationDesc',
      icon: 'fa-gears',
      tone: 'sky',
    },
    {
      promptKey: 'agent.ui.promptNextSteps',
      titleKey: 'agent.conversation.bentoNextStepsTitle',
      descriptionKey: 'agent.conversation.bentoNextStepsDesc',
      icon: 'fa-list-check',
      tone: 'amber',
    },
  ];

  const homePromptToneClasses: Record<HomePromptTone, { card: string; icon: string; title: string; arrow: string }> = {
    primary: {
      card: 'bg-gradient-to-br from-primary/[0.04] via-card to-card hover:border-primary/45 hover:shadow-[0_8px_24px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]',
      icon: 'bg-primary/10 text-primary border-primary/20 group-hover:bg-primary/15',
      title: 'group-hover:text-primary',
      arrow: 'group-hover:text-primary',
    },
    emerald: {
      card: 'bg-gradient-to-br from-success/[0.04] via-card to-card hover:border-success/45 hover:shadow-[0_8px_24px_color-mix(in_srgb,var(--color-success)_18%,transparent)]',
      icon: 'bg-success/10 text-success border-success/20 group-hover:bg-success/15',
      title: 'group-hover:text-success',
      arrow: 'group-hover:text-success',
    },
    sky: {
      card: 'bg-gradient-to-br from-info/[0.04] via-card to-card hover:border-info/45 hover:shadow-[0_8px_24px_color-mix(in_srgb,var(--color-info)_18%,transparent)]',
      icon: 'bg-info/10 text-info border-info/20 group-hover:bg-info/15',
      title: 'group-hover:text-info',
      arrow: 'group-hover:text-info',
    },
    amber: {
      card: 'bg-gradient-to-br from-warning/[0.04] via-card to-card hover:border-warning/45 hover:shadow-[0_8px_24px_color-mix(in_srgb,var(--color-warning)_18%,transparent)]',
      icon: 'bg-warning/10 text-warning border-warning/20 group-hover:bg-warning/15',
      title: 'group-hover:text-warning',
      arrow: 'group-hover:text-warning',
    },
  };

  const homePromptPage = ref(0);
  const homePromptPageCount = Math.ceil(homePromptCards.length / HOME_PROMPTS_PER_PAGE);
  const visibleHomePromptCards = computed(() => {
    const start = homePromptPage.value * HOME_PROMPTS_PER_PAGE;
    return homePromptCards.slice(start, start + HOME_PROMPTS_PER_PAGE);
  });

  let homePromptTimer: number | null = null;
  onMounted(() => {
    homePromptTimer = window.setInterval(() => {
      if (props.entries.length > 0 || props.streamingText || props.draft.trim()) return;
      homePromptPage.value = (homePromptPage.value + 1) % homePromptPageCount;
    }, HOME_PROMPT_ROTATE_MS);
  });
  onBeforeUnmount(() => {
    if (homePromptTimer !== null) window.clearInterval(homePromptTimer);
  });

  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const toolCallsFromEntry = (entry: AgentLedgerEntryDto): Array<Record<string, unknown>> => {
    const payload = asRecord(entry.payload);
    return Array.isArray(payload?.toolCalls)
      ? payload.toolCalls.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
      : [];
  };
  const toolNameByCallId = computed(() => {
    const names = new Map<string, string>();
    for (const entry of props.entries) {
      for (const call of toolCallsFromEntry(entry)) {
        if (typeof call.id === 'string' && typeof call.name === 'string') names.set(call.id, call.name);
      }
    }
    return names;
  });
  const relatedToolName = (entry: AgentLedgerEntryDto): string => {
    if (entry.kind !== 'tool_result') return '';
    const payload = asRecord(entry.payload);
    const callId = typeof payload?.toolCallId === 'string' ? payload.toolCallId : '';
    return callId ? (toolNameByCallId.value.get(callId) ?? '') : '';
  };
  const entrySpacingClass = (entry: AgentLedgerEntryDto): string => {
    if (entry.kind === 'user_input') return 'mb-7';
    if (entry.kind === 'tool_result' || entry.kind === 'system_notice') return 'mb-5';
    if (entry.kind === 'assistant_message' && toolCallsFromEntry(entry).length > 0) return 'mb-0.5';
    return 'mb-7';
  };

  const visibleEntries = computed(() =>
    props.entries.filter((entry) => {
      if (entry.kind !== 'assistant_message') return true;
      const payload = entry.payload;
      if (typeof payload === 'string') return Boolean(payload.trim());
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>;
        const text = record.text;
        if (typeof text === 'string' && text.trim()) return true;
        if (Array.isArray(record.toolCalls) && record.toolCalls.length > 0) return true;
        return false;
      }
      return true;
    }),
  );
  const showJumpToLatest = ref(false);
  const scroller = ref<HTMLElement | null>(null);
  let keepPinnedToBottom = true;
  const commandSuggestions = computed(() => conversationCommandSuggestions(props.draft));
  const applyCommandSuggestion = (suggestion: ConversationCommandSuggestion): void => {
    const needsArgument = suggestion.command === '/goal' || suggestion.command === '/interrupt';
    emit('updateDraft', needsArgument ? `${suggestion.command} ` : suggestion.command);
  };
  const applyInputChoice = (questionId: string, value: string): void => {
    const prefix = `${questionId}:`;
    const answer = `${prefix} ${value}`;
    const lines = props.draft
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const existing = lines.findIndex((line) => line.startsWith(prefix));
    if (existing >= 0) lines[existing] = answer;
    else lines.push(answer);
    emit('updateDraft', lines.join('\n'));
  };
  const activeRun = computed(() =>
    Boolean(
      props.run &&
      ['created', 'running', 'awaiting_approval', 'awaiting_budget', 'awaiting_input', 'cancelling'].includes(
        props.run.status,
      ),
    ),
  );
  const hasDraft = computed(() => Boolean(props.draft.trim()));
  const send = () => {
    const text = props.draft.trim();
    if (!text || !props.canSend || props.busy) return;
    emit('send', text, props.attachments);
  };
  const cancelling = computed(() => props.run?.status === 'cancelling');
  // 「发送」与「停止」是两个独立的动作：发送按钮永远只发送，活动 Run 的停止
  // 由旁边独立的停止按钮承担，避免同一个按钮随草稿有无在两种语义间切换。
  const sendDisabled = computed(() => props.busy || !props.canSend || !hasDraft.value);
  const stopRun = (): void => {
    if (props.busy || cancelling.value) return;
    emit('cancel');
  };
  const stopDisabled = computed(() => props.busy || cancelling.value);

  const onComposerEnter = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  const isNearBottom = (): boolean => {
    const element = scroller.value;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 96;
  };

  const scrollToBottom = async (): Promise<void> => {
    await nextTick();
    const element = scroller.value;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  };

  const handleScroll = (): void => {
    keepPinnedToBottom = isNearBottom();
    showJumpToLatest.value = !keepPinnedToBottom;
  };

  const handleDisclosureLayoutChange = async (): Promise<void> => {
    const pinned = keepPinnedToBottom;
    await nextTick();
    if (!pinned) return;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await scrollToBottom();
  };

  watch(
    () => [props.entries.length, props.streamingText] as const,
    () => {
      keepPinnedToBottom = isNearBottom();
      if (keepPinnedToBottom) void scrollToBottom();
    },
  );

  const totalRunTokens = computed(() => {
    if (!props.run) return 0;
    return props.run.usage.inputTokens + props.run.usage.outputTokens;
  });

  const runCacheRate = computed(() => {
    if (!props.run || props.run.usage.inputTokens <= 0) return 0;
    const rate = (props.run.usage.cachedInputTokens / props.run.usage.inputTokens) * 100;
    return Math.min(100, Math.max(0, Math.round(rate * 10) / 10));
  });

  const formatTokens = (num: number): string => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  const showRunTokens = computed(() => Boolean(props.run && totalRunTokens.value > 0));

  const isRunSnapshot = (run: AgentRunViewDto): run is AgentRunSnapshotDto => 'terminalIssue' in run;

  const terminalIssueDetail = computed(() => {
    const run = props.run;
    if (!run || !isRunSnapshot(run)) return '';
    const issue = run.terminalIssue;
    if (!issue) return '';
    const code = issue.errorCode?.trim() ?? '';
    const knownIssueKeys: Readonly<Record<string, string>> = {
      PROVIDER_HTTP_429: 'agent.conversation.runIssue.providerRateLimited',
      PROVIDER_HTTP_401: 'agent.conversation.runIssue.providerUnauthorized',
      PROVIDER_HTTP_403: 'agent.conversation.runIssue.providerForbidden',
      PROVIDER_HTTP_500: 'agent.conversation.runIssue.providerUnavailable',
      PROVIDER_HTTP_502: 'agent.conversation.runIssue.providerUnavailable',
      PROVIDER_HTTP_503: 'agent.conversation.runIssue.providerUnavailable',
      PROVIDER_HTTP_504: 'agent.conversation.runIssue.providerUnavailable',
      MODEL_NOT_FOUND: 'agent.conversation.runIssue.modelNotFound',
      PROVIDER_CONFIGURATION_STALE: 'agent.conversation.runIssue.providerConfigurationStale',
      RESOURCE_QUARANTINED: 'agent.conversation.runIssue.resourceQuarantined',
      RECONCILIATION_REQUIRED: 'agent.conversation.runIssue.reconciliationRequired',
      LEASE_CONFLICT: 'agent.conversation.runIssue.leaseConflict',
      LEASE_LOST: 'agent.conversation.runIssue.leaseLost',
    };
    const knownKey = code ? knownIssueKeys[code] : undefined;
    const detail = knownKey ? t(knownKey) : issue.reason?.trim() || '';
    if (detail && code && !detail.includes(code)) return `${detail} [${code}]`;
    return detail || code;
  });

  const terminalRunNotice = computed(() => {
    const status = props.run?.status;
    if (status === 'failed') {
      return {
        titleKey: 'agent.conversation.runFailedTitle',
        hintKey: 'agent.conversation.runFailedHint',
        icon: 'fa-triangle-exclamation',
        className: 'border-error/30 bg-error/[0.045] text-error',
      };
    }
    if (status === 'interrupted') {
      return {
        titleKey: 'agent.conversation.runInterruptedTitle',
        hintKey: 'agent.conversation.runInterruptedHint',
        icon: 'fa-pause',
        className: 'border-warning/35 bg-warning/[0.055] text-warning',
      };
    }
    if (status === 'cancelled') {
      return {
        titleKey: 'agent.conversation.runCancelledTitle',
        hintKey: 'agent.conversation.runCancelledHint',
        icon: 'fa-ban',
        className: 'border-border/70 bg-header/35 text-text-secondary',
      };
    }
    return null;
  });
</script>

<template>
  <section class="relative flex h-full min-h-0 flex-col bg-background overflow-hidden">
    <!-- 背景极轻环境弥散微光层 -->
    <div class="agent-conversation-ambient pointer-events-none absolute inset-0 z-0 opacity-70"></div>

    <div class="relative z-10 min-h-0 flex-1">
      <div
        ref="scroller"
        class="agent-conversation-scroller h-full overflow-y-auto overscroll-contain px-5 py-5"
        @scroll.passive="handleScroll"
      >
        <div class="mx-auto mb-4 flex max-w-3xl justify-center">
          <button
            v-if="nextCursor"
            type="button"
            class="rounded-full bg-card/80 px-3.5 py-2 text-xs text-text-secondary shadow-sm hover:bg-header hover:text-foreground"
            :disabled="busy"
            @click="emit('loadOlder')"
          >
            <i class="fa-solid fa-clock-rotate-left mr-1.5" aria-hidden="true"></i>
            {{ $t('agent.conversation.loadOlder') }}
          </button>
        </div>
        <div
          v-if="entries.length === 0 && !streamingText"
          class="relative z-10 mx-auto flex min-h-[460px] max-w-3xl flex-col items-center justify-center px-4 py-4 text-center select-none"
        >
          <!-- 顶端微胶囊标识 -->
          <div
            class="mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3.5 py-0.5 text-[11px] font-semibold tracking-wider text-primary shadow-2xs"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></span>
            <span>{{ $t('agent.conversation.heroTag') }}</span>
          </div>

          <!-- 柔和环境光晕与现代卡片图标 -->
          <div class="relative flex items-center justify-center">
            <div class="absolute -inset-4 rounded-3xl bg-primary/20 blur-2xl pointer-events-none"></div>
            <div
              class="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-b from-card to-card/90 text-primary shadow-xl shadow-primary/15 backdrop-blur-xs ring-1 ring-border/30"
            >
              <i class="fa-solid fa-wand-magic-sparkles text-2xl" aria-hidden="true"></i>
            </div>
          </div>

          <h2 class="mt-4 text-xl font-bold tracking-tight text-foreground">
            {{ $t('agent.conversation.emptyTitle') }}
          </h2>
          <p class="mt-1.5 max-w-sm text-xs leading-relaxed text-text-secondary/80">
            {{ $t('agent.conversation.emptyDescription') }}
          </p>

          <!-- 现代化便当盒磁贴 (Bento Grid) -->
          <div class="mt-6.5 grid w-full grid-cols-1 sm:grid-cols-2 gap-3.5">
            <button
              v-for="prompt in visibleHomePromptCards"
              :key="prompt.promptKey"
              type="button"
              class="group relative flex items-center rounded-2xl border border-border/75 p-3.5 text-left shadow-sm backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
              :class="homePromptToneClasses[prompt.tone].card"
              @click="emit('updateDraft', $t(prompt.promptKey))"
            >
              <div class="flex items-start gap-3.5 w-full">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-2xs transition-all group-hover:scale-105"
                  :class="homePromptToneClasses[prompt.tone].icon"
                >
                  <i class="fa-solid text-sm" :class="prompt.icon" aria-hidden="true"></i>
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between">
                    <span
                      class="text-[13px] font-bold tracking-tight text-foreground transition-colors"
                      :class="homePromptToneClasses[prompt.tone].title"
                    >
                      {{ $t(prompt.titleKey) }}
                    </span>
                    <span
                      class="text-xs text-text-secondary/40 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      :class="homePromptToneClasses[prompt.tone].arrow"
                      aria-hidden="true"
                      >↗</span
                    >
                  </div>
                  <p class="mt-1 text-xs leading-relaxed text-text-secondary/75">
                    {{ $t(prompt.descriptionKey) }}
                  </p>
                </div>
              </div>
            </button>
          </div>
          <div class="mt-3 flex items-center justify-center gap-1.5">
            <button
              v-for="page in homePromptPageCount"
              :key="page"
              type="button"
              class="h-4 rounded-full px-0 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              :class="page - 1 === homePromptPage ? 'w-5' : 'w-3 hover:w-4'"
              :aria-label="$t('agent.conversation.promptPage', { page })"
              :aria-current="page - 1 === homePromptPage ? 'true' : undefined"
              @click="homePromptPage = page - 1"
            >
              <span
                class="mx-auto block h-1.5 rounded-full transition-all duration-300"
                :class="
                  page - 1 === homePromptPage
                    ? 'w-4 bg-primary/70 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-primary)_12%,transparent)]'
                    : 'w-1.5 bg-text-secondary/30 ring-1 ring-inset ring-text-secondary/10 hover:bg-text-secondary/45'
                "
              ></span>
            </button>
          </div>
        </div>
        <div v-for="item in visibleEntries" :key="item.id" :class="entrySpacingClass(item)">
          <ConversationMessage
            :entry="item"
            :related-tool-name="relatedToolName(item)"
            @layout-change="handleDisclosureLayoutChange"
          />
        </div>
        <div v-if="streamingText" class="mx-auto mb-4 flex w-full max-w-3xl gap-3">
          <div
            class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs text-primary"
          >
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
          </div>
          <div class="min-w-0 flex-1 px-1 py-1 text-sm leading-6">
            <div class="mb-1 flex items-center gap-2 text-xs font-semibold text-text-secondary">
              <span>{{ $t('agent.conversation.streaming') }}</span>
              <span class="flex gap-0.5" aria-hidden="true"><span>·</span><span>·</span><span>·</span></span>
            </div>
            <AgentMessageBody :text="streamingText" />
          </div>
        </div>
        <div
          v-if="inputRequest"
          class="mx-auto mb-5 w-full max-w-3xl rounded-2xl border border-primary/25 bg-primary/[0.035] p-3 shadow-sm"
          role="status"
          aria-live="polite"
        >
          <div class="flex items-start gap-2.5">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <i class="fa-solid fa-circle-question text-[10px]" aria-hidden="true"></i>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold text-foreground">{{ $t('agent.conversation.clarificationTitle') }}</div>
              <div class="mt-0.5 text-[11px] leading-4 text-text-secondary/80">
                {{ $t('agent.conversation.clarificationHint') }}
              </div>
            </div>
          </div>
          <div class="mt-3 space-y-2.5">
            <div
              v-for="question in inputRequest.questions"
              :key="question.id"
              class="rounded-xl border border-border/65 bg-card/70 px-3 py-2.5"
            >
              <div class="text-xs font-medium leading-5 text-foreground">{{ question.prompt }}</div>
              <div v-if="question.context" class="mt-0.5 text-[11px] leading-4 text-text-secondary/70">
                {{ question.context }}
              </div>
              <div v-if="question.kind === 'choice' && question.choices?.length" class="mt-2 flex flex-wrap gap-1.5">
                <button
                  v-for="choice in question.choices"
                  :key="choice.value"
                  type="button"
                  class="rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors hover:border-primary/45 hover:bg-primary/[0.06]"
                  :class="
                    choice.value === question.recommendedChoice
                      ? 'border-primary/35 bg-primary/[0.045] text-foreground'
                      : 'border-border/70 bg-background/55 text-text-secondary'
                  "
                  :disabled="busy"
                  @click="applyInputChoice(question.id, choice.value)"
                >
                  <span class="font-medium">{{ choice.label }}</span>
                  <span
                    v-if="choice.value === question.recommendedChoice"
                    class="ml-1 text-[11px] font-semibold uppercase tracking-wide text-primary"
                  >
                    {{ $t('agent.conversation.clarificationRecommended') }}
                  </span>
                  <span v-if="choice.description" class="mt-0.5 block max-w-sm text-[11px] leading-4 opacity-75">
                    {{ choice.description }}
                  </span>
                </button>
              </div>
              <div v-else class="mt-1 text-[11px] text-text-secondary/65">
                {{ $t('agent.conversation.clarificationTextHint') }}
              </div>
            </div>
          </div>
        </div>
        <slot name="approvals" />
        <div
          v-if="terminalRunNotice"
          class="mx-auto mb-4 flex w-full max-w-3xl items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs leading-5"
          :class="terminalRunNotice.className"
          :role="run?.status === 'cancelled' ? 'status' : 'alert'"
          aria-live="polite"
        >
          <i class="fa-solid mt-0.5 shrink-0" :class="terminalRunNotice.icon" aria-hidden="true"></i>
          <div class="min-w-0">
            <div class="font-semibold">{{ $t(terminalRunNotice.titleKey) }}</div>
            <div class="mt-0.5 text-[11px] text-current/80">{{ $t(terminalRunNotice.hintKey) }}</div>
            <div v-if="terminalIssueDetail" class="mt-1 break-words text-[11px] font-medium text-current/95">
              {{ terminalIssueDetail }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer class="agent-composer-footer relative z-10 shrink-0 bg-background/90 backdrop-blur-xs px-4 pb-4 pt-2">
      <div class="mx-auto max-w-3xl">
        <div
          v-if="error || reconciliation"
          class="mb-2 rounded-xl border px-3 py-2 text-xs leading-5"
          :class="
            reconciliation ? 'border-warning/40 bg-warning/5 text-warning' : 'border-error/30 bg-error/5 text-error'
          "
          role="alert"
        >
          <div class="flex items-start gap-2">
            <i class="fa-solid fa-circle-exclamation mt-1" aria-hidden="true"></i>
            <span class="min-w-0 flex-1 break-words">{{
              reconciliation ? $t('agent.operations.reconciliationRequired') : error
            }}</span>
            <button v-if="!reconciliation" type="button" :aria-label="$t('common.close')" @click="emit('dismissError')">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
          <div v-if="reconciliation" class="mt-2 border-t border-warning/20 pt-2 text-foreground">
            <div v-if="reconciliationDetails?.resources.length" class="mb-2 space-y-1">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                {{ $t('agent.operations.reconciliationResources') }}
              </div>
              <div
                v-for="resource in reconciliationDetails.resources"
                :key="`${resource.resourceKey}:${resource.version}`"
                class="rounded-lg border border-warning/20 bg-background/60 px-2.5 py-1.5"
              >
                <div class="font-mono text-[11px] font-semibold text-foreground">{{ resource.resourceKey }}</div>
                <div class="mt-0.5 text-[11px] leading-4 text-text-secondary">
                  {{ reconciliationResourceReason(resource.reason) }}
                </div>
              </div>
            </div>
            <div v-else class="mb-2 text-[11px] text-text-secondary">
              {{ $t('agent.operations.reconciliationLoading') }}
            </div>
            <textarea
              v-model="reconciliationNote"
              rows="2"
              class="w-full resize-none rounded-lg border border-border/70 bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:border-warning/60"
              :placeholder="$t('agent.operations.reconciliationNotePlaceholder')"
              :disabled="reconciliationBusy || !reconciliationDetails?.required"
            ></textarea>
            <div class="mt-2 flex items-center justify-between gap-3">
              <span class="text-[11px] leading-4 text-text-secondary">
                {{ $t('agent.operations.reconciliationHint') }}
              </span>
              <button
                type="button"
                class="shrink-0 rounded-lg bg-warning px-3 py-1.5 text-[11px] font-semibold text-warning-foreground disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="reconciliationBusy || !reconciliationDetails?.required || !reconciliationNote.trim()"
                @click="emit('resolveReconciliation', reconciliationNote.trim())"
              >
                <i
                  class="fa-solid mr-1"
                  :class="reconciliationBusy ? 'fa-circle-notch fa-spin' : 'fa-shield-check'"
                  aria-hidden="true"
                ></i>
                {{ $t('agent.operations.reconciliationConfirm') }}
              </button>
            </div>
          </div>
        </div>
        <div
          v-if="commandResult"
          class="mb-2 rounded-xl border px-3 py-2.5 text-xs shadow-sm"
          :class="
            commandResult.tone === 'error'
              ? 'border-error/30 bg-error/5 text-error'
              : 'border-primary/20 bg-primary/5 text-foreground'
          "
          :role="commandResult.tone === 'error' ? 'alert' : 'status'"
          :aria-label="$t('agent.conversation.commands.resultLabel')"
          aria-live="polite"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <strong class="block font-semibold">{{ commandResult.title }}</strong>
              <div v-for="(line, index) in commandResult.lines" :key="index" class="mt-1 break-words leading-4">
                {{ line }}
              </div>
            </div>
            <button
              type="button"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-header hover:text-foreground"
              :aria-label="$t('agent.conversation.commands.dismiss')"
              @click="emit('dismissCommandResult')"
            >
              <i class="fa-solid fa-xmark text-[9px]" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div
          v-if="commandSuggestions.length"
          class="mb-2 overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm"
          role="listbox"
          :aria-label="$t('agent.conversation.commands.suggestionsLabel')"
        >
          <button
            v-for="suggestion in commandSuggestions"
            :key="suggestion.command"
            type="button"
            class="flex w-full items-center gap-3 border-b border-border/40 px-3 py-2 text-left last:border-b-0 hover:bg-header/70"
            @click="applyCommandSuggestion(suggestion)"
          >
            <code class="shrink-0 text-xs font-semibold text-primary">{{ suggestion.usage }}</code>
            <span class="truncate text-xs text-text-secondary">{{ $t(suggestion.descriptionKey) }}</span>
          </button>
        </div>

        <div v-if="attachments.length" class="mb-2 flex flex-wrap gap-1.5">
          <button
            v-for="artifact in attachments"
            :key="artifact.id"
            type="button"
            class="max-w-56 truncate rounded-full bg-background/80 px-3 py-1.5 text-xs hover:bg-header"
            :title="artifact.originalName"
            @click="
              emit(
                'updateAttachments',
                attachments.filter((item) => item.id !== artifact.id),
              )
            "
          >
            <i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>{{ artifact.originalName }}
            <span class="ml-1 opacity-60">×</span>
          </button>
        </div>

        <div class="agent-composer-status mb-1.5 flex min-h-7 items-center justify-between gap-2">
          <span
            v-if="showRunTokens"
            class="agent-token-status inline-flex h-6 items-center gap-1.5 rounded-lg border border-border/55 bg-background/50 px-2 text-[11px] text-text-secondary select-none"
            :title="`${$t('agent.tasks.totalTokens')}: ${totalRunTokens} · input ${run?.usage.inputTokens} · output ${run?.usage.outputTokens} · cache ${runCacheRate}% · steps ${run?.usage.steps}`"
          >
            <i class="fa-solid fa-chart-simple text-[8px] text-text-secondary/70" aria-hidden="true"></i>
            <strong class="font-mono font-medium text-foreground/80">{{ formatTokens(totalRunTokens) }}</strong>
          </span>
          <span
            v-else
            class="agent-composer-hint min-w-0 truncate text-[11px] leading-none text-text-secondary/65 select-none"
          >
            <i class="fa-regular fa-keyboard mr-1 text-[9px] opacity-80" aria-hidden="true"></i
            >{{ $t('agent.conversation.sendHint') }}<span class="px-1 text-text-secondary/40">·</span
            >{{ $t('agent.conversation.sendHintNewline') }}
          </span>
          <button
            v-if="showJumpToLatest"
            type="button"
            class="agent-jump-latest inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-2.5 text-[11px] text-text-secondary shadow-xs backdrop-blur-md transition-colors hover:bg-header hover:text-foreground"
            :title="$t('agent.ui.latest')"
            :aria-label="$t('agent.ui.latest')"
            @click="scrollToBottom"
          >
            <i class="fa-solid fa-arrow-down text-[9px]" aria-hidden="true"></i>
            <span class="agent-jump-latest-label">{{ $t('agent.ui.latest') }}</span>
          </button>
        </div>

        <div
          class="agent-composer-shell rounded-xl border border-border/65 bg-card/88 backdrop-blur-md shadow-sm transition-all duration-200 hover:border-border-hover focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/15 overflow-hidden"
        >
          <textarea
            id="agent-composer"
            :aria-label="$t('agent.conversation.placeholder')"
            :value="draft"
            rows="3"
            class="max-h-48 min-h-24 w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[13px] leading-relaxed text-foreground placeholder:text-text-secondary/50 outline-none"
            :placeholder="$t('agent.conversation.placeholder')"
            @input="emit('updateDraft', ($event.target as HTMLTextAreaElement).value)"
            @keydown.enter.exact="onComposerEnter"
          ></textarea>
          <div
            class="agent-composer-toolbar flex min-h-10 flex-nowrap items-center justify-between gap-1.5 border-t border-border/35 bg-header/25 backdrop-blur-xs px-2 py-1"
          >
            <div class="agent-toolbar-controls flex min-w-0 flex-1 flex-nowrap items-center gap-1">
              <slot name="configuration" />
            </div>
            <div class="agent-composer-actions flex shrink-0 items-center gap-1.5">
              <ArtifactPicker
                :app-id="appId"
                :model-value="attachments"
                :disabled="busy"
                compact
                @update:model-value="emit('updateAttachments', $event)"
              />
              <button
                v-if="activeRun"
                type="button"
                class="agent-stop-button flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-error/45 bg-error/10 text-[11px] font-semibold text-error transition-all hover:bg-error/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                :aria-label="$t('agent.conversation.cancelRun')"
                :title="$t('agent.conversation.cancelRun')"
                :disabled="stopDisabled"
                @click="stopRun"
              >
                <i
                  class="fa-solid text-[10px] text-error"
                  :class="cancelling ? 'fa-circle-notch fa-spin' : 'fa-stop'"
                  aria-hidden="true"
                ></i>
              </button>
              <button
                type="button"
                class="agent-send-button flex h-7 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-white shadow-xs transition-all hover:bg-primary-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-20 disabled:bg-foreground/15 disabled:text-text-secondary disabled:shadow-none"
                :aria-label="$t('agent.conversation.send')"
                :title="$t('agent.conversation.send')"
                :disabled="sendDisabled"
                @click="send"
              >
                <span class="agent-send-label">{{ $t('agent.conversation.send') }}</span>
                <i class="fa-solid fa-arrow-up text-xs" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
  .agent-conversation-ambient {
    background: radial-gradient(
      circle at 50% 30%,
      color-mix(in srgb, var(--color-primary) 10%, transparent) 0%,
      color-mix(in srgb, var(--color-primary) 2%, transparent) 40%,
      transparent 70%
    );
  }

  #agent-composer {
    font-size: 13px;
  }

  .agent-send-button {
    font-size: 11px;
    line-height: 1;
  }

  /*
   * global.css 里 `i, .fas, .far, .fab { color: var(--icon-color) }` 是未分层规则，
   * 图标默认不会继承按钮文字色；停止按钮必须在常态与 hover 下都保持错误色。
   */
  .agent-stop-button i,
  .agent-stop-button:hover i {
    color: var(--color-error);
  }

  /*
   * The composer shell is capped at max-w-3xl (768px), so it — not the much
   * wider conversation pane — is the real width constraint for the toolbar.
   */
  .agent-composer-shell {
    container-type: inline-size;
    container-name: agent-composer;
  }

  @container agent-conversation-pane (max-width: 700px) {
    .agent-conversation-scroller {
      padding-inline: 14px;
    }

    .agent-composer-footer {
      padding: 6px 10px 10px;
    }

    .agent-budget-meter {
      gap: 0;
      font-size: 11px;
    }

    .agent-budget-bar {
      display: none;
    }
  }

  @container agent-conversation-pane (max-width: 560px) {
    .agent-conversation-scroller {
      padding-inline: 10px;
    }

    .agent-composer-footer {
      padding: 5px 8px 8px;
    }
  }

  /*
   * Composer density tiers. Driven by the composer width (never by the window),
   * so compacting always happens before the single-line toolbar can overflow.
   */
  @container agent-composer (max-width: 730px) {
    .agent-composer-toolbar {
      min-height: 36px;
      gap: 4px;
      padding: 4px 6px;
    }

    .agent-toolbar-controls {
      gap: 3px;
    }
  }

  @container agent-composer (max-width: 620px) {
    .agent-composer-status {
      gap: 4px;
    }

    .agent-jump-latest {
      padding-inline: 6px;
    }

    .agent-send-button {
      width: 28px;
      height: 28px;
      padding-inline: 0;
      justify-content: center;
    }

    .agent-send-label {
      display: none;
    }
  }

  @container agent-composer (max-width: 520px) {
    .agent-composer-shell {
      border-radius: 12px;
    }

    #agent-composer {
      min-height: 72px;
      padding: 10px 12px 6px;
      font-size: 12px;
      line-height: 1.55;
    }

    .agent-jump-latest-label {
      display: none;
    }
  }

  #agent-composer,
  #agent-composer:focus,
  #agent-composer:focus-visible {
    border: 0 !important;
    border-color: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  }
</style>
