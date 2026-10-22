<script setup lang="ts">
	import { ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiEmptyState,
		UiFormField,
		UiInput,
		UiSelect,
		UiSettingsGroup,
		UiTextarea,
	} from '@/foundation/ui';
	import type { UiSelectValue } from '@/foundation/ui';
	import { useFeedback, useSettingsReloadSource, useFeedbackMessage } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { MUTATION_OUTCOMES } from '@nexus-terminal/shared/remote/mutations/values';
	import type { MutationOutcome } from '@nexus-terminal/shared/remote/mutations/values';
	import { useMutationRecoveryStore } from '../store/mutation-recovery.store';
	import { MutationRequestFailure, type MutationClaim } from '../model/mutation-types';
	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t, locale } = useI18n();
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
	let failureCause: unknown;
	useFeedbackMessage(
		() => message.value,
		undefined,
		() => failureCause,
	);

	function clear(): void {
		draft.value = null;
		resourcesStopped.value = false;
		producerStopped.value = false;
		outcome.value = null;
		observedAt.value = '';
		note.value = '';
		evidenceId.value = '';
		message.value = '';
		failureCause = undefined;
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
		failureCause = undefined;
		try {
			await work(permission);
		} catch (cause) {
			if (view.isCurrent(permission)) {
				failureCause = cause;
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

	useSettingsReloadSource({
		id: 'system-mutation-recovery',

		pending: () => !localBusy.value && !store.busy && store.blocked,

		reload: refresh,
	});

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
			failureCause = undefined;
			message.value = t('mutationRecovery.required');
			return;
		}
		const time = new Date(observedAt.value).getTime();
		if (!Number.isSafeInteger(time) || time < 0) {
			failureCause = undefined;
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

	function setOutcome(value: UiSelectValue): void {
		outcome.value = MUTATION_OUTCOMES.find((item) => item === value) ?? null;
	}

	function setEvidenceId(value: UiSelectValue): void {
		evidenceId.value = typeof value === 'string' ? value : '';
	}

	function date(value: number | null): string {
		return value === null || !Number.isFinite(new Date(value).getTime())
			? '—'
			: new Date(value).toLocaleString(locale.value);
	}

	function stateTone(state: MutationClaim['state']): 'success' | 'warning' | 'neutral' {
		if (state === 'released') return 'success';
		if (state === 'blocked') return 'warning';
		return 'neutral';
	}

	function outcomeTone(outcome: MutationClaim['evidence'][number]['outcome']): 'success' | 'warning' | 'neutral' {
		if (outcome === 'applied') return 'success';
		if (outcome === 'partially_applied') return 'warning';
		return 'neutral';
	}
</script>

<template>
	<UiSettingsGroup
		:title="t('mutationRecovery.title')"
		icon="fa-solid fa-shield-halved"
		tone="warning"
		data-mutation-recovery
	>
		<template #actions>
			<UiBadge v-if="store.blocked" tone="warning" density="compact">
				{{ t('mutationRecovery.blockedBadge') }}
			</UiBadge>
			<UiBadge v-else-if="store.items.length" tone="neutral" density="compact">
				{{ t('mutationRecovery.itemCount', { count: store.items.length }) }}
			</UiBadge>
		</template>

		<div class="mutation-recovery">
			<div class="mutation-recovery__notice">
				<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
				<span>{{ t('mutationRecovery.warning') }}</span>
			</div>
			<section class="mutation-recovery__queue">
				<div class="mutation-recovery__section-head">
					<div>
						<p class="mutation-recovery__eyebrow">{{ t('mutationRecovery.queueLabel') }}</p>
						<h4 class="mutation-recovery__section-title">{{ t('mutationRecovery.queueTitle') }}</h4>
					</div>
					<span v-if="store.loaded" class="mutation-recovery__count">
						{{ t('mutationRecovery.itemCount', { count: store.items.length }) }}
					</span>
				</div>

				<UiEmptyState
					v-if="store.loaded && !store.items.length"
					icon="fa-solid fa-shield-halved"
					:title="t('mutationRecovery.noItems')"
					:description="t('mutationRecovery.noItemsDescription')"
					dense
				/>
				<ul v-else class="mutation-recovery__list">
					<li v-for="item in store.items" :key="item.id">
						<UiButton
							appearance="ghost"
							class="mutation-claim"
							:disabled="localBusy || store.busy"
							@click="select(item.id)"
						>
							<span class="mutation-claim__icon" aria-hidden="true">
								<i class="fa-solid fa-fingerprint"></i>
							</span>
							<span class="mutation-claim__body">
								<span class="mutation-claim__top">
									<span class="mutation-claim__id">{{ item.id }}</span>
									<UiBadge :tone="stateTone(item.state)" density="compact">
										{{ t('mutationRecovery.states.' + item.state) }}
									</UiBadge>
								</span>
								<span class="mutation-claim__meta">
									<span>
										<i class="fa-solid fa-code-branch" aria-hidden="true"></i>
										{{ t('mutationRecovery.origins.' + item.origin) }}
									</span>
									<span>r{{ item.revision }}</span>
									<span>{{ date(item.createdAt) }}</span>
								</span>
							</span>
							<i class="mutation-claim__chevron fa-solid fa-chevron-right" aria-hidden="true"></i>
						</UiButton>
					</li>
				</ul>

				<UiButton
					v-if="store.nextCursor"
					appearance="soft"
					class="mutation-recovery__more"
					:disabled="localBusy || store.busy || store.blocked"
					@click="run((permission) => store.load(permission, false, true))"
				>
					<i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
					{{ t('mutationRecovery.more') }}
				</UiButton>
			</section>

			<section v-if="draft" class="mutation-detail" data-mutation-detail>
				<header class="mutation-detail__head">
					<span class="mutation-detail__mark" aria-hidden="true">
						<i class="fa-solid fa-route"></i>
					</span>
					<div class="mutation-detail__heading">
						<p class="mutation-recovery__eyebrow">{{ t('mutationRecovery.detailLabel') }}</p>
						<h4>{{ draft.id }}</h4>
					</div>
					<UiBadge :tone="stateTone(draft.state)" density="compact">
						{{ t('mutationRecovery.states.' + draft.state) }}
					</UiBadge>
				</header>

				<dl class="mutation-detail__summary">
					<div>
						<dt>{{ t('mutationRecovery.revision') }}</dt>
						<dd>r{{ draft.revision }}</dd>
					</div>
					<div>
						<dt>{{ t('mutationRecovery.createdAt') }}</dt>
						<dd>{{ date(draft.createdAt) }}</dd>
					</div>
					<div>
						<dt>{{ t('mutationRecovery.recoveryAllowed') }}</dt>
						<dd>
							{{ draft.recoveryAllowed ? t('common.enabled') : t('common.disabled') }}
						</dd>
					</div>
				</dl>

				<div class="mutation-detail__columns">
					<section class="mutation-detail__card">
						<div class="mutation-detail__card-head">
							<h5>{{ t('mutationRecovery.targets') }}</h5>
							<span>{{ draft.targets.length }}</span>
						</div>
						<p v-if="!draft.targets.length" class="mutation-detail__empty">
							{{ t('mutationRecovery.noTargets') }}
						</p>
						<ul v-else class="mutation-detail__targets">
							<li v-for="target in draft.targets" :key="target.targetId">
								<span class="mutation-detail__target-id">#{{ target.targetId }}</span>
								<code>{{ target.fingerprint }}</code>
							</li>
						</ul>
					</section>

					<section class="mutation-detail__card">
						<div class="mutation-detail__card-head">
							<h5>{{ t('mutationRecovery.evidenceRecords') }}</h5>
							<span>{{ draft.evidence.length }}</span>
						</div>
						<p v-if="!draft.evidence.length" class="mutation-detail__empty">
							{{ t('mutationRecovery.noEvidence') }}
						</p>
						<ul v-else class="mutation-detail__evidence">
							<li v-for="item in draft.evidence" :key="item.id">
								<div class="mutation-detail__evidence-head">
									<UiBadge :tone="outcomeTone(item.outcome)" density="compact">
										{{ t('mutationRecovery.outcomes.' + item.outcome) }}
									</UiBadge>
									<time>{{ date(item.observedAt) }}</time>
								</div>
								<p>{{ item.note }}</p>
								<code>{{ item.id }}</code>
							</li>
						</ul>
					</section>
				</div>

				<fieldset
					v-if="draft.state === 'blocked' && draft.recoveryAllowed"
					:disabled="localBusy || store.busy || store.blocked"
					class="mutation-detail__editor"
				>
					<legend>{{ t('mutationRecovery.evidence') }}</legend>
					<p class="mutation-detail__editor-copy">{{ t('mutationRecovery.evidenceHelp') }}</p>
					<div class="mutation-detail__checks">
						<label class="mutation-detail__check">
							<UiCheckbox v-model="producerStopped" :aria-label="t('mutationRecovery.producerStopped')" />
							<span>{{ t('mutationRecovery.producerStopped') }}</span>
						</label>
						<label class="mutation-detail__check">
							<UiCheckbox
								v-model="resourcesStopped"
								:aria-label="t('mutationRecovery.resourcesStopped')"
							/>
							<span>{{ t('mutationRecovery.resourcesStopped') }}</span>
						</label>
					</div>
					<div class="mutation-detail__fields">
						<UiFormField for-id="mutation-outcome" :label="t('mutationRecovery.outcome')">
							<UiSelect
								id="mutation-outcome"
								:model-value="outcome"
								:placeholder="t('mutationRecovery.choose')"
								@update:model-value="setOutcome"
							>
								<option v-for="value in MUTATION_OUTCOMES" :key="value" :value="value">
									{{ t('mutationRecovery.outcomes.' + value) }}
								</option>
							</UiSelect>
						</UiFormField>
						<UiFormField for-id="mutation-observed" :label="t('mutationRecovery.observedAt')">
							<UiInput id="mutation-observed" v-model="observedAt" type="datetime-local" step="1" />
						</UiFormField>
						<UiFormField
							for-id="mutation-note"
							:label="t('mutationRecovery.note')"
							class="mutation-detail__field-wide"
						>
							<UiTextarea id="mutation-note" v-model="note" :min-rows="4" />
						</UiFormField>
					</div>
					<div class="mutation-detail__editor-actions">
						<UiButton appearance="solid" tone="primary" @click="record">
							<i class="fa-solid fa-clipboard-check" aria-hidden="true"></i>
							{{ t('mutationRecovery.record') }}
						</UiButton>
					</div>

					<section class="mutation-detail__release">
						<div class="mutation-detail__release-copy">
							<h5>{{ t('mutationRecovery.releaseTitle') }}</h5>
							<p>{{ t('mutationRecovery.releaseHelp') }}</p>
						</div>
						<UiFormField for-id="mutation-evidence" :label="t('mutationRecovery.selectEvidence')">
							<UiSelect
								id="mutation-evidence"
								:model-value="evidenceId"
								:placeholder="t('mutationRecovery.choose')"
								@update:model-value="setEvidenceId"
							>
								<option v-for="item in draft.evidence" :key="item.id" :value="item.id">
									{{ item.id }}
								</option>
							</UiSelect>
						</UiFormField>
						<UiButton :disabled="!evidenceId" tone="danger" @click="release">
							<i class="fa-solid fa-lock-open" aria-hidden="true"></i>
							{{ t('mutationRecovery.release') }}
						</UiButton>
					</section>
				</fieldset>
			</section>
		</div>
	</UiSettingsGroup>
</template>

<style scoped>
	.mutation-recovery {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 14px;
	}

	.mutation-recovery__notice {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 11px 13px;
		border-radius: 11px;
		background: color-mix(in srgb, var(--status-warning-color) 10%, transparent);
		color: color-mix(in srgb, var(--status-warning-color) 78%, var(--text-color));
		font-size: 12px;
		line-height: 1.55;
	}

	.mutation-recovery__notice--error {
		background: color-mix(in srgb, var(--status-error-color) 9%, transparent);
		color: var(--status-error-color);
	}

	.mutation-recovery__notice > i {
		margin-top: 2px;
	}

	.mutation-recovery__queue {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 10px;
	}

	.mutation-recovery__section-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
	}

	.mutation-recovery__eyebrow {
		color: var(--text-color-secondary);
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.mutation-recovery__section-title {
		margin-top: 2px;
		color: var(--text-color);
		font-size: 13px;
		font-weight: 650;
	}

	.mutation-recovery__count {
		color: var(--text-color-secondary);
		font-size: 11px;
	}

	.mutation-recovery__list {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 7px;
	}

	.mutation-claim {
		width: 100%;
		height: auto;
		min-height: 62px;
		justify-content: flex-start;
		padding: 10px 12px;
		border-radius: 12px;
		text-align: left;
		white-space: normal;
	}

	.mutation-claim__icon {
		display: grid;
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 9px;
		background: color-mix(in srgb, var(--status-warning-color) 11%, transparent);
		color: var(--status-warning-color);
		font-size: 11px;
	}

	.mutation-claim__body {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 5px;
	}

	.mutation-claim__top,
	.mutation-claim__meta {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
	}

	.mutation-claim__id {
		overflow: hidden;
		color: var(--text-color);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 12px;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mutation-claim__meta {
		gap: 10px;
		color: var(--text-color-secondary);
		font-size: 10.5px;
	}

	.mutation-claim__meta > span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.mutation-claim__chevron {
		flex: 0 0 auto;
		color: var(--text-color-secondary);
		font-size: 9px;
	}

	.mutation-recovery__more {
		align-self: center;
	}

	.mutation-detail {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 13px;
		padding: 14px;
		border-radius: 14px;
		background: color-mix(in srgb, var(--header-bg-color) 30%, transparent);
	}

	.mutation-detail__head {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 10px;
	}

	.mutation-detail__mark {
		display: grid;
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 9px;
		background: color-mix(in srgb, var(--status-warning-color) 12%, transparent);
		color: var(--status-warning-color);
		font-size: 11px;
	}

	.mutation-detail__heading {
		min-width: 0;
		flex: 1;
	}

	.mutation-detail__heading h4 {
		margin-top: 2px;
		overflow-wrap: anywhere;
		color: var(--text-color);
		font-size: 13px;
		font-weight: 650;
	}

	.mutation-detail__summary {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}

	.mutation-detail__summary > div {
		min-width: 0;
		padding: 10px 11px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--card-bg-color) 46%, transparent);
	}

	.mutation-detail__summary dt {
		color: var(--text-color-secondary);
		font-size: 10px;
	}

	.mutation-detail__summary dd {
		margin-top: 3px;
		overflow: hidden;
		color: var(--text-color);
		font-size: 11.5px;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mutation-detail__columns {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 9px;
	}

	.mutation-detail__card {
		min-width: 0;
		padding: 12px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--card-bg-color) 38%, transparent);
	}

	.mutation-detail__card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 9px;
	}

	.mutation-detail__card-head h5,
	.mutation-detail__release-copy h5 {
		color: var(--text-color);
		font-size: 11.5px;
		font-weight: 650;
	}

	.mutation-detail__card-head > span {
		display: grid;
		min-width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 9.5px;
	}

	.mutation-detail__empty {
		color: var(--text-color-secondary);
		font-size: 11px;
		line-height: 1.6;
	}

	.mutation-detail__targets,
	.mutation-detail__evidence {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.mutation-detail__targets li {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
		font-size: 10.5px;
	}

	.mutation-detail__target-id {
		color: var(--text-color);
		font-weight: 650;
	}

	.mutation-detail__targets code,
	.mutation-detail__evidence code {
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--text-color-secondary);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 9.5px;
	}

	.mutation-detail__evidence li {
		min-width: 0;
		padding: 9px 10px;
		border-radius: 9px;
		background: color-mix(in srgb, var(--header-bg-color) 44%, transparent);
	}

	.mutation-detail__evidence-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.mutation-detail__evidence-head time {
		color: var(--text-color-secondary);
		font-size: 9.5px;
	}

	.mutation-detail__evidence p {
		margin: 6px 0;
		color: var(--text-color);
		font-size: 10.5px;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	.mutation-detail__editor {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 12px;
		padding: 13px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--status-warning-color) 5%, var(--card-bg-color) 40%);
	}

	.mutation-detail__editor legend {
		padding: 0 5px;
		color: var(--text-color);
		font-size: 12px;
		font-weight: 650;
	}

	.mutation-detail__editor-copy {
		color: var(--text-color-secondary);
		font-size: 10.5px;
		line-height: 1.6;
	}

	.mutation-detail__checks {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 7px;
	}

	.mutation-detail__check {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		gap: 8px;
		padding: 9px 10px;
		border-radius: 9px;
		background: color-mix(in srgb, var(--header-bg-color) 35%, transparent);
		color: var(--text-color-secondary);
		cursor: pointer;
		font-size: 10.5px;
		line-height: 1.55;
	}

	.mutation-detail__fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.mutation-detail__field-wide {
		grid-column: 1 / -1;
	}

	.mutation-detail__editor-actions {
		display: flex;
		justify-content: flex-end;
	}

	.mutation-detail__release {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(180px, 0.72fr) auto;
		gap: 12px;
		align-items: end;
		padding-top: 12px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
	}

	.mutation-detail__release-copy p {
		margin-top: 3px;
		color: var(--text-color-secondary);
		font-size: 10.5px;
		line-height: 1.55;
	}

	@media (max-width: 900px) {
		.mutation-detail__columns {
			grid-template-columns: minmax(0, 1fr);
		}

		.mutation-detail__release {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.mutation-detail__release-copy {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 620px) {
		.mutation-detail__summary,
		.mutation-detail__checks,
		.mutation-detail__fields,
		.mutation-detail__release {
			grid-template-columns: minmax(0, 1fr);
		}

		.mutation-detail__release-copy {
			grid-column: auto;
		}

		.mutation-detail__release :deep([data-ui='button']) {
			width: 100%;
		}

		.mutation-detail__editor-actions :deep([data-ui='button']) {
			width: 100%;
		}
	}
</style>
