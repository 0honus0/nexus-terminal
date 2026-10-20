<script setup lang="ts">
	import { computed, onActivated, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiInfoHint, UiInput, UiModal, UiTextarea } from '@/foundation/ui';
	import {
		AGENT_BROWSER_MAX_TARGETS,
		AGENT_BROWSER_MAX_ENDPOINTS,
		AGENT_BROWSER_MAX_PRIORITY,
	} from '@nexus-terminal/shared/agent/integrations/browser-values';
	import { getBrowserConfiguration, saveBrowserConfiguration } from '../api/browser-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type { BrowserConfiguration, BrowserTargetDraft, BrowserEndpointDraft } from '../model/browser-types';

	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t } = useI18n();
	const version = ref<number | null>(null);
	const targets = ref<BrowserTargetDraft[]>([]);
	const targetDraft = ref<BrowserTargetDraft | null>(null);
	const editingIndex = ref<number | null>(null);
	const operation = useAgentManagementOperation(
		() => {
			version.value = null;
			targets.value = [];
			targetDraft.value = null;
			editingIndex.value = null;
		},
		() => props.active,
	);
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || version.value === null);

	function copyTarget(target: BrowserTargetDraft): BrowserTargetDraft {
		return {
			id: target.id,
			patternsText: target.patternsText,
			endpoints: target.endpoints.map((endpoint) => ({
				url: endpoint.url,
				priority: endpoint.priority,
				allowPlaintext: endpoint.allowPlaintext,
				verifyTls: endpoint.verifyTls,
			})),
		};
	}

	function accept(value: BrowserConfiguration): void {
		version.value = value.version;
		targets.value = value.targets;
		targetDraft.value = null;
		editingIndex.value = null;
	}

	async function load(): Promise<void> {
		await operation.execute(getBrowserConfiguration, accept, { write: false });
	}

	async function persist(next: BrowserTargetDraft[]): Promise<void> {
		if (blocked.value || version.value === null) {
			return;
		}
		const expectedVersion = version.value;
		await operation.execute((signal) => saveBrowserConfiguration(expectedVersion, next, signal), accept, {
			write: true,
		});
	}

	function newEndpoint(): BrowserEndpointDraft {
		return { url: 'ws://127.0.0.1:9222', priority: 10, allowPlaintext: true, verifyTls: true };
	}

	function openTarget(index: number | null): void {
		if (blocked.value) {
			return;
		}
		if (index !== null) {
			const target = targets.value[index];
			if (!target) {
				return;
			}
			targetDraft.value = copyTarget(target);
		} else {
			if (targets.value.length >= AGENT_BROWSER_MAX_TARGETS) {
				return;
			}
			let suffix = 1;
			while (targets.value.some((target) => target.id === `browser-${suffix}`)) {
				suffix += 1;
			}
			targetDraft.value = {
				id: `browser-${suffix}`,
				patternsText: 'https://example.com/*',
				endpoints: [newEndpoint()],
			};
		}
		editingIndex.value = index;
	}

	function closeEditor(): void {
		if (!operation.busy.value) {
			targetDraft.value = null;
			editingIndex.value = null;
		}
	}

	async function saveTarget(): Promise<void> {
		if (!targetDraft.value) {
			return;
		}
		const draft = copyTarget(targetDraft.value);
		const next = targets.value.map(copyTarget);
		if (editingIndex.value === null) {
			next.push(draft);
		} else {
			next[editingIndex.value] = draft;
		}
		await persist(next);
	}

	function removeTarget(index: number): Promise<void> {
		return persist(targets.value.filter((_, position) => position !== index).map(copyTarget));
	}

	function initial(): void {
		if (props.active && version.value === null) {
			void load();
		}
	}

	watch(() => props.active, initial);
	onMounted(initial);
	onActivated(initial);
</script>

<template>
	<section
		class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all"
		:aria-label="t('agent.settings.browserRuntime.title')"
	>
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 rounded-t-2xl bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5"
			:class="{ 'border-b border-border': targets.length > 0 }"
		>
			<div class="flex items-center gap-2">
				<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.browserRuntime.title') }}</h3>
				<span
					v-if="targets.length"
					class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
					>{{ targets.length }}</span
				>
				<UiInfoHint :text="t('agent.settings.browserRuntime.description')" />
			</div>
			<UiButton
				appearance="soft"
				tone="neutral"
				type="button"
				:disabled="blocked || targets.length >= AGENT_BROWSER_MAX_TARGETS"
				@click="openTarget(null)"
			>
				<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i
				>{{ t('agent.settings.browserRuntime.addTarget') }}
			</UiButton>
		</div>
		<div v-if="operation.notice.value || operation.refreshRequired.value" class="space-y-2 px-4 py-3 sm:px-5">
			<p v-if="operation.notice.value" role="status" class="text-sm">
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<p v-if="operation.refreshRequired.value && !operation.busy.value" class="text-sm text-warning">
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>
			<UiButton
				v-if="operation.refreshRequired.value || operation.notice.value === 'failed'"
				type="button"
				:disabled="operation.busy.value"
				@click="load"
				>{{ t('agent.settings.browserRuntime.reload') }}</UiButton
			>
		</div>
		<div v-if="targets.length" class="space-y-3.5 p-4 sm:p-5">
			<article
				v-for="(target, index) in targets"
				:key="target.id"
				class="space-y-3.5 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-2xs transition-all hover:bg-card/95"
			>
				<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
					<div class="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-2xs"
						>
							<i class="fa-solid fa-globe text-sm" aria-hidden="true"></i>
						</div>
						<div class="min-w-0 flex-1 space-y-1.5">
							<span
								class="inline-flex rounded-xl border border-border/90 bg-background/90 px-3 py-1 text-sm font-bold tracking-tight text-foreground shadow-2xs"
								>{{ target.id }}</span
							>
							<p class="break-words text-xs text-text-secondary">{{ target.patternsText }}</p>
							<p
								v-for="endpoint in target.endpoints"
								:key="endpoint.url"
								class="break-all font-mono text-xs text-text-secondary"
							>
								{{ endpoint.url }}
							</p>
						</div>
					</div>
					<div class="flex shrink-0 justify-end gap-1.5">
						<UiButton type="button" appearance="soft" :disabled="blocked" @click="openTarget(index)"
							><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i>{{ t('common.edit') }}</UiButton
						>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							:disabled="blocked"
							@click="removeTarget(index)"
							><i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i
							>{{ t('common.delete') }}</UiButton
						>
					</div>
				</div>
			</article>
		</div>
	</section>
	<UiModal
		:visible="targetDraft !== null"
		:title="t(editingIndex === null ? 'agent.settings.browserRuntime.addTarget' : 'common.edit')"
		panel-class="w-[min(680px,94vw)]"
		:close-on-backdrop="!operation.busy.value"
		:close-on-escape="!operation.busy.value"
		@close="closeEditor"
	>
		<form v-if="targetDraft" id="browser-target-editor" class="space-y-4" @submit.prevent="saveTarget">
			<p class="text-sm text-text-secondary">{{ t('agent.settings.browserRuntime.configurationHelp') }}</p>
			<p v-if="operation.notice.value" role="status" class="text-sm">
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<UiButton
				v-if="operation.refreshRequired.value"
				type="button"
				:disabled="operation.busy.value"
				@click="load"
				>{{ t('agent.settings.browserRuntime.reload') }}</UiButton
			>
			<fieldset :disabled="blocked" class="space-y-4">
				<label class="block space-y-1 text-sm"
					><span>{{ t('agent.settings.browserRuntime.targetId') }}</span
					><UiInput v-model="targetDraft.id" required
				/></label>
				<label class="block space-y-1 text-sm"
					><span>{{ t('agent.settings.browserRuntime.allowedUrls') }}</span
					><UiTextarea v-model="targetDraft.patternsText" :min-rows="3"
				/></label>
				<div
					v-for="(endpoint, index) in targetDraft.endpoints"
					:key="index"
					class="space-y-3 rounded-xl border border-border bg-header/20 p-3"
				>
					<label class="block space-y-1 text-sm"
						><span>{{ t('agent.settings.browserRuntime.url') }}</span
						><UiInput v-model="endpoint.url" required
					/></label>
					<label class="block space-y-1 text-sm"
						><span>{{ t('agent.settings.browserRuntime.priority') }}</span
						><input
							v-model.number="endpoint.priority"
							type="number"
							min="0"
							:max="AGENT_BROWSER_MAX_PRIORITY"
							step="1"
							class="w-full rounded border border-border bg-background p-2"
					/></label>
					<UiCheckbox v-model="endpoint.allowPlaintext">{{
						t('agent.settings.browserRuntime.allowPlaintext')
					}}</UiCheckbox>
					<UiCheckbox v-model="endpoint.verifyTls">{{
						t('agent.settings.browserRuntime.verifyTls')
					}}</UiCheckbox>
					<UiButton
						type="button"
						appearance="ghost"
						tone="danger"
						:disabled="targetDraft.endpoints.length <= 1"
						@click="targetDraft.endpoints.splice(index, 1)"
						>{{ t('agent.settings.browserRuntime.removeEndpoint') }}</UiButton
					>
				</div>
				<UiButton
					type="button"
					:disabled="targetDraft.endpoints.length >= AGENT_BROWSER_MAX_ENDPOINTS"
					@click="targetDraft.endpoints.push(newEndpoint())"
					>{{ t('agent.settings.browserRuntime.addEndpoint') }}</UiButton
				>
			</fieldset>
		</form>
		<template #footer>
			<div class="flex justify-end gap-2">
				<UiButton type="button" :disabled="operation.busy.value" @click="closeEditor">{{
					t('common.cancel')
				}}</UiButton>
				<UiButton
					type="submit"
					form="browser-target-editor"
					appearance="solid"
					tone="primary"
					:disabled="blocked"
					>{{ t('agent.settings.browserRuntime.save') }}</UiButton
				>
			</div>
		</template>
	</UiModal>
</template>
