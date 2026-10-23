<script setup lang="ts">
	import { computed, onActivated, onMounted, ref, shallowRef } from 'vue';
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiEmptyState, UiLoadingState, UiModal, UiSearchInput, UiSelect } from '@/foundation/ui';
	import { useFeedback, useFeedbackMessage } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import NotificationSettingForm from '../components/NotificationSettingForm.vue';
	import { useNotificationsStore } from '../store/notifications.store';
	import { notificationFailureKey } from '../model/notification-failure';
	import type { NotificationSetting, NotificationChange } from '../model/notification-types';

	type ChannelKind = NotificationSetting['config']['kind'];
	type EnabledFilter = 'all' | 'enabled' | 'disabled';

	const { t, te } = useI18n();
	const feedback = useFeedback();
	const store = useNotificationsStore();
	const { items, loading, error, needsRefresh } = storeToRefs(store);
	const editing = shallowRef<NotificationSetting | null>(null);
	const formVisible = ref(false);
	const message = ref('');
	let failureCause: unknown;
	const search = ref('');
	const typeFilter = ref<'all' | ChannelKind>('all');
	const enabledFilter = ref<EnabledFilter>('all');
	const view = useAuthenticatedViewScope({ onRevoke: closeForm });

	const eventLabel = (event: string) =>
		te('settings.notifications.events.' + event)
			? t('settings.notifications.events.' + event)
			: t('settings.notifications.unknownEvent');

	const channelEndpoint = (item: NotificationSetting): string => {
		const config = item.config;
		if (config.kind === 'webhook') return config.url;
		if (config.kind === 'email') return config.to;
		return config.chatId;
	};

	const filteredChannels = computed(() => {
		const query = search.value.trim().toLowerCase();
		return items.value.filter((item) => {
			if (typeFilter.value !== 'all' && item.config.kind !== typeFilter.value) return false;
			if (enabledFilter.value === 'enabled' && !item.enabled) return false;
			if (enabledFilter.value === 'disabled' && item.enabled) return false;
			if (!query) return true;
			const eventText = item.events.map(eventLabel).join(' ');
			return `${item.name} ${item.config.kind} ${channelEndpoint(item)} ${eventText}`
				.toLowerCase()
				.includes(query);
		});
	});

	const summary = computed(() => {
		const channels = items.value;
		return [
			{
				key: 'total',
				label: t('settings.notifications.summary.total'),
				value: channels.length,
				icon: 'fa-solid fa-bell',
				tone: 'primary',
			},
			{
				key: 'webhook',
				label: t('settings.notifications.types.webhook'),
				value: channels.filter((item) => item.config.kind === 'webhook').length,
				icon: 'fa-solid fa-globe',
				tone: 'info',
			},
			{
				key: 'email',
				label: t('settings.notifications.types.email'),
				value: channels.filter((item) => item.config.kind === 'email').length,
				icon: 'fa-solid fa-envelope',
				tone: 'warm',
			},
			{
				key: 'telegram',
				label: t('settings.notifications.types.telegram'),
				value: channels.filter((item) => item.config.kind === 'telegram').length,
				icon: 'fa-brands fa-telegram',
				tone: 'accent',
			},
		];
	});

	const notice = computed(() => message.value || (error.value ? t(notificationFailureKey(error.value)) : ''));

	function closeForm(): void {
		formVisible.value = false;
		editing.value = null;
		message.value = '';
		failureCause = undefined;
	}

	function requestCloseForm(): void {
		if (!loading.value) closeForm();
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
		} catch (cause) {
			if (view.isCurrent(signal)) {
				failureCause = cause;
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
				failureCause = cause;
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
				failureCause = cause;
				message.value = t(notificationFailureKey(cause));
			}
		}
	}

	const channelIcon = (kind: ChannelKind): string =>
		kind === 'webhook' ? 'fa-solid fa-globe' : kind === 'email' ? 'fa-solid fa-envelope' : 'fa-brands fa-telegram';

	const channelTone = (kind: ChannelKind): string =>
		kind === 'webhook' ? 'info' : kind === 'email' ? 'warm' : 'accent';

	onMounted(() => void load());
	let initialActivation = true;
	onActivated(() => {
		if (initialActivation) {
			initialActivation = false;
			return;
		}
		void load();
	});
	useFeedbackMessage(
		() => notice.value,
		undefined,
		() => failureCause ?? error.value,
	);
</script>

<template>
	<main class="ui-catalog-page">
		<div class="ui-catalog-shell">
			<h1 class="ui-catalog-title">{{ t('settings.notifications.title') }}</h1>

			<div class="ui-catalog-actions">
				<UiButton
					v-if="!error && !message"
					type="button"
					appearance="solid"
					tone="primary"
					:disabled="loading || needsRefresh || Boolean(error) || Boolean(message)"
					@click="openAdd"
				>
					<i class="fas fa-plus" aria-hidden="true"></i>
					{{ t('settings.notifications.addChannel') }}
				</UiButton>
			</div>

			<div class="ui-catalog-summary" role="group" :aria-label="t('settings.notifications.summary.label')">
				<div v-for="item in summary" :key="item.key" class="ui-catalog-stat" :data-tone="item.tone">
					<span class="ui-catalog-stat__icon" aria-hidden="true"><i :class="item.icon"></i></span>
					<span class="ui-catalog-stat__label">{{ item.label }}</span>
					<strong class="ui-catalog-stat__value">{{ item.value }}</strong>
				</div>
			</div>

			<section class="ui-catalog-panel" aria-labelledby="notification-channel-list-title">
				<header class="ui-catalog-panel__head">
					<div class="ui-catalog-panel__title">
						<span class="ui-catalog-panel__mark" aria-hidden="true">
							<i class="fas fa-bell"></i>
						</span>
						<h2 id="notification-channel-list-title">
							{{ t('settings.notifications.channelsTitle') }}
							<span class="ui-catalog-panel__count">{{ filteredChannels.length }}</span>
						</h2>
					</div>
				</header>

				<div class="ui-catalog-toolbar ui-catalog-toolbar--notifications">
					<UiSearchInput
						v-model="search"
						density="comfortable"
						:placeholder="t('settings.notifications.searchPlaceholder')"
						:aria-label="t('common.search')"
						:clear-label="t('common.clear')"
					/>
					<UiSelect
						v-model="typeFilter"
						density="comfortable"
						text-align="center"
						:aria-label="t('settings.notifications.filterType')"
					>
						<option value="all">{{ t('settings.notifications.allTypes') }}</option>
						<option value="webhook">{{ t('settings.notifications.types.webhook') }}</option>
						<option value="email">{{ t('settings.notifications.types.email') }}</option>
						<option value="telegram">{{ t('settings.notifications.types.telegram') }}</option>
					</UiSelect>
					<UiSelect
						v-model="enabledFilter"
						density="comfortable"
						text-align="center"
						:aria-label="t('settings.notifications.filterStatus')"
					>
						<option value="all">{{ t('common.all') }}</option>
						<option value="enabled">{{ t('common.enabled') }}</option>
						<option value="disabled">{{ t('common.disabled') }}</option>
					</UiSelect>
				</div>
				<div v-if="needsRefresh" class="mb-3 flex justify-end">
					<UiButton type="button" density="compact" :disabled="loading" @click="load(true)">
						{{ t('settings.notifications.refresh') }}
					</UiButton>
				</div>

				<UiLoadingState
					v-if="loading && !items.length && !error"
					class="min-h-[240px]"
					:bordered="false"
					:title="t('common.loading')"
				/>
				<UiEmptyState
					v-else-if="!error && filteredChannels.length === 0"
					class="min-h-[240px]"
					:bordered="false"
					:icon="
						search || typeFilter !== 'all' || enabledFilter !== 'all'
							? 'fa-magnifying-glass'
							: 'fa-bell-slash'
					"
					:title="
						!items.length ? t('settings.notifications.noChannels') : t('settings.notifications.noMatches')
					"
				/>
				<ul v-else-if="!error" class="ui-catalog-list">
					<li v-for="item in filteredChannels" :key="item.id">
						<article class="notifications-channel-card ui-catalog-card" :data-notification-id="item.id">
							<span
								class="ui-catalog-card__icon"
								:data-tone="channelTone(item.config.kind)"
								aria-hidden="true"
							>
								<i :class="channelIcon(item.config.kind)"></i>
							</span>
							<div class="ui-catalog-card__content">
								<div class="ui-catalog-card__heading">
									<strong class="ui-catalog-card__name">{{ item.name }}</strong>
									<UiBadge appearance="ghost" density="compact">
										{{ t('settings.notifications.types.' + item.config.kind) }}
									</UiBadge>
									<UiBadge
										appearance="ghost"
										density="compact"
										:tone="item.enabled ? 'success' : 'warning'"
									>
										{{ t(item.enabled ? 'common.enabled' : 'common.disabled') }}
									</UiBadge>
								</div>
								<code class="ui-catalog-card__address" :title="channelEndpoint(item)">
									{{ channelEndpoint(item) }}
								</code>
								<div class="ui-catalog-card__meta">
									<span v-if="item.events.length" class="ui-catalog-card__meta-item">
										<i class="fas fa-bolt" aria-hidden="true"></i>
										{{
											t('settings.notifications.enabledEventCount', {
												count: item.events.length,
											})
										}}
									</span>
									<span v-if="!item.events.length" class="ui-catalog-card__meta-item">
										<i class="fas fa-bolt-slash" aria-hidden="true"></i>
										{{ t('settings.notifications.noEventsEnabled') }}
									</span>
								</div>
							</div>
							<div class="ui-catalog-card__actions">
								<UiButton
									type="button"
									appearance="soft"
									icon-only
									density="comfortable"
									class="ui-catalog-card__action"
									:disabled="loading || needsRefresh"
									:aria-label="t('common.edit')"
									:title="t('common.edit')"
									@click="openEdit(item)"
								>
									<i class="fas fa-pen" aria-hidden="true"></i>
									<span class="ui-catalog-card__action-label">{{ t('common.edit') }}</span>
								</UiButton>
								<UiButton
									type="button"
									appearance="soft"
									tone="danger"
									icon-only
									density="comfortable"
									class="ui-catalog-card__action"
									:disabled="loading || needsRefresh"
									:aria-label="t('common.delete')"
									:title="t('common.delete')"
									@click="remove(item)"
								>
									<i class="fas fa-trash-alt" aria-hidden="true"></i>
									<span class="ui-catalog-card__action-label">{{ t('common.delete') }}</span>
								</UiButton>
							</div>
						</article>
					</li>
				</ul>
			</section>

			<UiModal
				:visible="formVisible"
				:z-index="150"
				:close-on-backdrop="false"
				panel-class="ui-form-surface !w-[calc(100vw-2rem)] !max-w-3xl !p-4 sm:!p-6"
				:panel-style="{ height: 'min(780px, calc(100dvh - 2rem))', maxHeight: 'calc(100dvh - 2rem)' }"
				content-class="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !py-0"
				@close="requestCloseForm"
			>
				<NotificationSettingForm
					v-if="formVisible"
					:key="editing?.id ?? 'new'"
					:visible="formVisible"
					:setting="editing"
					@close="closeForm"
					@save="save"
				/>
			</UiModal>
		</div>
	</main>
</template>
