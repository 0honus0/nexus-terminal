/**
 * 连接表单 - 标签管理处理器模块
 * 职责：创建标签、删除标签（含确认对话框）
 */
import type { Ref } from 'vue';
import type { useTagsStore } from '../stores/tags.store';
import type { TranslateFn } from '../types/i18n.types';

/** 标签管理处理器依赖 */
export interface TagDeps {
  formData: { tag_ids: number[] };
  tags: Ref<Array<{ id: number; name: string }>>;
  tagsStore: ReturnType<typeof useTagsStore>;
  showConfirmDialog: (opts: { message: string }) => Promise<boolean>;
  showAlertDialog: (opts: { title: string; message: string }) => void;
  t: TranslateFn;
}

/**
 * 创建标签管理处理器
 * handleCreateTag: 创建新标签并自动选中
 * handleDeleteTag: 删除标签（含确认对话框）
 */
export function createTagHandlers(deps: TagDeps) {
  const { formData, tags, tagsStore, showConfirmDialog, showAlertDialog, t } = deps;

  const handleCreateTag = async (tagName: string) => {
    if (!tagName || tagName.trim().length === 0) return;
    const newTag = await tagsStore.addTag(tagName.trim());
    if (newTag && !formData.tag_ids.includes(newTag.id)) {
      formData.tag_ids.push(newTag.id);
    }
  };

  const handleDeleteTag = async (tagId: number) => {
    const tagToDelete = tags.value.find((t_) => t_.id === tagId);
    if (!tagToDelete) return;

    const confirmedDeleteTag = await showConfirmDialog({
      message: t('tags.prompts.confirmDelete', { name: tagToDelete.name }),
    });
    if (confirmedDeleteTag) {
      const success = await tagsStore.deleteTag(tagId);
      if (!success) {
        showAlertDialog({
          title: t('common.error', '错误'),
          message: t('tags.errorDelete', { error: tagsStore.error || '未知错误' }),
        });
      }
    }
  };

  return { handleCreateTag, handleDeleteTag };
}
