<script setup lang="ts">
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { useNativeRuns } from '../composables/use-native-runs';
	import { isNativeRunActive, nativeModelKey } from '../model/native-run-rules';
	import NativeThreadPanel from './NativeThreadPanel.vue';
	import NativeInputArtifacts from '../files/NativeInputArtifacts.vue';
	import NativeRunDetails from '../runtime/NativeRunDetails.vue';
	import AgentMessageBody from '../ai/AgentMessageBody.vue';

	const props = defineProps<{ appId: string; appVersion: number; executionEnabled: boolean; active: boolean }>();
	const { t } = useI18n();
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
	<div class="flex h-full min-h-0 flex-col overflow-auto bg-background p-3 sm:p-4">
		<div class="grid min-h-0 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
			<aside class="space-y-3">
				<NativeThreadPanel
					:app-id="appId"
					:active="active"
					:disabled="operation.busy.value || bindingBusy || !!pending || !attachmentsReady"
					auto-load
					@select="runtime.selectThread"
					@working="threadBusy = $event"
				/>
				<p v-if="thread" class="break-all text-xs">{{ thread.title }} · {{ thread.id }}</p>
				<button :disabled="operation.busy.value || threadBusy" @click="runtime.readScope">
					{{ t('agent.nativeRun.readConfiguration') }}
				</button>
				<button v-if="thread" :disabled="operation.busy.value || threadBusy" @click="runtime.refreshThread()">
					{{ t('agent.nativeRun.readRuns') }}
				</button>
				<ul class="max-h-60 space-y-1 overflow-auto text-xs">
					<li v-for="item in runs" :key="item.id">
						<button
							class="w-full break-all rounded border p-2 text-left"
							:disabled="operation.busy.value || !!pending"
							@click="runtime.selectRun(item)"
						>
							{{ t('agent.nativeRun.states.' + item.status) }} · {{ item.id }}
						</button>
					</li>
				</ul>
				<button
					v-if="hasMoreRuns"
					:disabled="operation.busy.value || !!pending"
					@click="runtime.refreshThread(true)"
				>
					{{ t('agent.nativeRun.moreRuns') }}
				</button>
			</aside>
			<main class="min-w-0 space-y-4">
				<p v-if="!executionEnabled" role="status">{{ t('agent.nativeRun.executionDisabled') }}</p>
				<p v-if="operation.notice.value" role="status">
					{{ t('agent.settings.appManagement.' + operation.notice.value) }}
				</p>
				<section v-if="pending" class="space-y-2 rounded border border-warning p-3">
					<p>{{ t('agent.nativeRun.unknown') }}</p>
					<code class="break-all text-xs">{{ pending.operationId }}</code>
					<div class="flex flex-wrap gap-3">
						<button :disabled="operation.busy.value" @click="runtime.inspectIntent">
							{{ t('agent.nativeRun.inspect') }}</button
						><button
							:disabled="operation.busy.value || !inspected || operation.refreshRequired.value"
							@click="runtime.mutate(null, true)"
						>
							{{ t('agent.nativeThreads.retry') }}
						</button>
					</div>
					<label class="flex gap-2"
						><input v-model="acknowledged" type="checkbox" :disabled="operation.busy.value" />{{
							t('agent.nativeRun.acknowledge')
						}}</label
					><button :disabled="operation.busy.value || !inspected || !acknowledged" @click="runtime.abandon">
						{{ t('agent.nativeThreads.abandon') }}
					</button>
				</section>
				<section v-if="thread" class="space-y-3">
					<h3 class="font-medium">{{ t('agent.nativeRun.conversation') }}</h3>
					<p v-if="olderHidden" role="status" class="text-xs">{{ t('agent.nativeRun.windowed') }}</p>
					<div class="max-h-[50vh] space-y-3 overflow-auto" aria-live="polite">
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
							class="rounded border border-border p-3"
						>
							<p class="mb-1 text-xs text-text-secondary">
								{{ t('agent.nativeRun.roles.' + entry.role) }} · {{ entry.runId }}
							</p>
							<AgentMessageBody :text="entry.text" />
						</article>
					</div>
					<button :disabled="operation.busy.value || threadBusy" @click="runtime.readEntries">
						{{ t('agent.nativeRun.moreBody') }}
					</button>
					<form class="space-y-2 rounded border border-border p-3" @submit.prevent="runtime.send(false)">
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
							<button
								:disabled="
									blocked ||
									!executionEnabled ||
									!attachmentsReady ||
									!scope ||
									!modelKey ||
									!draft.trim()
								"
							>
								{{ t('agent.nativeRun.create') }}</button
							><button
								v-if="run && !isNativeRunActive(run)"
								type="button"
								:disabled="
									blocked || !executionEnabled || !attachmentsReady || !modelKey || !draft.trim()
								"
								@click="runtime.send(true)"
							>
								{{ t('agent.nativeRun.followUp') }}
							</button>
						</div>
					</form>
				</section>
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
			</main>
		</div>
	</div>
</template>
