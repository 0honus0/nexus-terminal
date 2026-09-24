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
  <div v-if="props.section === 'security'" class="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <h2 class="border-b border-border bg-header/60 px-6 py-4 text-lg font-semibold text-foreground">
      {{ $t('settings.category.security') }}
    </h2>
    <div class="space-y-6 p-6">
      <div class="rounded-xl border border-border/80 bg-background p-5 shadow-2xs">
        <ChangePasswordPanel />
      </div>
      <div class="rounded-xl border border-border/80 bg-background p-5 shadow-2xs">
        <PasskeyPanel />
      </div>
      <div class="rounded-xl border border-border/80 bg-background p-5 shadow-2xs">
        <TwoFactorPanel :enabled="props.twoFactorEnabled ?? false" @changed="emit('authChanged')" />
      </div>
      <div class="rounded-xl border border-border/80 bg-background p-5 shadow-2xs">
        <CaptchaPanel />
      </div>
    </div>
  </div>
  <IpAccessPanel v-else />
</template>
