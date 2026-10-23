<script setup lang="ts">
	import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiFormActions,
		UiFormField,
		UiInfoHint,
		UiInput,
		UiModal,
		UiNumberInput,
		UiTextarea,
	} from '@/foundation/ui';
	import {
		AGENT_BROWSER_MAX_TARGETS,
		AGENT_BROWSER_MAX_ENDPOINTS,
		AGENT_BROWSER_MAX_PRIORITY,
	} from '@nexus-terminal/shared/agent/integrations/browser-values';
	import { getBrowserConfiguration, saveBrowserConfiguration } from '../api/browser-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type { BrowserConfiguration, BrowserTargetDraft, BrowserEndpointDraft } from '../model/browser-types';

	interface EndpointEditor {
		targetIndex: number;
		endpointIndex: number | null;
		draft: BrowserEndpointDraft;
	}

	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t } = useI18n();
	const version = ref<number | null>(null);
	const targets = ref<BrowserTargetDraft[]>([]);
	const targetDraft = ref<BrowserTargetDraft | null>(null);
	const endpointEditor = ref<EndpointEditor | null>(null);
	const editingIndex = ref<number | null>(null);
	const operation = useAgentManagementOperation(
		() => {
			version.value = null;
			targets.value = [];
			targetDraft.value = null;
			endpointEditor.value = null;
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

	async function persist(next: BrowserTargetDraft[]): Promise<boolean> {
		if (blocked.value || version.value === null) {
			return false;
		}
		const expectedVersion = version.value;
		await operation.execute((signal) => saveBrowserConfiguration(expectedVersion, next, signal), accept, {
			write: true,
		});
		return version.value !== expectedVersion;
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

	function targetPatterns(target: BrowserTargetDraft): string[] {
		return target.patternsText
			.split(/\r?\n/u)
			.map((pattern) => pattern.trim())
			.filter((pattern) => pattern !== '');
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

	async function removeTarget(index: number): Promise<void> {
		await persist(targets.value.filter((_, position) => position !== index).map(copyTarget));
	}

	async function removeEndpoint(targetIndex: number, endpointIndex: number): Promise<void> {
		const next = targets.value.map(copyTarget);
		next[targetIndex]?.endpoints.splice(endpointIndex, 1);
		await persist(next);
	}

	function openEndpointEditor(targetIndex: number, endpointIndex: number | null = null): void {
		if (blocked.value) return;
		const target = targets.value[targetIndex];
		if (!target) return;
		if (endpointIndex === null && target.endpoints.length >= AGENT_BROWSER_MAX_ENDPOINTS) return;
		const endpoint = endpointIndex === null ? newEndpoint() : target.endpoints[endpointIndex];
		if (!endpoint) return;
		endpointEditor.value = {
			targetIndex,
			endpointIndex,
			draft: {
				url: endpoint.url,
				priority: endpoint.priority,
				allowPlaintext: endpoint.allowPlaintext,
				verifyTls: endpoint.verifyTls,
			},
		};
	}

	function setEndpointPriority(value: string | number | null): void {
		const editor = endpointEditor.value;
		const parsed = typeof value === 'number' ? value : Number(value);
		if (!editor || !Number.isFinite(parsed)) return;
		editor.draft.priority = Math.min(AGENT_BROWSER_MAX_PRIORITY, Math.max(0, Math.trunc(parsed)));
	}

	function closeEndpointEditor(): void {
		if (!operation.busy.value) endpointEditor.value = null;
	}

	async function saveEndpoint(): Promise<void> {
		const editor = endpointEditor.value;
		if (!editor) return;
		const target = targets.value[editor.targetIndex];
		if (!target) return;
		const next = targets.value.map(copyTarget);
		const nextTarget = next[editor.targetIndex];
		if (!nextTarget) return;
		const draft = {
			url: editor.draft.url,
			priority: editor.draft.priority,
			allowPlaintext: editor.draft.allowPlaintext,
			verifyTls: editor.draft.verifyTls,
		};
		if (editor.endpointIndex === null) {
			nextTarget.endpoints.push(draft);
		} else {
			nextTarget.endpoints[editor.endpointIndex] = draft;
		}
		if (await persist(next)) endpointEditor.value = null;
	}

	function initial(): void {
		if (props.active && version.value === null) {
			void load();
		}
	}

	watch(() => props.active, initial);
	onMounted(initial);
	onActivated(async () => {
		await nextTick();
		initial();
	});
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
				type="button"
				:disabled="blocked || targets.length >= AGENT_BROWSER_MAX_TARGETS"
				@click="openTarget(null)"
			>
				<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i
				>{{ t('agent.settings.browserRuntime.addTarget') }}
			</UiButton>
		</div>
		<div
			v-if="operation.refreshRequired.value || operation.notice.value === 'failed'"
			class="space-y-2 px-4 py-3 sm:px-5"
		>
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
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 text-primary shadow-2xs"
						>
							<i class="fa-solid fa-globe text-sm" aria-hidden="true"></i>
						</div>
						<div class="min-w-0 flex-1 space-y-1.5">
							<div class="flex flex-wrap items-center gap-2">
								<span
									class="inline-flex rounded-xl border border-border/90 bg-background/90 px-3 py-1 text-sm font-bold tracking-tight text-foreground shadow-2xs sm:text-base"
									>{{ target.id }}</span
								>
								<UiBadge appearance="ghost" density="compact" class="font-mono"
									><i
										class="fa-solid fa-network-wired text-[9px] text-text-secondary/60"
										aria-hidden="true"
									></i>
									{{ target.endpoints.length }}
									{{ t('agent.settings.browserRuntime.endpoints') }}</UiBadge
								>
							</div>
							<div class="flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
								<span class="text-[11px] text-text-secondary/70">{{
									t('agent.settings.browserRuntime.allowedUrls')
								}}</span>
								<span
									v-for="pattern in targetPatterns(target).slice(0, 3)"
									:key="pattern"
									class="max-w-[200px] truncate rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
									>{{ pattern }}</span
								>
								<span
									v-if="targetPatterns(target).length > 3"
									class="font-mono text-[11px] text-text-secondary/60"
									>+{{ targetPatterns(target).length - 3 }}</span
								>
							</div>
						</div>
					</div>
					<div
						class="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/30 pt-2 sm:border-0 sm:pt-0"
					>
						<UiButton
							type="button"
							density="compact"
							:disabled="blocked || target.endpoints.length >= AGENT_BROWSER_MAX_ENDPOINTS"
							@click="openEndpointEditor(index)"
							><i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
							{{ t('agent.settings.browserRuntime.addEndpoint') }}</UiButton
						>
						<UiButton
							type="button"
							appearance="soft"
							tone="neutral"
							density="compact"
							icon-only
							:disabled="blocked"
							:title="t('common.edit')"
							:aria-label="t('common.edit')"
							@click="openTarget(index)"
							><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i
						></UiButton>
						<UiButton
							type="button"
							appearance="soft"
							tone="danger"
							density="compact"
							icon-only
							:disabled="blocked"
							:title="t('agent.settings.browserRuntime.remove')"
							:aria-label="t('agent.settings.browserRuntime.remove')"
							@click="removeTarget(index)"
							><i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i
						></UiButton>
					</div>
				</div>
				<div v-if="target.endpoints.length" class="space-y-2 border-t border-border/40 pt-2.5">
					<div
						v-for="(endpoint, endpointIndex) in target.endpoints"
						:key="endpointIndex"
						class="flex flex-col justify-between gap-2.5 rounded-xl border border-border/60 bg-header/20 p-2.5 text-xs transition-all hover:bg-header/35 sm:flex-row sm:items-center"
					>
						<div class="flex min-w-0 flex-1 items-center gap-2">
							<i
								class="fa-solid fa-link shrink-0 text-[10px] text-text-secondary/60"
								aria-hidden="true"
							></i>
							<span class="max-w-[280px] truncate font-mono text-xs text-foreground sm:max-w-[360px]">{{
								endpoint.url
							}}</span>
							<UiBadge appearance="ghost" density="compact" class="shrink-0 font-mono"
								>P{{ endpoint.priority }}</UiBadge
							>
						</div>
						<div class="flex shrink-0 items-center justify-end gap-2">
							<UiBadge v-if="endpoint.allowPlaintext" appearance="ghost" density="compact"
								>HTTP/WS</UiBadge
							>
							<UiBadge v-if="endpoint.verifyTls" tone="success" density="compact">TLS</UiBadge>
							<UiButton
								type="button"
								appearance="ghost"
								tone="neutral"
								density="compact"
								icon-only
								:disabled="blocked"
								:title="t('common.edit')"
								:aria-label="t('common.edit')"
								@click="openEndpointEditor(index, endpointIndex)"
								><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i
							></UiButton>
							<UiButton
								type="button"
								appearance="ghost"
								tone="danger"
								density="compact"
								icon-only
								:disabled="blocked"
								:title="t('agent.settings.browserRuntime.removeEndpoint')"
								:aria-label="t('agent.settings.browserRuntime.removeEndpoint')"
								@click="removeEndpoint(index, endpointIndex)"
								><i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i
							></UiButton>
						</div>
					</div>
				</div>
			</article>
			<UiButton
				type="button"
				block
				:disabled="blocked || targets.length >= AGENT_BROWSER_MAX_TARGETS"
				class="min-h-10"
				@click="openTarget(null)"
			>
				<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
				{{ t('agent.settings.browserRuntime.addTarget') }}
			</UiButton>
		</div>
	</section>
	<UiModal
		:visible="endpointEditor !== null"
		:title="
			t(
				endpointEditor?.endpointIndex === null
					? 'agent.settings.browserRuntime.addEndpoint'
					: 'agent.settings.browserRuntime.editEndpoint',
			)
		"
		panel-class="ui-form-surface !w-[calc(100vw-2rem)] !max-w-xl !p-4 sm:!p-6"
		:close-on-backdrop="!operation.busy.value"
		:close-on-escape="!operation.busy.value"
		@close="closeEndpointEditor"
	>
		<form v-if="endpointEditor" id="browser-endpoint-editor" class="space-y-4" @submit.prevent="saveEndpoint">
			<fieldset :disabled="blocked" class="space-y-4">
				<UiFormField :label="t('agent.settings.browserRuntime.url')" for-id="browser-endpoint-url">
					<UiInput id="browser-endpoint-url" v-model="endpointEditor.draft.url" required />
				</UiFormField>
				<UiFormField :label="t('agent.settings.browserRuntime.priority')" for-id="browser-endpoint-priority">
					<UiNumberInput
						id="browser-endpoint-priority"
						:model-value="endpointEditor.draft.priority"
						min="0"
						:max="AGENT_BROWSER_MAX_PRIORITY"
						step="1"
						@update:model-value="setEndpointPriority"
					/>
				</UiFormField>
				<UiCheckbox v-model="endpointEditor.draft.allowPlaintext">{{
					t('agent.settings.browserRuntime.allowPlaintext')
				}}</UiCheckbox>
				<UiCheckbox v-model="endpointEditor.draft.verifyTls">{{
					t('agent.settings.browserRuntime.verifyTls')
				}}</UiCheckbox>
			</fieldset>
		</form>
		<template #footer>
			<UiFormActions>
				<UiButton
					type="submit"
					form="browser-endpoint-editor"
					appearance="solid"
					tone="primary"
					:disabled="blocked"
					>{{ t('common.save') }}</UiButton
				>
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					:disabled="operation.busy.value"
					@click="closeEndpointEditor"
					>{{ t('common.cancel') }}</UiButton
				>
			</UiFormActions>
		</template>
	</UiModal>
	<UiModal
		:visible="targetDraft !== null"
		:title="t(editingIndex === null ? 'agent.settings.browserRuntime.addTarget' : 'common.edit')"
		panel-class="ui-form-surface !w-[calc(100vw-2rem)] !max-w-[35rem] !p-5 sm:!p-6"
		:close-on-backdrop="!operation.busy.value"
		:close-on-escape="!operation.busy.value"
		@close="closeEditor"
	>
		<template #header>
			<div class="flex min-w-0 items-center gap-3">
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-2xs"
				>
					<i class="fa-solid fa-window-maximize text-sm" aria-hidden="true"></i>
				</span>
				<div class="min-w-0">
					<h2 class="truncate text-base font-semibold tracking-tight text-foreground">
						{{ t(editingIndex === null ? 'agent.settings.browserRuntime.addTarget' : 'common.edit') }}
					</h2>
				</div>
			</div>
			<span
				class="shrink-0 rounded-lg border border-border/60 bg-header/35 px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-text-secondary"
				>CDP</span
			>
		</template>
		<form v-if="targetDraft" id="browser-target-editor" class="space-y-5" @submit.prevent="saveTarget">
			<UiButton
				v-if="operation.refreshRequired.value"
				type="button"
				:disabled="operation.busy.value"
				@click="load"
				>{{ t('agent.settings.browserRuntime.reload') }}</UiButton
			>
			<fieldset :disabled="blocked" class="space-y-5">
				<UiFormField :label="t('agent.settings.browserRuntime.targetId')" for-id="browser-target-id" required>
					<template #label>
						<span class="inline-flex items-center gap-1.5">
							<i class="fa-solid fa-fingerprint text-[10px] text-primary/80" aria-hidden="true"></i>
							{{ t('agent.settings.browserRuntime.targetId') }}
						</span>
					</template>
					<UiInput
						id="browser-target-id"
						v-model="targetDraft.id"
						autocomplete="off"
						spellcheck="false"
						required
						class="font-mono text-[13px]"
					/>
				</UiFormField>
				<UiFormField :label="t('agent.settings.browserRuntime.allowedUrls')" for-id="browser-target-patterns">
					<template #label>
						<span class="inline-flex items-center gap-1.5">
							<i class="fa-solid fa-link text-[10px] text-primary/80" aria-hidden="true"></i>
							{{ t('agent.settings.browserRuntime.allowedUrls') }}
						</span>
					</template>
					<UiTextarea
						id="browser-target-patterns"
						v-model="targetDraft.patternsText"
						:min-rows="4"
						autocomplete="off"
						spellcheck="false"
						class="font-mono text-[13px] leading-relaxed"
					/>
				</UiFormField>
			</fieldset>
		</form>
		<template #footer>
			<UiFormActions>
				<UiButton
					type="submit"
					form="browser-target-editor"
					appearance="solid"
					tone="primary"
					:disabled="blocked"
					>{{ t('agent.settings.browserRuntime.save') }}</UiButton
				>
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					:disabled="operation.busy.value"
					@click="closeEditor"
					>{{ t('common.cancel') }}</UiButton
				>
			</UiFormActions>
		</template>
	</UiModal>
</template>
