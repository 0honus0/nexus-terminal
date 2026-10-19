<script setup lang="ts">
	import { computed, onActivated, onMounted, ref, toRaw } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import {
		AGENT_BROWSER_MAX_TARGETS,
		AGENT_BROWSER_MAX_ENDPOINTS,
		AGENT_BROWSER_MAX_PRIORITY,
	} from '@nexus-terminal/shared/agent/integrations/browser-values';
	import { getBrowserConfiguration, saveBrowserConfiguration } from '../api/browser-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type { BrowserConfiguration, BrowserTargetDraft } from '../model/browser-types';

	const { t } = useI18n();
	const version = ref<number | null>(null);
	const targets = ref<BrowserTargetDraft[]>([]);
	const operation = useAgentManagementOperation(() => {
		version.value = null;
		targets.value = [];
	});
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || version.value === null);

	function accept(value: BrowserConfiguration): void {
		version.value = value.version;
		targets.value = value.targets;
	}

	async function load(): Promise<void> {
		await operation.execute(getBrowserConfiguration, accept, { write: false });
	}

	async function save(): Promise<void> {
		if (version.value === null) {
			return;
		}
		const expectedVersion = version.value;
		const draft = structuredClone(toRaw(targets.value));
		await operation.execute((signal) => saveBrowserConfiguration(expectedVersion, draft, signal), accept, {
			write: true,
		});
	}

	function newEndpoint() {
		return { url: 'ws://127.0.0.1:9222', priority: 10, allowPlaintext: true, verifyTls: true };
	}

	function addTarget(): void {
		if (blocked.value || targets.value.length >= AGENT_BROWSER_MAX_TARGETS) {
			return;
		}
		let index = 1;
		while (targets.value.some((target) => target.id === `browser-${index}`)) {
			index += 1;
		}
		targets.value.push({
			id: `browser-${index}`,
			patternsText: 'https://example.com/*',
			endpoints: [newEndpoint()],
		});
	}

	function initial(): void {
		if (version.value === null) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
</script>

<template>
	<section
		class="space-y-4 rounded-xl border border-border bg-card p-4"
		:aria-label="t('agent.settings.browserRuntime.title')"
	>
		<h3 class="font-medium">
			{{ t('agent.settings.browserRuntime.title') }} <span v-if="version !== null">v{{ version }}</span>
		</h3>
		<p class="text-sm text-text-secondary">{{ t('agent.settings.browserRuntime.description') }}</p>
		<p class="text-sm text-text-secondary">{{ t('agent.settings.browserRuntime.configurationHelp') }}</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="operation.refreshRequired.value" class="text-sm text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<UiButton type="button" :disabled="operation.busy.value" @click="load">{{
			t('agent.settings.browserRuntime.reload')
		}}</UiButton>
		<fieldset :disabled="blocked" class="space-y-4">
			<p v-if="targets.length === 0" class="text-sm text-text-secondary">
				{{ t('agent.settings.browserRuntime.empty') }}
			</p>
			<article v-for="(target, index) in targets" :key="index" class="space-y-3 rounded border border-border p-3">
				<label class="block text-sm"
					>{{ t('agent.settings.browserRuntime.targetId')
					}}<input v-model="target.id" class="mt-1 w-full rounded border border-border bg-background p-2"
				/></label>
				<label class="block text-sm"
					>{{ t('agent.settings.browserRuntime.allowedUrls')
					}}<textarea
						v-model="target.patternsText"
						rows="3"
						class="mt-1 w-full rounded border border-border bg-background p-2 font-mono"
					/>
				</label>
				<div
					v-for="(endpoint, endpointIndex) in target.endpoints"
					:key="endpointIndex"
					class="space-y-2 border-t border-border pt-3"
				>
					<label class="block text-sm"
						>{{ t('agent.settings.browserRuntime.url')
						}}<input
							v-model="endpoint.url"
							class="mt-1 w-full rounded border border-border bg-background p-2 font-mono"
					/></label>
					<label class="block text-sm"
						>{{ t('agent.settings.browserRuntime.priority')
						}}<input
							v-model.number="endpoint.priority"
							type="number"
							min="0"
							:max="AGENT_BROWSER_MAX_PRIORITY"
							step="1"
							class="ml-2 rounded border border-border bg-background p-2"
					/></label>
					<UiCheckbox v-model="endpoint.allowPlaintext">{{
						t('agent.settings.browserRuntime.allowPlaintext')
					}}</UiCheckbox>
					<UiCheckbox v-model="endpoint.verifyTls">{{
						t('agent.settings.browserRuntime.verifyTls')
					}}</UiCheckbox>
					<UiButton
						type="button"
						:disabled="target.endpoints.length <= 1"
						@click="target.endpoints.splice(endpointIndex, 1)"
						>{{ t('agent.settings.browserRuntime.removeEndpoint') }}</UiButton
					>
				</div>
				<div class="flex flex-wrap gap-2">
					<UiButton
						type="button"
						:disabled="target.endpoints.length >= AGENT_BROWSER_MAX_ENDPOINTS"
						@click="target.endpoints.push(newEndpoint())"
						>{{ t('agent.settings.browserRuntime.addEndpoint') }}</UiButton
					>
					<UiButton type="button" @click="targets.splice(index, 1)">{{
						t('agent.settings.browserRuntime.remove')
					}}</UiButton>
				</div>
			</article>
			<div class="flex flex-wrap gap-2">
				<UiButton type="button" :disabled="targets.length >= AGENT_BROWSER_MAX_TARGETS" @click="addTarget">{{
					t('agent.settings.browserRuntime.addTarget')
				}}</UiButton>
				<UiButton type="button" @click="save">{{ t('agent.settings.browserRuntime.save') }}</UiButton>
			</div>
		</fieldset>
	</section>
</template>
