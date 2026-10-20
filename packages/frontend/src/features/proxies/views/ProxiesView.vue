<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiManagementCard, UiModal } from '@/foundation/ui';
	import ProxyForm from '../components/ProxyForm.vue';
	import { useProxyManagement } from '../composables/use-proxy-management';
	const { t } = useI18n();
	const { data, modal, editing, loading, message, refresh, open, save, remove } = useProxyManagement();
</script>
<template>
	<div class="p-4 text-foreground">
		<div class="mx-auto max-w-6xl">
			<h2 class="mb-4 border-b border-border pb-2 text-xl font-semibold text-foreground">
				{{ t('proxies.title') }}
			</h2>
			<UiButton
				v-if="!modal"
				type="button"
				appearance="solid"
				class="mb-4"
				:disabled="loading || data.busy.value || data.needsRefresh.value"
				@click="open()"
			>
				{{ t('proxies.addProxy') }}
			</UiButton>

			<UiButton
				v-if="message || data.needsRefresh.value"
				class="mb-4 ml-2"
				:disabled="loading || data.busy.value"
				@click="refresh"
				>{{ t('proxies.refresh') }}</UiButton
			>
			<p v-if="data.needsRefresh.value" class="mb-3 text-text-secondary">
				{{ t('proxies.failures.recovery_required') }}
			</p>
			<!-- A failed mutation must not unmount the last confirmed proxy list:
			     unknown results leave rows visible, but fence all edits until refresh. -->
			<div v-if="message" role="alert" class="mb-4 rounded border-l-4 border-error bg-error/10 p-4 text-error">
				{{ message }}
			</div>
			<div class="mt-4">
				<div
					v-if="loading && data.proxies.value.length === 0"
					class="ui-solid-inset mb-4 rounded-lg p-4 text-center text-text-secondary italic"
				>
					{{ t('proxies.loading') }}
				</div>
				<UiEmptyState
					v-else-if="data.proxies.value.length === 0"
					class="mb-4"
					icon="fa-solid fa-network-wired"
					:description="t('proxies.noProxies')"
				/>
				<div v-else class="mt-4 grid gap-4">
					<UiManagementCard v-for="proxy in data.proxies.value" :key="proxy.id">
						<div class="min-w-0 flex-grow space-y-1">
							<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
								<strong class="min-w-0 break-words text-base font-semibold text-foreground">{{
									proxy.name
								}}</strong>
								<span
									class="rounded-full border border-border/60 bg-card/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-secondary"
									>{{ proxy.type }}</span
								>
							</div>
							<div class="break-all text-sm text-text-secondary sm:break-normal">
								<i class="fas fa-server mr-1 text-xs opacity-70" aria-hidden="true" />
								{{ proxy.host }}:{{ proxy.port }}
							</div>
							<div v-if="proxy.username" class="break-all text-sm text-text-secondary sm:break-normal">
								<i class="fas fa-user mr-1 text-xs opacity-70" aria-hidden="true" />
								{{ proxy.username }}
							</div>
						</div>
						<template #actions>
							<UiButton
								type="button"
								appearance="soft"
								:disabled="loading || data.busy.value || data.needsRefresh.value"
								@click="open(proxy)"
							>
								<i class="fas fa-pencil-alt mr-1 text-xs" aria-hidden="true" />{{
									t('proxies.actions.edit')
								}}
							</UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								tone="danger"
								:disabled="loading || data.busy.value || data.needsRefresh.value"
								@click="remove(proxy)"
							>
								<i class="fas fa-trash-alt mr-1 text-xs" aria-hidden="true" />{{
									t('proxies.actions.delete')
								}}
							</UiButton>
						</template>
					</UiManagementCard>
				</div>
			</div>

			<UiModal
				:visible="modal"
				:close-on-backdrop="false"
				panel-class="ui-form-surface w-[calc(100vw-2rem)] max-w-lg sm:min-w-[350px]"
				content-class="!py-0"
				@close="!loading && (modal = false)"
			>
				<ProxyForm v-if="modal" :proxy="editing" :loading="loading" @submit="save" @cancel="modal = false" />
			</UiModal>
		</div>
	</div>
</template>
