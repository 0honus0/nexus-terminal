import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { QuantityLabels } from './quantity-format';

/**
 * §7.14-c：把数量格式化的文字部分接到当前语言上。
 * 位置参数用函数包一层，避免每个调用点自己拼 `{ value }` 模板。
 */
export const useQuantityLabels = (): ComputedRef<QuantityLabels> => {
  const { t } = useI18n();
  return computed<QuantityLabels>(() => ({
    unlimited: t('agent.settings.quantity.unlimited'),
    seconds: (value) => t('agent.settings.quantity.seconds', { value }),
    minutes: (value) => t('agent.settings.quantity.minutes', { value }),
    hours: (value) => t('agent.settings.quantity.hours', { value }),
    days: (value) => t('agent.settings.quantity.days', { value }),
    invalidFormat: t('agent.settings.quantity.invalidFormat'),
    exactBytes: (value) => t('agent.settings.quantity.exactBytes', { value }),
    exactSeconds: (value) => t('agent.settings.quantity.exactSeconds', { value }),
  }));
};
