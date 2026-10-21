<script setup lang="ts">
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import { useNotificationStore } from '../store/notification.store';

	const { t } = useI18n();
	const store = useNotificationStore();
	const { notifications } = storeToRefs(store);

	const iconClass = (kind: string): string => {
		if (kind === 'success') return 'fas fa-check-circle';
		if (kind === 'error') return 'fas fa-times-circle';
		if (kind === 'warning') return 'fas fa-exclamation-triangle';
		return 'fas fa-info-circle';
	};
</script>

<template>
	<div
		class="pointer-events-none fixed inset-x-3 top-4 z-[1100] flex flex-col items-end sm:left-auto sm:right-4 sm:w-[400px]"
		aria-live="polite"
	>
		<TransitionGroup
			tag="div"
			enter-active-class="transition duration-500 ease-out motion-reduce:transition-none"
			enter-from-class="translate-x-8 opacity-0"
			enter-to-class="translate-x-0 opacity-95"
			leave-active-class="transition duration-500 ease-in motion-reduce:transition-none"
			leave-from-class="translate-x-0 opacity-95"
			leave-to-class="translate-x-8 opacity-0"
			class="w-full max-w-full"
		>
			<div
				v-for="notification in notifications"
				:key="notification.id"
				:role="notification.kind === 'error' ? 'alert' : undefined"
				class="pointer-events-auto mb-2 flex w-full max-w-[400px] items-center gap-2 rounded-lg py-2 pl-3 pr-1 opacity-95 shadow-md"
				:class="{
					'bg-green-600 text-white': notification.kind === 'success',
					'bg-red-600 text-white': notification.kind === 'error',
					'bg-blue-600 text-white': notification.kind === 'info',
					'bg-yellow-500 text-gray-800': notification.kind === 'warning',
				}"
			>
				<i :class="[iconClass(notification.kind), 'relative top-px mr-3 text-lg']" aria-hidden="true" />
				<span class="min-w-0 flex-grow break-words text-sm">{{ notification.message }}</span>
				<button
					type="button"
					class="grid h-11 w-11 shrink-0 place-items-center rounded-md border-none bg-transparent text-base text-current opacity-90 transition-colors hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current"
					:aria-label="t('feedback.close')"
					:title="t('feedback.close')"
					@click="store.remove(notification.id)"
				>
					<i class="fas fa-xmark" aria-hidden="true"></i>
				</button>
			</div>
		</TransitionGroup>
	</div>
</template>
