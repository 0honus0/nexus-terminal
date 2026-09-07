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
  <div class="fixed right-4 top-4 z-[1100] flex flex-col items-end" aria-live="polite">
    <TransitionGroup
      tag="div"
      enter-active-class="transition duration-500 ease-out"
      enter-from-class="translate-x-8 opacity-0"
      enter-to-class="translate-x-0 opacity-95"
      leave-active-class="transition duration-500 ease-in"
      leave-from-class="translate-x-0 opacity-95"
      leave-to-class="translate-x-8 opacity-0"
    >
      <div
        v-for="notification in notifications"
        :key="notification.id"
        class="mb-2 flex min-w-[250px] max-w-[400px] items-center rounded p-3 text-white opacity-95 shadow-md"
        :class="{
          'bg-green-600': notification.kind === 'success',
          'bg-red-600': notification.kind === 'error',
          'bg-blue-600': notification.kind === 'info',
          'bg-yellow-500 text-gray-800': notification.kind === 'warning',
        }"
      >
        <i :class="[iconClass(notification.kind), 'relative top-px mr-3 text-lg !text-white']" aria-hidden="true" />
        <span class="flex-grow break-words text-sm">{{ notification.message }}</span>
        <button
          type="button"
          class="ml-4 border-none bg-transparent p-1 text-lg leading-none opacity-70 hover:opacity-100"
          @click="store.remove(notification.id)"
        >
          <span aria-hidden="true">&times;</span>
          <span class="sr-only">{{ t('feedback.close') }}</span>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
