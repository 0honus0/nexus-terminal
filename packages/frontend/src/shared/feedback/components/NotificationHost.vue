<script setup lang="ts">
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import type { NotificationKind, UiNotification } from '../model';
	import { useNotificationStore } from '../store/notification.store';

	const { t } = useI18n();
	const store = useNotificationStore();
	const { notifications } = storeToRefs(store);

	const titleFor = (kind: NotificationKind): string => t(`feedback.toast.${kind}Title`);

	const actionTone = (kind: NotificationKind): 'primary' | 'success' | 'warning' | 'danger' => {
		if (kind === 'success') return 'success';
		if (kind === 'warning') return 'warning';
		if (kind === 'error') return 'danger';
		return 'primary';
	};

	const confirm = (notification: UiNotification): void => {
		if (notification.action) {
			notification.action.onClick();
			return;
		}
		store.remove(notification.id);
	};
</script>

<template>
	<div
		class="ui-notification-host pointer-events-none fixed inset-x-5 z-[1100] flex flex-col items-stretch sm:left-auto sm:right-4 sm:w-[288px]"
		aria-live="polite"
	>
		<TransitionGroup
			tag="div"
			enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
			enter-from-class="translate-x-2 opacity-0"
			enter-to-class="translate-x-0 opacity-100"
			leave-active-class="transition duration-200 ease-in motion-reduce:transition-none"
			leave-from-class="translate-x-0 opacity-100"
			leave-to-class="translate-x-2 opacity-0"
			class="flex w-full flex-col items-stretch"
		>
			<div
				v-for="notification in notifications"
				:key="notification.id"
				:role="notification.kind === 'error' ? 'alert' : undefined"
				data-ui-gen="2"
				class="ui-notification pointer-events-auto mb-2"
				:data-kind="notification.kind"
			>
				<div class="ui-notification__header">
					<strong class="ui-notification__title">{{ titleFor(notification.kind) }}</strong>
					<UiButton
						type="button"
						appearance="ghost"
						density="compact"
						icon-only
						class="ui-notification__close"
						:aria-label="t('feedback.close')"
						:title="t('feedback.close')"
						@click="store.remove(notification.id)"
					>
						<i class="fas fa-xmark" aria-hidden="true"></i>
					</UiButton>
				</div>
				<p class="ui-notification__message">{{ notification.message }}</p>
				<div class="ui-notification__action-row">
					<UiButton
						type="button"
						appearance="soft"
						:tone="actionTone(notification.kind)"
						density="compact"
						class="ui-notification__action"
						:disabled="notification.action?.disabled() ?? false"
						@click="confirm(notification)"
					>
						{{ notification.action?.label ?? t('feedback.toast.acknowledge') }}
					</UiButton>
				</div>
			</div>
		</TransitionGroup>
	</div>
</template>
