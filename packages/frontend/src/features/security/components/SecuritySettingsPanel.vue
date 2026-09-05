<script setup lang="ts">
  import ChangePasswordPanel from './ChangePasswordPanel.vue';
  import TwoFactorPanel from './TwoFactorPanel.vue';
  import PasskeyPanel from './PasskeyPanel.vue';
  import CaptchaPanel from './CaptchaPanel.vue';
  import IpAccessPanel from './IpAccessPanel.vue';

  const props = withDefaults(defineProps<{ twoFactorEnabled?: boolean; section?: 'security' | 'ipControl' }>(), {
    section: 'security',
  });
  const emit = defineEmits<{ authChanged: [] }>();
</script>

<template>
  <div
    v-if="props.section === 'security'"
    class="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
  >
    <h2 class="border-b border-border bg-header/50 px-6 py-4 text-lg font-semibold text-foreground">
      {{ $t('settings.category.security') }}
    </h2>
    <div class="space-y-6 p-6">
      <ChangePasswordPanel />
      <hr class="border-border/50" />
      <PasskeyPanel />
      <hr class="border-border/50" />
      <TwoFactorPanel :enabled="props.twoFactorEnabled ?? false" @changed="emit('authChanged')" />
      <hr class="border-border/50" />
      <CaptchaPanel />
    </div>
  </div>
  <IpAccessPanel v-else />
</template>
