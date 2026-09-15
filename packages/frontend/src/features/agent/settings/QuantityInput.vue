<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    parseQuantity,
    getQuantityFeedback,
    toCompactQuantityString,
    areQuantitiesEquivalent,
    type QuantityType,
  } from './quantity-format';

  const { t } = useI18n();

  const props = withDefaults(
    defineProps<{
      modelValue: number | string | null | undefined;
      type?: QuantityType;
      placeholder?: string;
      disabled?: boolean;
      min?: number;
      showFeedback?: boolean;
      showPills?: boolean;
      compact?: boolean;
    }>(),
    {
      type: 'bytes',
      placeholder: '',
      disabled: false,
      min: 0,
      showFeedback: true,
      showPills: true,
      compact: false,
    },
  );

  const emit = defineEmits<{
    'update:modelValue': [value: number | null];
    change: [value: number | null];
  }>();

  const textValue = ref('');
  const isFocused = ref(false);

  // 初始化与外部值同步
  watch(
    () => props.modelValue,
    (newVal) => {
      // 避免用户正在输入时的光标跳动
      if (isFocused.value) return;

      if (newVal === null || newVal === undefined || newVal === '') {
        textValue.value = '';
        return;
      }

      // 核心保护：如果当前输入框解析后的数值与外部传入的数值等价，
      // 说明是内部 emit(parsed) 触发的正常回流（例如输入 100k 解析为 100000 回流），
      // 严禁将用户输入的 100k 冲写为 100000
      if (areQuantitiesEquivalent(textValue.value, newVal, props.type)) {
        return;
      }

      // 如果外部传入的是数值，或者不带单位的纯数字，自动转换为紧凑友好格式（如 100000 -> 100k）
      if (typeof newVal === 'number' || (typeof newVal === 'string' && /^\s*[+-]?\d+(?:\.\d+)?\s*$/.test(newVal))) {
        const parsed = typeof newVal === 'number' ? newVal : parseQuantity(newVal, props.type);
        textValue.value = toCompactQuantityString(parsed, props.type);
      } else {
        textValue.value = String(newVal);
      }
    },
    { immediate: true },
  );

  const parsedNumber = computed(() => {
    const parsed = parseQuantity(textValue.value, props.type);
    if (parsed === null || parsed < props.min) return null;
    return parsed;
  });

  const feedback = computed(() => {
    if (!textValue.value.trim()) return null;
    const result = getQuantityFeedback(textValue.value, props.type);
    if (result.valid && result.value !== null && result.value < props.min) {
      return { ...result, valid: false };
    }
    return result;
  });

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    textValue.value = target.value;
    emit('update:modelValue', parsedNumber.value);
  };

  const onBlur = () => {
    isFocused.value = false;
    const parsed = parsedNumber.value;
    emit('change', parsed);
  };

  const onFocus = () => {
    isFocused.value = true;
  };

  // 点击快捷单位药丸（如 K, M, G）
  const applyUnit = (unit: string) => {
    const raw = textValue.value.trim();
    if (!raw) {
      textValue.value = `1${unit}`;
    } else {
      // 严格提取纯数字部分，确保前置基数不变，仅切换或追加单位后缀
      const match = raw.match(/^([+-]?\d+(?:\.\d+)?)/);
      if (match) {
        textValue.value = `${match[1]}${unit}`;
      } else {
        textValue.value = `${raw}${unit}`;
      }
    }
    const parsed = parsedNumber.value;
    emit('update:modelValue', parsed);
    emit('change', parsed);
  };

  // 只有真正需要单位的类型才暴露快捷单位药丸；步数等纯计数值（type === 'number'）绝不附加单位药丸
  const unitPills = computed(() => {
    if (props.type === 'bytes') return ['K', 'M', 'G'];
    if (props.type === 'tokens') return ['k', 'M'];
    if (props.type === 'seconds') return ['m', 'h'];
    return [];
  });

  const hasPills = computed(() => props.showPills && unitPills.value.length > 0);

  const isPillActive = (pill: string) => {
    const raw = textValue.value.trim().toLowerCase();
    if (!raw) return false;
    return raw.endsWith(pill.toLowerCase());
  };

  const inputPlaceholder = computed(() => {
    if (props.placeholder) return props.placeholder;
    if (props.type === 'bytes') return t('agent.settings.quantity.placeholderBytes');
    if (props.type === 'tokens') return t('agent.settings.quantity.placeholderTokens');
    if (props.type === 'seconds') return t('agent.settings.quantity.placeholderSeconds');
    return t('agent.settings.quantity.placeholderNumber');
  });

  // 纯数字且输入有效时无需重复展示等号微反馈
  const shouldShowFeedback = computed(() => {
    if (!props.showFeedback || !textValue.value.trim()) return false;
    if (props.type === 'number' && feedback.value?.valid) return false;
    return true;
  });
</script>

<template>
  <div class="quantity-input-root flex flex-col gap-1 w-full">
    <div class="relative flex items-center">
      <input
        type="text"
        :value="textValue"
        :placeholder="inputPlaceholder"
        :disabled="disabled"
        data-no-highlight
        class="h-8.5 w-full rounded-lg border border-border/80 bg-card px-2.5 font-mono text-xs text-foreground placeholder:text-text-secondary/50 focus:border-border-hover focus:outline-none transition-all disabled:opacity-50"
        :class="[hasPills ? 'pr-20' : '', feedback && !feedback.valid ? 'border-error/50 focus:border-error' : '']"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
      />

      <!-- 快捷单位药丸组 -->
      <div v-if="hasPills" class="absolute right-1.5 flex items-center gap-0.5">
        <button
          v-for="pill in unitPills"
          :key="pill"
          type="button"
          tabindex="-1"
          class="inline-flex h-5 items-center justify-center rounded px-1.5 font-mono text-[10px] font-semibold text-text-secondary/80 hover:bg-header hover:text-foreground active:scale-95 transition-all cursor-pointer select-none"
          :class="{
            'bg-primary/15 text-primary font-bold ring-1 ring-primary/30 shadow-xs': isPillActive(pill),
          }"
          :disabled="disabled"
          @click.prevent="applyUnit(pill)"
        >
          {{ pill }}
        </button>
      </div>
    </div>

    <!-- 实时换算与解析微反馈 -->
    <div v-if="shouldShowFeedback" class="flex items-center justify-between px-0.5 text-[10px]">
      <span v-if="feedback?.valid" class="truncate text-text-secondary flex items-center gap-1 font-mono">
        <span class="text-primary font-semibold">≈ {{ feedback.readable }}</span>
        <span class="opacity-60">({{ feedback.exact }})</span>
      </span>
      <span v-else class="text-error font-mono">
        {{
          type === 'number'
            ? $t('agent.settings.quantity.invalidNumber')
            : $t('agent.settings.quantity.invalidQuantity')
        }}
      </span>
    </div>
  </div>
</template>
