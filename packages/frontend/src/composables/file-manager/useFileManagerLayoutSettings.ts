/**
 * 文件管理器布局设置同步逻辑
 * 从 FileManager.vue 提取，负责行大小乘数和列宽与 Store 的双向同步
 */

import { ref, watchEffect, type Ref } from 'vue';
import type { ColumnWidths } from './useFileManagerColumnResize';

export interface UseFileManagerLayoutSettingsOptions {
  /** Store 中的行大小乘数 */
  storeMultiplier: Ref<number>;
  /** Store 中的列宽配置 */
  storeWidths: Ref<Record<string, number>>;
  /** 保存布局设置到 Store 的回调 */
  onSaveSettings: (multiplier: number, widths: ColumnWidths) => void;
  /** 日志前缀（实例标识） */
  logPrefix?: string;
}

export interface UseFileManagerLayoutSettingsReturn {
  /** 行大小乘数 */
  rowSizeMultiplier: Ref<number>;
  /** 列宽配置 */
  colWidths: Ref<ColumnWidths>;
  /** 保存布局设置 */
  saveLayoutSettings: () => void;
  /** 处理 Ctrl+滚轮调整行大小 */
  handleWheel: (event: WheelEvent) => void;
}

const DEFAULT_COL_WIDTHS: ColumnWidths = {
  type: 50,
  name: 300,
  size: 100,
  permissions: 120,
  modified: 180,
};

export const useFileManagerLayoutSettings = (
  options: UseFileManagerLayoutSettingsOptions
): UseFileManagerLayoutSettingsReturn => {
  const { storeMultiplier, storeWidths, onSaveSettings, logPrefix = '[FileManager]' } = options;

  const rowSizeMultiplier = ref(1.0);
  const colWidths = ref<ColumnWidths>({ ...DEFAULT_COL_WIDTHS });

  const saveLayoutSettings = () => {
    const widthsToSave = JSON.parse(JSON.stringify(colWidths.value));
    console.info(
      `${logPrefix} Triggering saveLayoutSettings: multiplier=${rowSizeMultiplier.value}, widths=${JSON.stringify(widthsToSave)}`
    );
    onSaveSettings(rowSizeMultiplier.value, widthsToSave);
  };

  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.05 : 0.05;
      const newMultiplier = Math.max(0.5, Math.min(2, rowSizeMultiplier.value + delta));
      const oldMultiplier = rowSizeMultiplier.value;
      rowSizeMultiplier.value = parseFloat(newMultiplier.toFixed(2));
      if (rowSizeMultiplier.value !== oldMultiplier) {
        console.info(`${logPrefix} handleWheel triggered saveLayoutSettings.`);
        saveLayoutSettings();
      }
    }
  };

  // 从 Store 同步布局设置到本地 ref
  watchEffect(() => {
    const sMultiplier = storeMultiplier.value;
    const sWidths = storeWidths.value;

    console.info(
      `${logPrefix} watchEffect triggered. Store values: multiplier=${sMultiplier}, widths=${JSON.stringify(sWidths)}`
    );

    if (sMultiplier > 0 && Object.keys(sWidths).length > 0) {
      const currentMultiplier = rowSizeMultiplier.value;
      const currentWidthsString = JSON.stringify(colWidths.value);
      const storeWidthsString = JSON.stringify(sWidths);

      if (sMultiplier !== currentMultiplier) {
        rowSizeMultiplier.value = sMultiplier;
        console.info(`${logPrefix} Row size multiplier updated from store: ${sMultiplier}`);
      }
      if (storeWidthsString !== currentWidthsString) {
        const updatedWidths = { ...colWidths.value };
        for (const key of Object.keys(updatedWidths)) {
          if (sWidths[key] !== undefined && typeof sWidths[key] === 'number' && sWidths[key] > 0) {
            updatedWidths[key as keyof ColumnWidths] = sWidths[key];
          }
        }
        colWidths.value = updatedWidths;
        console.info(
          `${logPrefix} Column widths updated from store: ${JSON.stringify(updatedWidths)}`
        );
      }
    } else {
      console.info(
        `${logPrefix} Waiting for valid layout settings from store... Store Multiplier=${sMultiplier}, Store Widths Keys=${Object.keys(sWidths).length}`
      );
    }
  });

  return {
    rowSizeMultiplier,
    colWidths,
    saveLayoutSettings,
    handleWheel,
  };
};
