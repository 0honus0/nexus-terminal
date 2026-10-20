<script setup lang="ts">
	import { onBeforeUnmount, onMounted, ref } from 'vue';
	import { UiButton } from '@/foundation/ui';
	import { useI18n } from 'vue-i18n';
	import { useNativeRuns } from '../composables/use-native-runs';
	import { isNativeRunActive, nativeModelKey } from '../model/native-run-rules';
	import NativeThreadPanel from './NativeThreadPanel.vue';
	import NativeInputArtifacts from '../files/NativeInputArtifacts.vue';
	import NativeRunDetails from '../runtime/NativeRunDetails.vue';
	import AgentMessageBody from '../ai/AgentMessageBody.vue';

	const props = defineProps<{ appId: string; appVersion: number; executionEnabled: boolean; active: boolean }>();
	const { t } = useI18n();
	const layoutRoot = ref<HTMLElement | null>(null);
	const threadsOverlay = ref(false);
	const threadSidebarVisible = ref(true);
	const threadDrawerOpen = ref(false);
	let layoutObserver: ResizeObserver | null = null;

	onMounted(() => {
		if (!layoutRoot.value) {
			return;
		}
		threadsOverlay.value = layoutRoot.value.clientWidth <= 760;
		layoutObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				threadsOverlay.value = entry.contentRect.width <= 760;
			}
		});
		layoutObserver.observe(layoutRoot.value);
	});
	onBeforeUnmount(() => layoutObserver?.disconnect());

	const threadBusy = ref(false);
	const bindingBusy = ref(false);
	const runtime = useNativeRuns(
		props.appId,
		() => props.active,
		() => threadBusy.value || bindingBusy.value,
		() => props.executionEnabled,
	);
	const {
		operation,
		scope,
		thread,
		models,
		modelKey,
		connections,
		connectionIds,
		draft,
		runs,
		hasMoreRuns,
		run,
		entries,
		events,
		approvals,
		children,
		child,
		messages,
		pending,
		inspected,
		acknowledged,
		olderHidden,
		blocked,
		inputArtifacts,
		attachmentsReady,
	} = runtime;
</script>
<template>
	<div
		ref="layoutRoot"
		class="agent-surface-layout relative grid h-full min-h-0"
		:class="{ 'is-threads-hidden': !threadSidebarVisible }"
	>
		<aside
			id="agent-thread-sidebar"
			class="agent-thread-sidebar flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-border/45 bg-header/30 p-3 backdrop-blur-xs"
			:class="{ 'is-open': threadDrawerOpen }"
			:inert="threadsOverlay ? !threadDrawerOpen : !threadSidebarVisible"
		>
			<NativeThreadPanel
				:app-id="appId"
				:active="active"
				:disabled="operation.busy.value || bindingBusy || !!pending || !attachmentsReady"
				auto-load
				@select="
					(selected) => {
						threadDrawerOpen = false;
						runtime.selectThread(selected);
					}
				"
				@working="threadBusy = $event"
			/>

			<UiButton
				v-if="operation.refreshRequired.value || operation.notice.value === 'failed'"
				:disabled="operation.busy.value || threadBusy"
				@click="runtime.readScope"
			>
				{{ t('agent.nativeRun.readConfiguration') }}
			</UiButton>
			<UiButton v-if="thread" :disabled="operation.busy.value || threadBusy" @click="runtime.refreshThread()">
				{{ t('agent.nativeRun.readRuns') }}
			</UiButton>
			<ul class="max-h-60 space-y-1 overflow-auto text-xs">
				<li v-for="item in runs" :key="item.id">
					<UiButton
						class="w-full break-all rounded border p-2 text-left"
						:disabled="operation.busy.value || !!pending"
						@click="runtime.selectRun(item)"
					>
						{{ t('agent.nativeRun.states.' + item.status) }} · {{ item.id }}
					</UiButton>
				</li>
			</ul>
			<UiButton
				v-if="hasMoreRuns"
				:disabled="operation.busy.value || !!pending"
				@click="runtime.refreshThread(true)"
			>
				{{ t('agent.nativeRun.moreRuns') }}
			</UiButton>
		</aside>
		<main class="agent-conversation-pane flex min-h-0 min-w-0 flex-col overflow-y-auto bg-background">
			<header
				class="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-header/40 px-3.5 backdrop-blur-xs"
			>
				<button
					type="button"
					class="agent-thread-toggle flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card/60 text-text-secondary hover:bg-header hover:text-foreground"
					:aria-expanded="threadsOverlay ? threadDrawerOpen : threadSidebarVisible"
					aria-controls="agent-thread-sidebar"
					:aria-label="t('agent.operations.openThreads')"
					@click="
						threadsOverlay
							? (threadDrawerOpen = !threadDrawerOpen)
							: (threadSidebarVisible = !threadSidebarVisible)
					"
				>
					<i class="fa-regular fa-comments text-xs" aria-hidden="true"></i>
				</button>
				<span class="truncate text-xs font-semibold tracking-tight text-foreground">{{
					thread?.title || t('agent.operations.untitledThread')
				}}</span>
				<span
					v-if="run"
					class="ml-auto shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
					>{{ t('agent.nativeRun.states.' + run.status) }}</span
				>
			</header>
			<div class="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
				<p v-if="!executionEnabled" role="status">{{ t('agent.nativeRun.executionDisabled') }}</p>
				<p v-if="operation.notice.value" role="status">
					{{ t('agent.settings.appManagement.' + operation.notice.value) }}
				</p>
				<section v-if="pending" class="space-y-2 rounded border border-warning p-3">
					<p>{{ t('agent.nativeRun.unknown') }}</p>
					<code class="break-all text-xs">{{ pending.operationId }}</code>
					<div class="flex flex-wrap gap-3">
						<UiButton :disabled="operation.busy.value" @click="runtime.inspectIntent">
							{{ t('agent.nativeRun.inspect') }}</UiButton
						><UiButton
							:disabled="operation.busy.value || !inspected || operation.refreshRequired.value"
							@click="runtime.mutate(null, true)"
						>
							{{ t('agent.nativeThreads.retry') }}
						</UiButton>
					</div>
					<label class="flex gap-2"
						><input v-model="acknowledged" type="checkbox" :disabled="operation.busy.value" />{{
							t('agent.nativeRun.acknowledge')
						}}</label
					><UiButton :disabled="operation.busy.value || !inspected || !acknowledged" @click="runtime.abandon">
						{{ t('agent.nativeThreads.abandon') }}
					</UiButton>
				</section>
				<section v-if="thread" class="flex min-h-0 flex-1 flex-col gap-3">
					<p v-if="olderHidden" role="status" class="text-xs">{{ t('agent.nativeRun.windowed') }}</p>
					<div
						class="agent-conversation-scroller min-h-48 flex-1 space-y-3 overflow-y-auto overscroll-contain px-2 py-4 touch-pan-y"
						aria-live="polite"
					>
						<article
							v-for="entry in entries"
							:key="
								[
									entry.position.runSequence,
									entry.position.stepIndex,
									entry.position.eventSequence,
									entry.position.textOffset,
								].join(':')
							"
							class="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-card/70 p-4 shadow-2xs"
						>
							<p class="mb-1 text-xs text-text-secondary">
								{{ t('agent.nativeRun.roles.' + entry.role) }}
							</p>
							<AgentMessageBody :text="entry.text" />
						</article>
					</div>
					<UiButton :disabled="operation.busy.value || threadBusy" @click="runtime.readEntries">
						{{ t('agent.nativeRun.moreBody') }}
					</UiButton>
					<form
						class="agent-composer-shell shrink-0 space-y-2 rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm"
						@submit.prevent="runtime.send(false)"
					>
						<label class="block text-sm"
							>{{ t('agent.nativeRun.model')
							}}<select
								v-model="modelKey"
								class="ml-2 max-w-full rounded border bg-background p-2"
								:disabled="blocked"
							>
								<option value="">{{ t('agent.nativeRun.chooseModel') }}</option>
								<option
									v-for="model in models"
									:key="nativeModelKey(model)"
									:value="nativeModelKey(model)"
								>
									{{ model.providerName }} / {{ model.modelId }} · v{{ model.configurationVersion }}
								</option>
							</select></label
						>
						<fieldset :disabled="blocked" class="max-h-32 overflow-auto text-xs">
							<legend>{{ t('agent.nativeRun.targets') }}</legend>
							<label v-for="connection in connections" :key="connection.id" class="mr-3 inline-flex gap-1"
								><input v-model="connectionIds" type="checkbox" :value="connection.id" />{{
									connection.name
								}}</label
							>
						</fieldset>
						<p class="text-xs text-text-secondary">{{ t('agent.nativeRun.targetHelp') }}</p>
						<textarea
							v-model="draft"
							rows="4"
							class="w-full rounded border bg-background p-2"
							:disabled="blocked"
							:aria-label="t('agent.nativeRun.prompt')"
							required
						/>
						<p class="text-xs text-text-secondary">{{ t('agent.nativeRun.attachmentHelp') }}</p>
						<NativeInputArtifacts
							:key="thread.id"
							:app-id="appId"
							:thread-id="thread.id"
							:active="active"
							:disabled="blocked"
							@working="bindingBusy = $event"
							@ready="
								(ready, references) => {
									attachmentsReady = ready;
									inputArtifacts = references;
								}
							"
						/>
						<div class="flex flex-wrap gap-3">
							<UiButton
								type="submit"
								appearance="solid"
								tone="primary"
								:disabled="
									blocked ||
									!executionEnabled ||
									!attachmentsReady ||
									!scope ||
									!modelKey ||
									!draft.trim()
								"
							>
								{{ t('agent.nativeRun.create') }}</UiButton
							><UiButton
								v-if="run && !isNativeRunActive(run)"
								type="button"
								:disabled="
									blocked || !executionEnabled || !attachmentsReady || !modelKey || !draft.trim()
								"
								@click="runtime.send(true)"
							>
								{{ t('agent.nativeRun.followUp') }}
							</UiButton>
						</div>
					</form>
				</section>
				<div class="max-h-[45vh] shrink-0 overflow-y-auto">
					<NativeRunDetails
						v-if="run"
						:key="run.id"
						:app-id="appId"
						:run="run"
						:events="events"
						:approvals="approvals"
						:children="children"
						:child="child"
						:messages="messages"
						:active="active"
						:disabled="blocked"
						@refresh="runtime.refreshRun"
						@mutate="runtime.mutate($event)"
						@messages="runtime.readMessages"
					/>
				</div>
			</div>
		</main>
		<button
			v-if="threadsOverlay && threadDrawerOpen"
			type="button"
			class="agent-thread-backdrop absolute inset-0 z-20 bg-black/20"
			:aria-label="t('common.close')"
			@click="threadDrawerOpen = false"
		></button>
	</div>
</template>

<style scoped src="./AgentAppSurface.css"></style>
