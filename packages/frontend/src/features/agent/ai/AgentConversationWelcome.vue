<script setup lang="ts">
	import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
	const props = defineProps<{ active: boolean; draft: string }>();
	const emit = defineEmits<{ select: [text: string] }>();
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

	const homePromptToneClasses: Record<HomePromptTone, { card: string; icon: string; title: string; arrow: string }> =
		{
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
	// 便当卡自动轮播必须"让位"给用户：指针悬停 / 键盘焦点在卡片区、用户自己点过分页、
	// 或系统声明 prefers-reduced-motion 时都不再自动翻页。
	const homePromptPaused = ref(false);
	const homePromptPinned = ref(false);
	const reducedMotionQuery =
		typeof window !== 'undefined' && typeof window.matchMedia === 'function'
			? window.matchMedia('(prefers-reduced-motion: reduce)')
			: null;
	const homePromptReducedMotion = ref(reducedMotionQuery?.matches ?? false);

	const onReducedMotionChange = (event: MediaQueryListEvent): void => {
		homePromptReducedMotion.value = event.matches;
	};

	onMounted(() => {
		reducedMotionQuery?.addEventListener('change', onReducedMotionChange);
		homePromptTimer = window.setInterval(() => {
			if (!props.active || props.draft.trim()) return;
			if (homePromptPaused.value || homePromptPinned.value || homePromptReducedMotion.value) return;
			homePromptPage.value = (homePromptPage.value + 1) % homePromptPageCount;
		}, HOME_PROMPT_ROTATE_MS);
	});
	onBeforeUnmount(() => {
		if (homePromptTimer !== null) window.clearInterval(homePromptTimer);
		reducedMotionQuery?.removeEventListener('change', onReducedMotionChange);
	});

	const selectHomePromptPage = (page: number): void => {
		homePromptPinned.value = true;
		homePromptPage.value = page;
	};
</script>
<template>
	<div
		class="relative z-10 mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-4 py-4 text-center select-none"
		@mouseenter="homePromptPaused = true"
		@mouseleave="homePromptPaused = false"
		@focusin="homePromptPaused = true"
		@focusout="homePromptPaused = false"
	>
		<!-- 顶端微胶囊标识 -->
		<div
			class="mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3.5 py-0.5 text-[11px] font-semibold tracking-wider text-primary shadow-2xs"
		>
			<span class="agent-home-pulse h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></span>
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
				class="agent-home-prompt group relative flex items-center rounded-2xl border border-border/75 p-3.5 text-left shadow-sm backdrop-blur-xs transition-colors duration-200"
				:class="homePromptToneClasses[prompt.tone].card"
				@click="emit('select', $t(prompt.promptKey))"
			>
				<div class="flex min-w-0 items-center gap-3.5 w-full">
					<span
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-2xs transition-colors"
						:class="homePromptToneClasses[prompt.tone].icon"
					>
						<i class="fa-solid text-sm" :class="prompt.icon" aria-hidden="true"></i>
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex items-center justify-between">
							<span
								class="min-w-0 truncate text-[13px] font-bold tracking-tight text-foreground transition-colors"
								:class="homePromptToneClasses[prompt.tone].title"
							>
								{{ $t(prompt.titleKey) }}
							</span>
							<span
								class="text-xs text-text-secondary/40 transition-colors"
								:class="homePromptToneClasses[prompt.tone].arrow"
								aria-hidden="true"
								>↗</span
							>
						</div>
						<p
							class="mt-1 truncate text-xs leading-relaxed text-text-secondary/75"
							:title="$t(prompt.descriptionKey)"
						>
							{{ $t(prompt.descriptionKey) }}
						</p>
					</div>
				</div>
			</button>
		</div>
		<div class="mt-3 flex items-center justify-center gap-4">
			<button
				v-for="page in homePromptPageCount"
				:key="page"
				type="button"
				class="agent-home-pager-dot flex h-6 w-6 items-center justify-center rounded-full px-0 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
				:aria-label="$t('agent.conversation.promptPage', { page })"
				:aria-current="page - 1 === homePromptPage ? 'true' : undefined"
				@click="selectHomePromptPage(page - 1)"
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
</template>
