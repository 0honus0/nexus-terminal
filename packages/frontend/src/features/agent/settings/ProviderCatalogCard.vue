<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton } from '@/foundation/ui';
	import type { Provider } from '../model/provider-types';

	defineProps<{ provider: Provider; disabled: boolean; copiedUrl: string | null }>();
	const emit = defineEmits<{
		copyUrl: [baseUrl: string];
		setEnabled: [enabled: boolean];
		test: [];
		edit: [];
		delete: [];
	}>();
	const { t } = useI18n();
</script>

<template>
	<article
		class="group overflow-hidden rounded-2xl border border-border/80 bg-card/80 shadow-2xs transition-all hover:border-primary/45 hover:bg-card/95"
	>
		<div class="provider-card-main flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
			<div class="flex min-w-0 flex-1 items-start gap-3.5">
				<div
					class="provider-card-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/10 to-transparent text-primary shadow-xs"
				>
					<i class="fa-solid fa-server text-lg" aria-hidden="true"></i>
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<h4 class="ui-catalog-name text-sm font-bold tracking-tight text-foreground">
							{{ provider.name }}
						</h4>
						<UiBadge
							class="ui-catalog-status-badge"
							:tone="provider.enabled ? 'success' : 'neutral'"
							density="compact"
							dot
						>
							{{
								t(
									provider.enabled
										? 'agent.settings.providerManagement.enabled'
										: 'agent.settings.providerManagement.disabled',
								)
							}}
						</UiBadge>
						<UiBadge appearance="ghost" density="compact"
							><i class="fa-solid fa-key text-[9px] text-primary/75" aria-hidden="true"></i
							>{{
								t(
									provider.hasCredential
										? 'agent.settings.providers.credentialStored'
										: 'agent.settings.providers.noCredential',
								)
							}}</UiBadge
						>
					</div>
					<button
						type="button"
						class="group/url mt-1.5 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-left text-xs text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
						:title="
							copiedUrl === provider.baseUrl
								? t('agent.settings.providers.copyUrlSuccess')
								: provider.baseUrl + ' · ' + t('agent.settings.providers.copyUrl')
						"
						:aria-label="t('agent.settings.providers.copyUrl')"
						@click="emit('copyUrl', provider.baseUrl)"
					>
						<i
							class="fa-solid fa-link shrink-0 text-[9px] text-text-secondary/60 group-hover/url:text-primary"
							aria-hidden="true"
						></i>
						<span class="truncate font-mono">{{ provider.baseUrl }}</span>
						<i
							:class="
								copiedUrl === provider.baseUrl
									? 'fa-solid fa-check text-success'
									: 'fa-regular fa-copy text-text-secondary/45 group-hover/url:text-primary'
							"
							class="shrink-0 text-[10px]"
							aria-hidden="true"
						></i>
					</button>
				</div>
			</div>
			<div class="provider-card-actions flex shrink-0 flex-wrap items-center justify-between gap-1.5">
				<UiButton
					type="button"
					appearance="soft"
					:icon-only="true"
					:tone="provider.enabled ? 'danger' : 'success'"
					:disabled="disabled"
					:title="
						provider.enabled ? t('agent.settings.providers.disable') : t('agent.settings.providers.enable')
					"
					:aria-label="
						provider.enabled ? t('agent.settings.providers.disable') : t('agent.settings.providers.enable')
					"
					@click="emit('setEnabled', !provider.enabled)"
				>
					<i
						:class="provider.enabled ? 'fa-solid fa-power-off' : 'fa-solid fa-play'"
						class="text-xs"
						aria-hidden="true"
					></i>
				</UiButton>
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					class="provider-test-button"
					:title="t('agent.settings.providers.testModalBtn', { count: provider.models.length })"
					:aria-label="t('agent.settings.providers.testModalBtn', { count: provider.models.length })"
					:disabled="disabled"
					@click="emit('test')"
				>
					<i class="fa-solid fa-vial text-[10px]" aria-hidden="true"></i>
					<span class="provider-test-label">{{
						t('agent.settings.providers.testModalBtn', { count: provider.models.length })
					}}</span>
				</UiButton>
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					class="provider-edit-button"
					:disabled="disabled"
					:title="t('common.edit')"
					:aria-label="t('common.edit')"
					@click="emit('edit')"
				>
					<i class="fa-solid fa-pen text-xs" aria-hidden="true"></i>
					<span class="provider-edit-label">{{ t('common.edit') }}</span>
				</UiButton>
				<UiButton
					type="button"
					appearance="ghost"
					tone="danger"
					icon-only
					:disabled="disabled"
					:title="t('common.delete')"
					:aria-label="t('common.delete')"
					@click="emit('delete')"
				>
					<i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
				</UiButton>
			</div>
		</div>
		<details class="group border-t border-border/45 bg-header/15 text-[11px] text-text-secondary">
			<summary
				class="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-medium transition-colors hover:text-foreground sm:px-5 [&::-webkit-details-marker]:hidden"
			>
				<i class="fa-solid fa-layer-group text-[10px] text-text-secondary/65" aria-hidden="true"></i>
				<span>{{ t('agent.settings.providers.configuredModels') }}</span>
				<UiBadge appearance="ghost" density="compact" class="font-mono">{{ provider.models.length }}</UiBadge>
				<i
					class="fa-solid fa-chevron-down ml-auto text-[9px] transition-transform group-open:rotate-180"
					aria-hidden="true"
				></i>
			</summary>
			<div class="flex flex-wrap items-center gap-1.5 px-4 pb-3 sm:px-5">
				<span
					v-for="model in provider.models"
					:key="model.id"
					class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] shadow-2xs"
				>
					<span class="provider-model-id min-w-0 font-mono text-foreground">{{ model.id }}</span>
					<span class="shrink-0 font-mono text-[10px] text-text-secondary">{{
						t('agent.settings.providers.contextShort', { value: model.contextWindow ?? '—' })
					}}</span>
				</span>
				<span v-if="!provider.models.length">{{ t('agent.settings.providers.empty') }}</span>
			</div>
		</details>
	</article>
</template>

<style scoped>
	.provider-model-id {
		overflow-wrap: anywhere;
		user-select: text;
		-webkit-user-select: text;
	}

	.provider-card-main {
		container: provider-card / inline-size;
	}

	.provider-card-actions :deep(.ui-button:disabled) {
		border-color: transparent;
		background: transparent;
		color: var(--ui-text-muted);
		box-shadow: none;
		opacity: 0.45;
	}

	.provider-edit-label {
		display: none;
	}

	/* 设置页在 lg 以下切换为窄版布局，提供商卡片此时不再占用图标列。 */
	@media (max-width: 1023px) {
		.provider-card-icon {
			display: none;
		}
	}

	@container provider-card (max-width: 320px) {
		.provider-test-label {
			display: none;
		}

		.provider-test-button {
			width: var(--ui-control-height);
			padding-inline: 0;
		}
	}

	@container provider-card (min-width: 440px) {
		.provider-edit-label {
			display: inline;
		}
	}
</style>
