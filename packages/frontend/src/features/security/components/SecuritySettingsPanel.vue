<script setup lang="ts">
  import ChangePasswordPanel from './ChangePasswordPanel.vue';
  import TwoFactorPanel from './TwoFactorPanel.vue';
  import PasskeyPanel from './PasskeyPanel.vue';
  import CaptchaPanel from './CaptchaPanel.vue';
  import IpAccessPanel from './IpAccessPanel.vue';
  const props = defineProps<{ twoFactorEnabled?: boolean }>();
  const emit = defineEmits<{ authChanged: [] }>();
</script>

<template>
  <div class="divide-y divide-border rounded-lg border border-border bg-background">
    <div class="p-6"><ChangePasswordPanel /></div>
    <div class="p-6"><TwoFactorPanel :enabled="props.twoFactorEnabled ?? false" @changed="emit('authChanged')" /></div>
    <div class="p-6"><PasskeyPanel /></div>
    <div class="p-6"><CaptchaPanel /></div>
    <div class="p-6"><IpAccessPanel /></div>
  </div>
</template>
