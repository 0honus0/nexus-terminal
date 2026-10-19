<script setup lang="ts">
	import { ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiTextarea } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { MUTATION_OUTCOMES } from '@nexus-terminal/shared/remote/mutations/values';
	import type { MutationOutcome } from '@nexus-terminal/shared/remote/mutations/values';
	import { useMutationRecoveryStore } from '../store/mutation-recovery.store';
	import { MutationRequestFailure, type MutationClaim } from '../model/mutation-types';
	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t } = useI18n();
	const store = useMutationRecoveryStore();
	const feedback = useFeedback();
	const draft = shallowRef<MutationClaim | null>(null);
	const resourcesStopped = ref(false);
	const producerStopped = ref(false);
	const outcome = ref<MutationOutcome | null>(null);
	const observedAt = ref('');
	const note = ref('');
	const evidenceId = ref('');
	const localBusy = ref(false);
	const message = ref('');

	function clear(): void {
		draft.value = null;
		resourcesStopped.value = false;
		producerStopped.value = false;
		outcome.value = null;
		observedAt.value = '';
		note.value = '';
		evidenceId.value = '';
		message.value = '';
	}

	const view = useAuthenticatedViewScope({
		available: () => props.active,

		onRevoke: () => {
			clear();
			localBusy.value = false;
		},
	});
	watch(
		() => store.selected,
		(value) => {
			if (!props.active) {
				return;
			}
			clear();
			draft.value = value;
		},
	);

	function failure(cause: unknown): string {
		if (cause instanceof MutationRequestFailure) {
			if (cause.outcome === 'unknown') {
				return 'mutationRecovery.unknown';
			}
			if (
				cause.code === 'version_conflict' ||
				cause.code === 'resource_active' ||
				cause.code === 'refresh_required'
			) {
				return 'mutationRecovery.refreshRequired';
			}
		}
		return 'mutationRecovery.failed';
	}

	async function run(work: (permission: AbortSignal) => Promise<void>): Promise<void> {
		const permission = view.capture();
		if (permission.aborted || localBusy.value) {
			return;
		}
		localBusy.value = true;
		message.value = '';
		try {
			await work(permission);
		} catch (cause) {
			if (view.isCurrent(permission)) {
				message.value = t(failure(cause));
			}
		} finally {
			if (view.isCurrent(permission)) {
				localBusy.value = false;
			}
		}
	}

	async function refresh(): Promise<void> {
		await run(async (permission) => {
			await store.load(permission, true);
			if (view.isCurrent(permission)) {
				clear();
				draft.value = store.selected;
			}
		});
	}

	watch(
		() => props.active,
		(active) => {
			if (active) {
				void run(async (permission) => {
					await store.load(permission);
					if (view.isCurrent(permission)) {
						draft.value = store.selected;
					}
				});
			}
		},
		{ immediate: true },
	);

	async function select(id: string): Promise<void> {
		await run((permission) => store.select(id, permission));
	}

	async function record(): Promise<void> {
		const original = draft.value;
		const selectedOutcome = outcome.value;
		if (
			!original ||
			!selectedOutcome ||
			!resourcesStopped.value ||
			!producerStopped.value ||
			!observedAt.value.trim() ||
			!note.value.trim()
		) {
			message.value = t('mutationRecovery.required');
			return;
		}
		const time = new Date(observedAt.value).getTime();
		if (!Number.isSafeInteger(time) || time < 0) {
			message.value = t('mutationRecovery.required');
			return;
		}
		const input = {
			expectedRevision: original.revision,
			outcome: selectedOutcome,
			resourcesStopped: resourcesStopped.value,
			producerStopped: producerStopped.value,
			observedAt: time,
			note: note.value,
		};
		await run((permission) => store.evidence(original, input, permission));
	}

	async function release(): Promise<void> {
		const original = draft.value;
		const id = evidenceId.value;
		if (!original || !id || !original.evidence.some((item) => item.id === id)) {
			return;
		}
		await run(async (permission) => {
			const confirmed = await feedback.confirm({
				message: t('mutationRecovery.releaseConfirm'),
				destructive: true,
				signal: permission,
			});
			if (!confirmed || !view.isCurrent(permission) || draft.value !== original) {
				return;
			}
			await store.release(original, id, permission);
		});
	}

	function setOutcome(event: Event): void {
		const target = event.target;
		if (target instanceof HTMLSelectElement) {
			outcome.value = MUTATION_OUTCOMES.find((value) => value === target.value) ?? null;
		}
	}

	function date(value: number | null): string {
		return value === null || !Number.isFinite(new Date(value).getTime()) ? '—' : new Date(value).toLocaleString();
	}
</script>

<template>
	<section class="mt-4 space-y-4 rounded-xl border border-border bg-card p-6" data-mutation-recovery>
		<h2 class="font-semibold">{{ t('mutationRecovery.title') }}</h2>
		<p>{{ t('mutationRecovery.warning') }}</p>
		<UiButton :disabled="localBusy || store.busy" @click="refresh">{{ t('mutationRecovery.refresh') }}</UiButton>
		<p v-if="store.blocked" role="status">{{ t('mutationRecovery.refreshRequired') }}</p>
		<p v-if="message" role="alert">{{ message }}</p>
		<ul class="space-y-2">
			<li v-for="item in store.items" :key="item.id">
				<UiButton :disabled="localBusy || store.busy" @click="select(item.id)"
					>{{ item.id }} · {{ t('mutationRecovery.origins.' + item.origin) }} ·
					{{ t('mutationRecovery.states.' + item.state) }} · v{{ item.revision }}</UiButton
				>
			</li>
		</ul>
		<UiButton
			v-if="store.nextCursor"
			:disabled="localBusy || store.busy || store.blocked"
			@click="run((permission) => store.load(permission, false, true))"
			>{{ t('mutationRecovery.more') }}</UiButton
		>
		<section v-if="draft" class="space-y-3" data-mutation-detail>
			<h3 class="break-all font-semibold">{{ draft.id }}</h3>
			<p>
				{{ t('mutationRecovery.states.' + draft.state) }} · v{{ draft.revision }} · {{ date(draft.createdAt) }}
			</p>
			<p>
				{{ t('mutationRecovery.recoveryAllowed') }}:
				{{ draft.recoveryAllowed ? t('common.enabled') : t('common.disabled') }}
			</p>
			<ul>
				<li v-for="target in draft.targets" :key="target.targetId" class="break-all">
					#{{ target.targetId }} · {{ target.fingerprint }}
				</li>
			</ul>
			<ul class="space-y-2">
				<li v-for="item in draft.evidence" :key="item.id" class="break-all rounded border border-border p-2">
					{{ item.id }} · {{ t('mutationRecovery.outcomes.' + item.outcome) }} · {{ date(item.observedAt) }} ·
					{{ item.note }}
				</li>
			</ul>
			<fieldset
				v-if="draft.state === 'blocked' && draft.recoveryAllowed"
				:disabled="localBusy || store.busy || store.blocked"
				class="space-y-3"
			>
				<legend>{{ t('mutationRecovery.evidence') }}</legend>
				<label class="flex items-center gap-2"
					><UiCheckbox v-model="producerStopped" :aria-label="t('mutationRecovery.producerStopped')" />{{
						t('mutationRecovery.producerStopped')
					}}</label
				>
				<label class="flex items-center gap-2"
					><UiCheckbox v-model="resourcesStopped" :aria-label="t('mutationRecovery.resourcesStopped')" />{{
						t('mutationRecovery.resourcesStopped')
					}}</label
				>
				<UiFormField for-id="mutation-outcome" :label="t('mutationRecovery.outcome')"
					><select
						id="mutation-outcome"
						:value="outcome ?? ''"
						class="border border-border bg-background p-2"
						@change="setOutcome"
					>
						<option value="" disabled>{{ t('mutationRecovery.choose') }}</option>
						<option v-for="value in MUTATION_OUTCOMES" :key="value" :value="value">
							{{ t('mutationRecovery.outcomes.' + value) }}
						</option>
					</select></UiFormField
				>
				<UiFormField for-id="mutation-observed" :label="t('mutationRecovery.observedAt')"
					><UiInput id="mutation-observed" v-model="observedAt" type="datetime-local" step="1"
				/></UiFormField>
				<UiFormField for-id="mutation-note" :label="t('mutationRecovery.note')"
					><UiTextarea id="mutation-note" v-model="note"
				/></UiFormField>
				<UiButton @click="record">{{ t('mutationRecovery.record') }}</UiButton>
				<hr class="border-border" />
				<UiFormField for-id="mutation-evidence" :label="t('mutationRecovery.selectEvidence')"
					><select id="mutation-evidence" v-model="evidenceId" class="border border-border bg-background p-2">
						<option value="" disabled>{{ t('mutationRecovery.choose') }}</option>
						<option v-for="item in draft.evidence" :key="item.id" :value="item.id">{{ item.id }}</option>
					</select></UiFormField
				>
				<UiButton :disabled="!evidenceId" tone="danger" @click="release">{{
					t('mutationRecovery.release')
				}}</UiButton>
			</fieldset>
		</section>
	</section>
</template>
