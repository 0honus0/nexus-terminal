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
	<div v-if="props.section === 'security'" class="settings-surface">
		<div class="ui-settings-groups">
			<ChangePasswordPanel />
			<PasskeyPanel />
			<TwoFactorPanel :enabled="props.twoFactorEnabled ?? false" @changed="emit('authChanged')" />
			<CaptchaPanel />
		</div>
	</div>
	<IpAccessPanel v-else />
</template>
