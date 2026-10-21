<script setup lang="ts">
	import { computed, onActivated, onMounted, ref, shallowRef } from 'vue';
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiManagementCard, UiSpinner } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import NotificationSettingForm from '../components/NotificationSettingForm.vue';
	import { useNotificationsStore } from '../store/notifications.store';
	import { notificationFailureKey } from '../model/notification-failure';
	import type { NotificationSetting, NotificationChange } from '../model/notification-types';

	const { t, te } = useI18n();
	const feedback = useFeedback();
	const store = useNotificationsStore();
	const { items, deliveries, nextOffset, loading, error, needsRefresh } = storeToRefs(store);
	const editing = shallowRef<NotificationSetting | null>(null);
	const formVisible = ref(false);
	const message = ref('');
	const deliveriesOpen = ref(false);
	const view = useAuthenticatedViewScope({ onRevoke: closeForm });
	const unknownDeliveryCount = computed(
		() => deliveries.value.filter((delivery) => delivery.status === 'unknown').length,
	);

	function closeForm(): void {
		formVisible.value = false;
		editing.value = null;
		message.value = '';
	}

	async function load(recover = false): Promise<void> {
		const signal = view.capture();
		if (signal.aborted) {
			return;
		}
		if (recover) {
			closeForm();
		}
		try {
			await store.load(recover, signal);
			if (view.isCurrent(signal)) {
				await store.loadDeliveries(false, signal);
			}
		} catch (cause) {
			if (view.isCurrent(signal)) {
				message.value = t(notificationFailureKey(cause));
			}
		}
	}

	function openAdd(): void {
		editing.value = null;
		formVisible.value = true;
	}

	function openEdit(item: NotificationSetting): void {
		editing.value = item;
		formVisible.value = true;
	}

	async function save(input: NotificationChange): Promise<void> {
		const signal = view.capture();
		const original = editing.value;
		if (signal.aborted) {
			return;
		}
		try {
			await store.save(input, original ? { id: original.id, version: original.version } : null, signal);
			if (view.isCurrent(signal)) {
				closeForm();
				feedback.notifySuccess(t('common.saved'));
			}
		} catch (cause) {
			if (view.isCurrent(signal)) {
				message.value = t(notificationFailureKey(cause));
			}
		}
	}

	async function remove(item: NotificationSetting): Promise<void> {
		const signal = view.capture();
		const id = item.id;
		const version = item.version;
		if (signal.aborted || loading.value || needsRefresh.value) {
			return;
		}
		const confirmed = await feedback.confirm({
			message: t('settings.notifications.confirmDelete', { name: item.name }),
			destructive: true,
			signal,
		});
		if (!confirmed || !view.isCurrent(signal)) {
			return;
		}
		try {
			await store.remove(id, version, signal);
		} catch (cause) {
			if (view.isCurrent(signal)) {
				message.value = t(notificationFailureKey(cause));
			}
		}
	}

	async function loadDeliveries(append: boolean): Promise<void> {
		const signal = view.capture();
		try {
			await store.loadDeliveries(append, signal);
		} catch (cause) {
			if (view.isCurrent(signal)) {
				message.value = t(notificationFailureKey(cause));
			}
		}
	}

	const eventLabel = (event: string) =>
		te('settings.notifications.events.' + event)
			? t('settings.notifications.events.' + event)
			: t('settings.notifications.unknownEvent');

	onMounted(() => void load());
	let initialActivation = true;
	onActivated(() => {
		if (initialActivation) {
			initialActivation = false;
			return;
		}
		void load();
	});
</script>

<template>
	<div class="p-4 text-foreground">
		<div class="mx-auto max-w-6xl p-0">
			<h2 class="mb-4 border-b border-border pb-2 text-xl font-semibold text-foreground">
				{{ t('settings.notifications.title') }}
			</h2>
			<div
				v-if="error || message"
				role="alert"
				class="mb-4 rounded border-l-4 border-error bg-error/10 p-4 text-error"
			>
				{{ message || t(notificationFailureKey(error)) }}
			</div>
			<div class="mb-4 flex flex-wrap gap-3">
				<UiButton
					v-if="!error && !message"
					type="button"
					appearance="solid"
					:disabled="loading || needsRefresh"
					@click="openAdd"
					>{{ t('settings.notifications.addChannel') }}</UiButton
				>
				<UiButton
					v-if="!loading && (needsRefresh || error || message)"
					type="button"
					:disabled="loading"
					@click="load(true)"
					>{{ t('settings.notifications.refresh') }}</UiButton
				>
			</div>
			<div v-if="loading && !items.length && !error" class="p-4 text-center text-text-secondary italic">
				<UiSpinner class="mx-auto" />
			</div>
			<UiEmptyState
				v-else-if="!loading && !error && !items.length"
				class="mb-4"
				icon="fa-solid fa-bell-slash"
				:description="t('settings.notifications.noChannels')"
			/>
			<div v-else-if="!loading && !error && items.length > 0" class="mt-4 grid gap-4">
				<UiManagementCard
					v-for="item in items"
					:key="item.id"
					:data-notification-id="item.id"
					class="notifications-channel-card"
				>
					<div class="min-w-0 flex-grow">
						<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
							<strong class="min-w-0 break-words text-base font-semibold text-foreground">{{
								item.name
							}}</strong>
							<span
								class="rounded-full border border-border/60 bg-card/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-secondary"
								>{{ t('settings.notifications.types.' + item.config.kind) }}</span
							>
							<span
								class="rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider"
								:class="
									item.enabled
										? 'border-success/30 bg-success/10 text-success'
										: 'border-warning/30 bg-warning/10 text-warning'
								"
								>{{ t(item.enabled ? 'common.enabled' : 'common.disabled') }}</span
							>
						</div>
						<small class="mt-1 block break-words text-sm text-text-secondary">{{
							item.events.length
								? t('settings.notifications.triggers') + ': ' + item.events.map(eventLabel).join(', ')
								: t('settings.notifications.noEventsEnabled')
						}}</small>
					</div>
					<template #actions>
						<UiButton
							type="button"
							appearance="soft"
							:disabled="loading || needsRefresh"
							@click="openEdit(item)"
							><i class="fas fa-pencil-alt mr-1 text-xs" aria-hidden="true"></i
							>{{ t('common.edit') }}</UiButton
						>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							:disabled="loading || needsRefresh"
							@click="remove(item)"
							><i class="fas fa-trash-alt mr-1 text-xs" aria-hidden="true"></i
							>{{ t('common.delete') }}</UiButton
						>
					</template>
				</UiManagementCard>
			</div>
			<div v-if="formVisible" class="ui-form-surface rounded-xl p-4 sm:p-6">
				<NotificationSettingForm
					:key="editing?.id ?? 'new'"
					:visible="formVisible"
					:setting="editing"
					@close="closeForm"
					@save="save"
				/>
			</div>
			<section class="mt-6 border-t border-border pt-4">
				<button
					type="button"
					class="flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-header/50 focus-visible:ring-2 focus-visible:ring-primary"
					:aria-expanded="deliveriesOpen"
					aria-controls="notification-deliveries"
					@click="deliveriesOpen = !deliveriesOpen"
				>
					<i
						:class="[
							'fas',
							deliveriesOpen ? 'fa-chevron-down' : 'fa-chevron-right',
							'w-3 text-xs text-text-secondary',
						]"
						aria-hidden="true"
					/>
					<h3 class="font-semibold">{{ t('settings.notifications.deliveries') }}</h3>
					<span
						v-if="unknownDeliveryCount"
						class="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
					>
						{{ t('settings.notifications.unknownDeliveries', { count: unknownDeliveryCount }) }}
					</span>
					<span class="ml-auto text-xs text-text-secondary">
						{{ t(deliveriesOpen ? 'common.collapse' : 'common.expand') }}
					</span>
				</button>
				<div v-if="deliveriesOpen" id="notification-deliveries" class="mt-3 space-y-3 px-2">
					<div class="flex flex-wrap items-start gap-3">
						<p class="min-w-0 flex-1 text-sm text-text-secondary">
							{{ t('settings.notifications.deliveryHint') }}
						</p>
						<UiButton type="button" density="compact" :disabled="loading" @click="loadDeliveries(false)">{{
							t('common.refresh')
						}}</UiButton>
					</div>
					<ul v-if="deliveries.length" class="space-y-2">
						<li
							v-for="delivery in deliveries"
							:key="delivery.id"
							class="break-words rounded border p-3 text-sm"
							:class="
								delivery.status === 'unknown'
									? 'border-warning/30 bg-warning/[0.06] text-warning'
									: 'border-border'
							"
							:data-delivery-id="delivery.id"
						>
							{{ eventLabel(delivery.event) }} ·
							{{ t('settings.notifications.deliveryStatus.' + delivery.status) }} ·
							{{ new Date(delivery.createdAt).toLocaleString() }}
						</li>
					</ul>
					<p v-else class="text-sm text-text-secondary">{{ t('settings.notifications.noDeliveries') }}</p>
					<UiButton
						v-if="nextOffset !== null"
						type="button"
						:disabled="loading"
						@click="loadDeliveries(true)"
						>{{ t('settings.notifications.loadMore') }}</UiButton
					>
				</div>
			</section>
		</div>
	</div>
</template>

<style scoped>
	@media (max-width: 639px) {
		.notifications-channel-card :deep(.ui-action-group[data-layout='management']) {
			min-width: 0;
		}
		.notifications-channel-card :deep(.ui-button--action-management) {
			min-width: 0;
			white-space: normal;
			overflow-wrap: anywhere;
		}
	}
</style>
