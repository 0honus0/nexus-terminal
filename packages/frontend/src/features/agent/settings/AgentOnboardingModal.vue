<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiModal } from '@/foundation/ui';
	import type { PluginCatalogEntry } from '../model/plugin-types';

	const props = defineProps<{
		visible: boolean;
		entry: PluginCatalogEntry;
		busy: boolean;
		confirmDisabled: boolean;
		notice: string;
		needsRead: boolean;
	}>();
	const emit = defineEmits<{ close: []; confirm: []; read: [] }>();
	const { t } = useI18n();
	const showKeyDetails = ref(false);
	const copiedKey = ref(false);
	const compactKeyId = computed(() =>
		props.entry.publisherKeyId.length <= 24
			? props.entry.publisherKeyId
			: props.entry.publisherKeyId.slice(0, 16) + '...' + props.entry.publisherKeyId.slice(-8),
	);
	const pluginDescription = computed(() =>
		props.entry.definitionId === 'nexus.agent'
			? t('agent.settings.onboarding.defaultPluginSummary')
			: props.entry.description,
	);

	async function copyKeyId(): Promise<void> {
		try {
			await navigator.clipboard.writeText(props.entry.publisherKeyId);
			copiedKey.value = true;
		} catch {
			copiedKey.value = false;
		}
	}
</script>
<template>
	<UiModal
		:visible="visible"
		:title="$t('agent.settings.onboarding.title')"
		:aria-label="$t('agent.settings.onboarding.title')"
		:close-on-backdrop="!busy"
		:close-on-escape="!busy"
		:focus-on-open="true"
		:restore-focus="true"
		panel-class="max-w-xl p-6 rounded-2xl"
		@close="emit('close')"
	>
		<template #header>
			<div class="flex items-center justify-between w-full pr-6">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent text-primary ring-1 ring-primary/25 shadow-xs"
					>
						<i class="fa-solid fa-wand-magic-sparkles text-base" aria-hidden="true"></i>
					</div>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<h2 class="text-base font-semibold text-foreground tracking-tight">
								{{ $t('agent.settings.onboarding.title') }}
							</h2>
							<span
								class="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-success animate-pulse"></span>
								{{ $t('agent.settings.onboarding.publisherVerified') }}
							</span>
						</div>
						<p class="text-xs text-text-secondary mt-0.5">
							{{ $t('agent.settings.onboarding.subtitle') }}
						</p>
					</div>
				</div>
			</div>
		</template>

		<template v-if="entry">
			<div class="space-y-4">
				<p v-if="notice" role="alert" class="text-sm text-warning">
					{{ t('agent.settings.appManagement.' + notice) }}
				</p>
				<UiButton v-if="needsRead" type="button" :disabled="busy" @click="emit('read')">{{
					t('agent.settings.appManagement.readApps')
				}}</UiButton>
				<!-- 插件基础信息主卡片 -->
				<div class="relative overflow-hidden rounded-lg bg-header/25 p-4 transition-colors">
					<div class="flex items-start gap-3.5">
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shadow-xs"
						>
							<i class="fa-solid fa-robot text-xl" aria-hidden="true"></i>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-bold text-foreground">{{ entry.displayName }}</span>
								<span
									class="rounded-md border border-border/60 bg-card px-2 py-0.5 font-mono text-[11px] font-medium text-foreground"
								>
									v{{ entry.version }}
								</span>
								<span
									class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
								>
									{{ $t('agent.settings.onboarding.badge') }}
								</span>
							</div>
							<p class="mt-1.5 text-xs leading-relaxed text-text-secondary">
								{{ pluginDescription }}
							</p>
						</div>
					</div>
				</div>

				<!-- 3 栏核心特性网格 -->
				<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
					<div class="flex items-start gap-2.5 rounded-lg bg-header/20 p-3">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs"
						>
							<i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>
						</div>
						<div class="min-w-0">
							<div class="text-xs font-semibold text-foreground">
								{{ $t('agent.settings.onboarding.featureSkillsTitle') }}
							</div>
							<div class="text-[11px] text-text-secondary leading-normal mt-0.5">
								{{ $t('agent.settings.onboarding.featureSkillsDesc') }}
							</div>
						</div>
					</div>

					<div class="flex items-start gap-2.5 rounded-lg bg-header/20 p-3">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success text-xs"
						>
							<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
						</div>
						<div class="min-w-0">
							<div class="text-xs font-semibold text-foreground">
								{{ $t('agent.settings.onboarding.featureSandboxTitle') }}
							</div>
							<div class="text-[11px] text-text-secondary leading-normal mt-0.5">
								{{ $t('agent.settings.onboarding.featureSandboxDesc') }}
							</div>
						</div>
					</div>

					<div class="flex items-start gap-2.5 rounded-lg bg-header/20 p-3">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs"
						>
							<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
						</div>
						<div class="min-w-0">
							<div class="text-xs font-semibold text-foreground">
								{{ $t('agent.settings.onboarding.featureDecoupledTitle') }}
							</div>
							<div class="text-[11px] text-text-secondary leading-normal mt-0.5">
								{{ $t('agent.settings.onboarding.featureDecoupledDesc') }}
							</div>
						</div>
					</div>
				</div>

				<!-- 安全凭据与发布者来源（消除裸露长串） -->
				<div class="rounded-lg bg-header/25 p-3 text-xs">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 font-medium text-foreground text-xs">
							<i class="fa-solid fa-certificate text-primary text-sm" aria-hidden="true"></i>
							<span>{{ $t('agent.settings.onboarding.verifiedPublisher') }}</span>
						</div>
						<button
							type="button"
							class="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors cursor-pointer"
							@click="showKeyDetails = !showKeyDetails"
						>
							<span>{{
								showKeyDetails
									? $t('agent.settings.onboarding.hideDetails')
									: $t('agent.settings.onboarding.detailsToggle')
							}}</span>
							<i
								:class="showKeyDetails ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'"
								class="text-[9px]"
							></i>
						</button>
					</div>

					<div
						class="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card px-2.5 py-1.5 font-mono text-[11px] text-text-secondary shadow-2xs"
					>
						<div class="flex items-center gap-1.5 truncate">
							<i class="fa-solid fa-key text-[10px] text-primary/70"></i>
							<span class="truncate">{{ compactKeyId }}</span>
						</div>
						<button
							type="button"
							class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-text-secondary hover:bg-header hover:text-foreground transition-colors cursor-pointer"
							@click="copyKeyId()"
						>
							<i :class="copiedKey ? 'fa-solid fa-check text-success' : 'fa-regular fa-copy'"></i>
							<span>{{
								copiedKey
									? $t('agent.settings.onboarding.keyCopied')
									: $t('agent.settings.onboarding.copyKey')
							}}</span>
						</button>
					</div>

					<div
						v-if="showKeyDetails"
						class="mt-2.5 space-y-2 border-t border-border/50 pt-2.5 text-[11px] text-text-secondary"
					>
						<div>
							<div class="font-medium text-foreground">
								{{ $t('agent.settings.onboarding.fullKeyId') }}
							</div>
							<div
								class="mt-1 break-all font-mono select-all rounded-lg border border-border/40 bg-header/40 p-2 text-foreground/90"
							>
								{{ entry.publisherKeyId }}
							</div>
						</div>
					</div>
				</div>

				<!-- 安装中进度状态（如果 busy 为 true） -->
				<div v-if="busy" class="rounded-xl border border-primary/25 bg-primary/5 p-4 transition-all">
					<div class="flex items-center gap-3">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
						>
							<i class="fa-solid fa-circle-notch fa-spin text-sm"></i>
						</div>
						<div class="min-w-0 flex-1">
							<div class="text-xs font-semibold text-foreground">
								{{ $t('agent.settings.onboarding.installingTitle') }}
							</div>
							<div class="text-[11px] text-text-secondary mt-0.5">
								{{ $t('agent.settings.onboarding.installing') }}
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>

		<template #footer>
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-1.5 text-[11px] text-text-secondary">
					<i class="fa-solid fa-lock text-[10px] text-success"></i>
					<span>{{ $t('agent.settings.onboarding.sandboxProtected') }}</span>
				</div>
				<div class="flex items-center gap-2">
					<UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="emit('close')">
						{{ $t('agent.settings.onboarding.cancel') }}
					</UiButton>
					<UiButton
						appearance="solid"
						tone="primary"
						type="button"
						:disabled="busy || confirmDisabled"
						@click="emit('confirm')"
					>
						<i v-if="!busy" class="fa-solid fa-download text-xs" aria-hidden="true"></i>
						<i v-else class="fa-solid fa-circle-notch fa-spin text-xs" aria-hidden="true"></i>
						<span>{{
							busy
								? $t('agent.settings.onboarding.installing')
								: $t('agent.settings.onboarding.installAndEnable')
						}}</span>
					</UiButton>
				</div>
			</div>
		</template>
	</UiModal>
</template>
