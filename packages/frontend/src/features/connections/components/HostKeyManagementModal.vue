<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiEmptyState,
		UiFormField,
		UiInfoHint,
		UiInput,
		UiModal,
		UiSpinner,
	} from '@/foundation/ui';
	import { useHostKeyManagement } from '../composables/use-host-key-management';
	const props = defineProps<{ visible: boolean }>();
	const emit = defineEmits<{ close: [] }>();
	const { t, locale } = useI18n();
	const { items, draft, loading, needsRefresh, canWrite, refresh, confirm, remove } = useHostKeyManagement(
		props,
		() => emit('close'),
	);
	const dateTimeFormatter = computed(
		() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
	);

	function formatConfirmedAt(value: number): string {
		return dateTimeFormatter.value.format(value);
	}
</script>
<template>
	<UiModal
		:visible="visible"
		:aria-label="t('hostKeys.title')"
		:close-on-backdrop="false"
		panel-class="ui-form-surface !w-[calc(100vw-2rem)] !max-w-4xl !p-0"
		:panel-style="{ height: 'min(760px, calc(100dvh - 2rem))', maxHeight: 'calc(100dvh - 2rem)' }"
		content-class="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !py-0"
		@close="emit('close')"
	>
		<div class="host-keys">
			<header class="host-keys__header">
				<span class="host-keys__mark" aria-hidden="true">
					<i class="fa-solid fa-shield-halved"></i>
				</span>
				<div class="host-keys__heading">
					<h2 class="host-keys__title">{{ t('hostKeys.title') }}</h2>
					<UiInfoHint
						:label="t('hostKeys.warning')"
						:text="t('hostKeys.warning')"
						side="bottom"
						align="start"
						class="shrink-0"
					/>
				</div>
			</header>

			<div class="host-keys__body">
				<div v-if="!loading && needsRefresh" class="flex justify-end">
					<UiButton density="compact" :disabled="loading" @click="refresh">{{
						t('hostKeys.refresh')
					}}</UiButton>
				</div>

				<section class="host-keys__section" aria-labelledby="trusted-host-keys-title">
					<div class="host-keys__section-heading">
						<h3 id="trusted-host-keys-title">
							<i class="fa-solid fa-key" aria-hidden="true"></i>{{ t('hostKeys.trustedKeys') }}
						</h3>
						<UiBadge tone="primary" appearance="ghost" density="compact">{{ items.length }}</UiBadge>
						<UiSpinner v-if="loading" density="compact" :label="t('common.loading')" />
					</div>

					<div v-if="loading && items.length === 0" class="host-keys__loading">
						<UiSpinner />
						<span>{{ t('common.loading') }}</span>
					</div>
					<UiEmptyState
						v-else-if="items.length === 0"
						dense
						:bordered="false"
						icon="fa-solid fa-key"
						:title="t('hostKeys.empty')"
					/>
					<ul v-else class="host-keys__list">
						<li v-for="item in items" :key="JSON.stringify([item.host, item.port])" class="host-keys__item">
							<div class="host-keys__item-body">
								<code class="host-keys__address">
									<span>{{ item.host }}</span
									><span class="host-keys__port">:{{ item.port }}</span>
								</code>
								<code class="host-keys__fingerprint">{{ item.fingerprint }}</code>
								<p class="host-keys__time">
									<i class="fa-regular fa-clock" aria-hidden="true"></i>
									<span>{{ t('hostKeys.confirmedAt') }}</span>
									<span aria-hidden="true">·</span>
									<time :datetime="new Date(item.confirmedAt).toISOString()">{{
										formatConfirmedAt(item.confirmedAt)
									}}</time>
								</p>
							</div>
							<UiButton
								class="host-keys__remove"
								appearance="soft"
								tone="danger"
								density="compact"
								:disabled="!canWrite"
								@click="remove(item)"
							>
								<template #leading><i class="fa-regular fa-trash-can" aria-hidden="true"></i></template>
								{{ t('hostKeys.remove') }}
							</UiButton>
						</li>
					</ul>
				</section>

				<section class="host-keys__section host-keys__form-section" aria-labelledby="add-host-key-title">
					<div class="host-keys__section-heading">
						<h3 id="add-host-key-title">
							<i class="fa-solid fa-plus" aria-hidden="true"></i>{{ t('hostKeys.manualTrust') }}
						</h3>
					</div>
					<form class="host-keys__form" @submit.prevent="confirm">
						<div class="host-keys__form-grid">
							<UiFormField :label="t('hostKeys.host')" for-id="host-key-host">
								<UiInput
									id="host-key-host"
									v-model="draft.host"
									:disabled="!canWrite"
									autocomplete="off"
									spellcheck="false"
									required
								/>
							</UiFormField>
							<UiFormField :label="t('hostKeys.port')" for-id="host-key-port">
								<UiInput
									id="host-key-port"
									v-model="draft.port"
									:disabled="!canWrite"
									inputmode="numeric"
									autocomplete="off"
									required
								/>
							</UiFormField>
						</div>
						<div class="host-keys__fingerprint-row">
							<UiFormField
								class="host-keys__fingerprint-field"
								:label="t('hostKeys.fingerprint')"
								for-id="host-key-fingerprint"
							>
								<UiInput
									id="host-key-fingerprint"
									v-model="draft.fingerprint"
									class="host-keys__fingerprint-input"
									:disabled="!canWrite"
									autocomplete="off"
									spellcheck="false"
									placeholder="SHA256:…"
									required
								/>
							</UiFormField>
							<UiButton
								class="host-keys__confirm"
								type="submit"
								appearance="solid"
								tone="primary"
								:disabled="!canWrite"
							>
								{{ t('hostKeys.confirm') }}
							</UiButton>
						</div>
					</form>
				</section>
			</div>

			<footer class="host-keys__footer">
				<UiButton @click="emit('close')">{{ t('common.close') }}</UiButton>
			</footer>
		</div>
	</UiModal>
</template>

<style scoped>
	.host-keys {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
	}

	.host-keys__header {
		display: flex;
		flex: none;
		align-items: center;
		gap: 12px;
		padding: 18px 22px 16px;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	.host-keys__mark {
		display: inline-flex;
		width: 36px;
		height: 36px;
		flex: none;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--link-active-color) 22%, var(--glass-border-color));
		border-radius: 11px;
		background: linear-gradient(
			145deg,
			color-mix(in srgb, var(--link-active-color) 15%, transparent),
			color-mix(in srgb, var(--card-bg-color) 32%, transparent)
		);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-rim) 16%, transparent);
		color: var(--link-active-color);
		font-size: 15px;
	}

	.host-keys__heading {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 7px;
	}

	.host-keys__title {
		margin: 0;
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.01em;
		line-height: 1.3;
	}

	.host-keys__body {
		min-height: 0;
		flex: 1;
		padding: 18px 22px 22px;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}

	.host-keys__notice {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-top: 12px;
		padding: 9px 11px;
		border: 1px solid color-mix(in srgb, var(--link-active-color) 18%, var(--glass-border-color));
		border-radius: 10px;
		background: color-mix(in srgb, var(--link-active-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 12px;
		line-height: 1.5;
	}

	.host-keys__notice--warning {
		border-color: color-mix(in srgb, var(--status-warning-color) 24%, var(--glass-border-color));
		background: color-mix(in srgb, var(--status-warning-color) 7%, transparent);
		color: color-mix(in srgb, var(--status-warning-color) 72%, var(--text-color));
	}

	.host-keys__notice > i {
		flex: none;
	}

	.host-keys__section {
		margin-top: 20px;
	}

	.host-keys__section-heading {
		display: flex;
		min-height: 22px;
		align-items: center;
		gap: 7px;
		margin-bottom: 9px;
	}

	.host-keys__section-heading h3 {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0;
		color: var(--text-color);
		font-size: 13px;
		font-weight: 620;
	}

	.host-keys__section-heading h3 > i {
		color: var(--text-color-secondary);
		font-size: 10px;
		opacity: 0.8;
	}

	.host-keys__loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		padding: 26px 12px;
		color: var(--text-color-secondary);
		font-size: 12px;
	}

	.host-keys__list {
		overflow: hidden;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ui-hairline);
		border-radius: 14px;
		background: color-mix(in srgb, var(--card-bg-color) 24%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-rim) 7%, transparent);
		list-style: none;
	}

	.host-keys__item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 13px 14px;
	}

	.host-keys__item + .host-keys__item {
		border-top: 1px solid color-mix(in srgb, var(--border-color) 30%, transparent);
	}

	.host-keys__item-body {
		min-width: 0;
		flex: 1;
	}

	.host-keys__address {
		display: block;
		overflow-wrap: anywhere;
		color: var(--text-color);
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 13px;
		font-weight: 620;
		letter-spacing: -0.01em;
		line-height: 1.4;
	}

	.host-keys__port {
		color: var(--text-color-secondary);
		font-weight: 500;
	}

	.host-keys__fingerprint {
		display: block;
		margin-top: 5px;
		overflow-wrap: anywhere;
		color: var(--text-color-secondary);
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 11px;
		line-height: 1.5;
		user-select: text;
	}

	.host-keys__time {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-top: 6px;
		color: color-mix(in srgb, var(--text-color-secondary) 82%, transparent);
		font-size: 10.5px;
		line-height: 1.4;
	}

	.host-keys__time > i {
		font-size: 9px;
		opacity: 0.78;
	}

	.host-keys__remove {
		flex: none;
	}

	.host-keys__form-section {
		padding-top: 18px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	.host-keys__form-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 112px;
		gap: 12px;
	}

	.host-keys__fingerprint-row {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		margin-top: 12px;
	}

	.host-keys__fingerprint-field {
		min-width: 0;
		flex: 1;
	}

	.host-keys__fingerprint-input :deep(input) {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 11.5px;
	}

	.host-keys__confirm {
		flex: none;
	}

	.host-keys__footer {
		display: flex;
		flex: none;
		justify-content: flex-end;
		gap: 8px;
		padding: 13px 22px calc(13px + env(safe-area-inset-bottom, 0px));
		border-top: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	@media (max-width: 640px) {
		.host-keys__header {
			padding: 14px 16px 12px;
		}

		.host-keys__mark {
			width: 34px;
			height: 34px;
		}

		.host-keys__body {
			padding: 14px 16px 18px;
		}

		.host-keys__item {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
			padding: 12px;
		}

		.host-keys__remove {
			align-self: flex-end;
		}

		.host-keys__form-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.host-keys__fingerprint-row {
			gap: 8px;
		}

		.host-keys__footer {
			padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
