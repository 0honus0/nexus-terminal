<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { PluginInstallPlan } from '../model/plugin-install-plan-types';

	const props = withDefaults(defineProps<{ plan: PluginInstallPlan; showCapabilities?: boolean }>(), {
		showCapabilities: true,
	});
	const { t, te } = useI18n();
	const dependencies = computed(() =>
		props.plan.dependencies.map((dependency) => ({
			manifest: dependency.kind === 'installed' ? dependency.manifest : dependency.stage.manifest,
			source: dependency.kind === 'installed' ? null : dependency.repositoryUrl,
		})),
	);
	const capabilities = computed(() => [
		...new Set([
			...props.plan.target.stage.manifest.capabilities,
			...dependencies.value.flatMap((dependency) => dependency.manifest.capabilities),
		]),
	]);

	function capabilityName(capability: string): string {
		const key = `agent.settings.apps.capabilities.${capability}.name`;
		return te(key) ? t(key) : capability;
	}
</script>
<template>
	<div class="mt-3 space-y-2 text-xs text-text-secondary">
		<div v-if="dependencies.length" class="rounded-lg bg-header/25 p-3">
			<p class="font-medium text-foreground">{{ t('agent.settings.plugins.installDependencies') }}</p>
			<ul class="mt-2 space-y-2">
				<li v-for="dependency in dependencies" :key="dependency.manifest.id">
					<span class="font-medium"
						>{{ dependency.manifest.displayName }} · v{{ dependency.manifest.version }}</span
					>
					<div class="break-all text-[11px]">
						{{ dependency.source ?? t('agent.settings.plugins.dependencyInstalled') }}
					</div>
				</li>
			</ul>
		</div>
		<div v-if="showCapabilities && capabilities.length" class="rounded-lg bg-header/25 p-3">
			<p class="font-medium text-foreground">{{ t('agent.settings.apps.declaredCapabilities') }}</p>
			<div class="mt-2 flex flex-wrap gap-1.5">
				<span
					v-for="capability in capabilities"
					:key="capability"
					class="rounded-md border border-border/60 bg-card px-2 py-1"
					>{{ capabilityName(capability) }}</span
				>
			</div>
		</div>
	</div>
</template>
