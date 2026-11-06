<script setup lang="ts">
	import ChangePasswordPanel from './ChangePasswordPanel.vue';
	import TwoFactorPanel from './TwoFactorPanel.vue';
	import PasskeyPanel from './PasskeyPanel.vue';
	import OidcPanel from './OidcPanel.vue';
	import CaptchaPanel from './CaptchaPanel.vue';

	const props = defineProps<{ twoFactorEnabled?: boolean }>();
	const emit = defineEmits<{ authChanged: [] }>();
</script>

<template>
	<div class="settings-surface">
		<div class="ui-settings-groups">
			<ChangePasswordPanel />
			<PasskeyPanel />
			<OidcPanel />
			<TwoFactorPanel :enabled="props.twoFactorEnabled ?? false" @changed="emit('authChanged')" />
			<CaptchaPanel />
		</div>
	</div>
</template>
