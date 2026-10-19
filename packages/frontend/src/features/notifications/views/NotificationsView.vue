<script setup lang="ts">
	import { onActivated, onMounted, ref, shallowRef } from 'vue';
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
	const view = useAuthenticatedViewScope({ onRevoke: closeForm });

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
		te('settings.notifications.events.' + event) ? t('settings.notifications.events.' + event) : event;

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
		<div class="mx-auto max-w-6xl space-y-4">
			<h2 class="border-b border-border pb-2 text-xl font-semibold">{{ t('settings.notifications.title') }}</h2>
			<div
				v-if="error || message"
				role="alert"
				class="rounded border-l-4 border-error bg-error/10 p-4 text-error"
			>
				{{ message || t(notificationFailureKey(error)) }}
			</div>
			<div class="flex gap-3">
				<UiButton type="button" appearance="solid" :disabled="loading || needsRefresh" @click="openAdd">{{
					t('settings.notifications.addChannel')
				}}</UiButton>
				<UiButton type="button" :disabled="loading" @click="load(true)">{{
					t('settings.notifications.refresh')
				}}</UiButton>
			</div>
			<UiSpinner v-if="loading && !items.length" class="mx-auto" />
			<UiEmptyState
				v-else-if="!items.length && !error"
				icon="fa-solid fa-bell-slash"
				:description="t('settings.notifications.noChannels')"
			/>
			<div class="grid gap-4">
				<UiManagementCard v-for="item in items" :key="item.id" :data-notification-id="item.id">
					<div class="min-w-0 space-y-2">
						<strong class="break-words">{{ item.name }}</strong>
						<span class="mx-3 text-sm">{{ t('settings.notifications.types.' + item.config.kind) }}</span>
						<span class="text-sm">{{ t(item.enabled ? 'common.enabled' : 'common.disabled') }}</span>
						<small class="block break-words text-text-secondary">{{
							item.events.length
								? item.events.map(eventLabel).join(', ')
								: t('settings.notifications.noEventsEnabled')
						}}</small>
					</div>
					<template #actions>
						<UiButton type="button" :disabled="loading || needsRefresh" @click="openEdit(item)">{{
							t('common.edit')
						}}</UiButton>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							:disabled="loading || needsRefresh"
							@click="remove(item)"
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
			<section class="space-y-3 border-t border-border pt-4">
				<div class="flex items-center gap-3">
					<h3 class="font-semibold">{{ t('settings.notifications.deliveries') }}</h3>
					<UiButton type="button" :disabled="loading" @click="loadDeliveries(false)">{{
						t('common.refresh')
					}}</UiButton>
				</div>
				<p class="text-sm text-text-secondary">{{ t('settings.notifications.deliveryHint') }}</p>
				<ul class="space-y-2">
					<li
						v-for="delivery in deliveries"
						:key="delivery.id"
						class="break-words rounded border border-border p-3 text-sm"
						:data-delivery-id="delivery.id"
					>
						{{ eventLabel(delivery.event) }} ·
						{{ t('settings.notifications.deliveryStatus.' + delivery.status) }} ·
						{{ new Date(delivery.createdAt).toLocaleString() }}
					</li>
				</ul>
				<UiButton v-if="nextOffset !== null" type="button" :disabled="loading" @click="loadDeliveries(true)">{{
					t('settings.notifications.loadMore')
				}}</UiButton>
			</section>
		</div>
	</div>
</template>
