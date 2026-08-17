<script setup lang="ts">
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";

const MAX_PASSWORD_LENGTH = 128;

const props = defineProps({
  isVisible: {
    type: Boolean,
    required: true,
  },
  mode: {
    type: String as PropType<"compress" | "decompress" | null>,
    default: null,
  },
  itemCount: {
    type: Number,
    default: 0,
  },
  archiveName: {
    type: String,
    default: "",
  },
  errorMessage: {
    type: String,
    default: "",
  },
});

const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm", password: string): void;
}>();

const { t } = useI18n();
const password = ref("");
const confirmPassword = ref("");
const showPassword = ref(false);
const passwordInputRef = ref<HTMLInputElement | null>(null);
const externalErrorDismissed = ref(false);

const title = computed(() =>
  props.mode === "decompress"
    ? t(
        "fileManager.archivePassword.decompressTitle",
        "Extract password-protected ZIP",
      )
    : t(
        "fileManager.archivePassword.compressTitle",
        "Create password-protected ZIP",
      ),
);

const description = computed(() =>
  props.mode === "decompress"
    ? t("fileManager.archivePassword.decompressDescription", {
        name: props.archiveName || "ZIP",
      })
    : t("fileManager.archivePassword.compressDescription", {
        count: props.itemCount,
      }),
);

const validationMessage = computed(() => {
  if (props.errorMessage && !externalErrorDismissed.value)
    return props.errorMessage;
  if (!password.value) return "";
  if (Array.from(password.value).length > MAX_PASSWORD_LENGTH) {
    return t("fileManager.archivePassword.tooLong", {
      max: MAX_PASSWORD_LENGTH,
    });
  }
  if (/[\0\r\n]/.test(password.value)) {
    return t(
      "fileManager.archivePassword.invalidCharacters",
      "Password cannot contain line breaks or null characters.",
    );
  }
  if (
    props.mode === "compress" &&
    confirmPassword.value &&
    password.value !== confirmPassword.value
  ) {
    return t("fileManager.archivePassword.mismatch", "Passwords do not match.");
  }
  return "";
});

const isConfirmDisabled = computed(() => {
  if (!password.value || validationMessage.value) return true;
  if (props.mode === "compress" && password.value !== confirmPassword.value)
    return true;
  return false;
});

const reset = () => {
  password.value = "";
  confirmPassword.value = "";
  showPassword.value = false;
  externalErrorDismissed.value = false;
};

const close = () => {
  emit("close");
};

const confirm = () => {
  if (isConfirmDisabled.value) return;
  emit("confirm", password.value);
};

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (!props.isVisible) return;
  if (event.key === "Escape") close();
  if (event.key === "Enter" && !isConfirmDisabled.value) confirm();
};

watch(
  () => props.isVisible,
  (visible) => {
    if (visible) {
      reset();
      document.addEventListener("keydown", handleGlobalKeydown);
      void nextTick(() => passwordInputRef.value?.focus());
    } else {
      document.removeEventListener("keydown", handleGlobalKeydown);
      reset();
    }
  },
);

onUnmounted(() => document.removeEventListener("keydown", handleGlobalKeydown));
</script>

<template>
  <div
    v-if="isVisible"
    data-testid="archive-password-modal"
    :data-mode="mode || ''"
    class="fixed inset-0 bg-overlay flex items-center justify-center z-[1100] p-4"
    role="dialog"
    aria-modal="true"
    @click.self="close"
  >
    <div
      class="w-full max-w-md bg-background text-foreground border border-border rounded-lg shadow-xl p-5"
    >
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 class="text-lg font-semibold">{{ title }}</h3>
          <p class="mt-1 text-sm text-text-secondary">{{ description }}</p>
        </div>
        <button
          type="button"
          class="text-text-secondary hover:text-foreground"
          :aria-label="t('fileManager.modals.buttons.close', 'Close')"
          @click="close"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div class="space-y-4">
        <label class="block">
          <span class="block text-sm font-medium text-text-secondary mb-1">{{
            t("fileManager.archivePassword.password", "Password")
          }}</span>
          <input
            ref="passwordInputRef"
            data-testid="archive-password-input"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="
              mode === 'compress' ? 'new-password' : 'current-password'
            "
            @input="externalErrorDismissed = true"
            class="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </label>

        <label v-if="mode === 'compress'" class="block">
          <span class="block text-sm font-medium text-text-secondary mb-1">{{
            t("fileManager.archivePassword.confirmPassword", "Confirm password")
          }}</span>
          <input
            data-testid="archive-password-confirm"
            v-model="confirmPassword"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            @input="externalErrorDismissed = true"
            class="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </label>

        <label
          class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none"
        >
          <input
            v-model="showPassword"
            type="checkbox"
            class="accent-primary"
          />
          {{ t("fileManager.archivePassword.showPassword", "Show password") }}
        </label>

        <p
          v-if="validationMessage"
          class="text-sm text-error"
          data-testid="archive-password-error"
        >
          {{ validationMessage }}
        </p>
        <p class="text-xs text-text-secondary">
          {{
            t(
              "fileManager.archivePassword.compatibilityNotice",
              "Uses the remote zip/unzip command’s traditional ZIP password protection (ZipCrypto). It is widely compatible but is not strong AES encryption. The password is not saved by Nexus Terminal.",
            )
          }}
        </p>
      </div>

      <div class="mt-6 flex justify-end gap-3">
        <button
          type="button"
          class="px-4 py-2 rounded-md border border-border text-text-secondary hover:bg-border"
          @click="close"
        >
          {{ t("fileManager.modals.buttons.cancel", "Cancel") }}
        </button>
        <button
          data-testid="archive-password-submit"
          type="button"
          :disabled="isConfirmDisabled"
          class="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          @click="confirm"
        >
          {{
            mode === "decompress"
              ? t("fileManager.archivePassword.extract", "Extract")
              : t("fileManager.archivePassword.create", "Create ZIP")
          }}
        </button>
      </div>
    </div>
  </div>
</template>
