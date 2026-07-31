<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UploadItem } from '../types/upload.types'; 

const props = defineProps<{
  uploads: Record<string, UploadItem>; // 接收上传任务字典
}>();

const emit = defineEmits<{
  (e: 'cancel-upload', uploadId: string): void;
  (e: 'cancel-all'): void;
}>();

const { t } = useI18n();

const cancellableCount = computed(() => Object.values(props.uploads).filter(
  upload => ['pending', 'uploading', 'paused'].includes(upload.status)
).length);

// 计算显示的上传列表（可以过滤掉已完成/取消的，或者全部显示）
// 这里选择全部显示，让用户能看到最终状态
const uploadList = computed(() => Object.values(props.uploads).filter(upload => {
  const isEffectivelySuccess = upload.status === 'success' || (upload.status === 'uploading' && upload.progress === 100);
  return !isEffectivelySuccess && upload.status !== 'cancelled';
}));

const handleCancel = (uploadId: string) => {
  emit('cancel-upload', uploadId);
};

const handleCancelAll = () => {
  emit('cancel-all');
};
</script>

<template>
  <!-- 仅当有上传任务时显示 -->
  <div v-if="uploadList.length > 0" class="fixed bottom-4 right-4 bg-background border border-border rounded-md shadow-md p-3 max-w-xs max-h-48 overflow-y-auto z-[1001] text-sm">
    <div class="mb-2 flex items-center justify-between gap-3 border-b border-border pb-1">
      <h4 class="m-0 text-sm font-semibold">{{ t('fileManager.uploadTasks') }}:</h4>
      <button
        v-if="cancellableCount > 1"
        type="button"
        class="rounded border border-red-300 bg-red-100 px-2 py-0.5 text-xs text-red-700 hover:bg-red-200"
        @click="handleCancelAll"
      >
        {{ t('fileManager.actions.cancelAll') }} ({{ cancellableCount }})
      </button>
    </div>
    <ul class="list-none p-0 m-0">
      <li v-for="upload in uploadList" :key="upload.id" class="mb-1.5 text-xs flex items-center flex-wrap gap-2">
        <span class="flex-grow truncate" :title="upload.filename">{{ upload.filename }} ({{ t(`fileManager.uploadStatus.${upload.status}`) }})</span>
        <progress v-if="(upload.status === 'uploading' && upload.progress < 100) || upload.status === 'pending'" :value="upload.progress" max="100" class="w-20 h-2 flex-shrink-0 [&::-webkit-progress-bar]:rounded-lg [&::-webkit-progress-value]:rounded-lg [&::-webkit-progress-bar]:bg-gray-300 [&::-webkit-progress-value]:bg-blue-600 [&::-moz-progress-bar]:bg-blue-600"></progress>
        <span v-if="upload.status === 'uploading' && upload.progress < 100" class="text-xs flex-shrink-0"> {{ upload.progress }}%</span>
        <span v-if="upload.status === 'error'" class="text-red-600 basis-full text-xs"> {{ t('fileManager.errors.generic') }}: {{ upload.error }}</span>
        <span v-if="upload.status === 'success' || (upload.status === 'uploading' && upload.progress === 100)" class="text-green-600"> ✅</span>
        <span v-if="upload.status === 'cancelled'" class="text-red-600"> ❌ {{ t('fileManager.uploadStatus.cancelled') }}</span>
        <!-- 只有在可取消状态时显示取消按钮 -->
        <button v-if="['pending', 'uploading', 'paused'].includes(upload.status)" @click="handleCancel(upload.id)" class="ml-auto px-1.5 py-0.5 text-xs bg-red-100 border border-red-300 text-red-700 cursor-pointer rounded hover:bg-red-200 flex-shrink-0">{{ t('fileManager.actions.cancel') }}</button>
      </li>
    </ul>
  </div>
</template>

