<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import { AGENT_ARTIFACT_CONTENT_TYPES } from '@nexus-terminal/shared/agent/artifacts/values';
	import { useArtifactLibrary } from '../composables/use-artifact-library';
	import { formatAgentDateTime } from '../locale-format';
	import ArtifactAttachmentEditor from './ArtifactAttachmentEditor.vue';
	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });

	const { t, locale } = useI18n();
	const {
		apps,
		filters,
		items,
		storage,
		statsRequired,
		needsReload,
		offset,
		nextOffset,
		deleteTarget,
		uploadFile,
		uploadRecord,
		uploadUnknown,
		uploadAcknowledged,
		cleanupPlan,
		cleanupResult,
		cleanupUnknown,
		operation,
		appOperation,
		storageOperation,
		blocked,
		load,
		loadStorage,
		loadApps,
		retain,
		remove,
		upload,
		checkUpload,
		newUploadIntent,
		download,
		prepareCleanup,
		confirmCleanup,
		discardCleanup,
	} = useArtifactLibrary(() => props.active);

	function chooseFile(event: Event): void {
		if (event.target instanceof HTMLInputElement) {
			uploadFile.value = event.target.files?.[0] ?? null;
			event.target.value = '';
		}
	}

	function time(value: number | null): string {
		return value === null ? '—' : formatAgentDateTime(locale.value, new Date(value));
	}
</script>
<template>
	<section
		class="space-y-4 rounded-xl border border-border bg-card p-4"
		:aria-label="t('agent.artifactManagement.title')"
	>
		<header class="flex flex-wrap items-center gap-3 border-b border-border/70 pb-3">
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-[11px] text-text-secondary"
			>
				<i class="fa-regular fa-folder-open" aria-hidden="true"></i>
			</div>
			<div class="min-w-0">
				<h3 class="text-sm font-semibold tracking-tight text-foreground">
					{{ t('agent.artifactManagement.title') }}
				</h3>
				<p class="mt-0.5 text-[11px] leading-4 text-text-secondary">{{ t('agent.artifactManagement.help') }}</p>
			</div>
		</header>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="needsReload || operation.refreshRequired.value" class="text-sm text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<div class="flex flex-wrap gap-2">
			<UiButton
				v-if="needsReload || operation.refreshRequired.value || operation.notice.value === 'failed'"
				type="button"
				:disabled="operation.busy.value"
				@click="load()"
				>{{ t('agent.artifactManagement.reload') }}</UiButton
			>
			<UiButton
				v-if="
					statsRequired ||
					storageOperation.refreshRequired.value ||
					storageOperation.notice.value === 'failed'
				"
				type="button"
				:disabled="storageOperation.busy.value"
				@click="loadStorage"
				>{{ t('agent.artifactManagement.readStorage') }}</UiButton
			>
			<UiButton
				v-if="appOperation.refreshRequired.value || appOperation.notice.value === 'failed'"
				type="button"
				:disabled="appOperation.busy.value"
				@click="loadApps"
				>{{ t('agent.settings.appManagement.readApps') }}</UiButton
			>
		</div>
		<p v-if="appOperation.notice.value" role="alert">
			{{ t('agent.settings.appManagement.' + appOperation.notice.value) }}
		</p>
		<p v-if="storageOperation.notice.value" role="alert">
			{{ t('agent.settings.appManagement.' + storageOperation.notice.value) }}
		</p>
		<p v-if="statsRequired" class="text-sm text-text-secondary">{{ t('agent.artifactManagement.storageStale') }}</p>
		<dl v-if="storage" class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
			<div v-for="(value, key) in storage" :key="key">
				<dt>{{ t('agent.artifactManagement.storage.' + key) }}</dt>
				<dd>{{ value }} B</dd>
			</div>
		</dl>
		<fieldset :disabled="operation.busy.value" class="flex flex-wrap gap-2">
			<label class="text-sm"
				>{{ t('agent.artifactManagement.app')
				}}<select
					v-model="filters.appId"
					class="ml-2 rounded border border-border bg-background p-2"
					@change="load()"
				>
					<option value="">{{ t('agent.artifactManagement.allApps') }}</option>
					<option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }} · {{ app.id }}</option>
				</select></label
			>
			<label class="text-sm"
				>{{ t('agent.artifactManagement.kind')
				}}<select
					v-model="filters.kind"
					class="ml-2 rounded border border-border bg-background p-2"
					@change="load()"
				>
					<option value="">{{ t('agent.artifactManagement.all') }}</option>
					<option v-for="kind in AGENT_ARTIFACT_CONTENT_TYPES" :key="kind" :value="kind">
						{{ t('agent.files.kind.' + kind) }}
					</option>
				</select></label
			>
			<label class="text-sm"
				>{{ t('agent.artifactManagement.retention')
				}}<select
					v-model="filters.retention"
					class="ml-2 rounded border border-border bg-background p-2"
					@change="load()"
				>
					<option value="all">{{ t('agent.artifactManagement.all') }}</option>
					<option value="retained">{{ t('agent.artifactManagement.retained') }}</option>
					<option value="unretained">{{ t('agent.artifactManagement.unretained') }}</option>
				</select></label
			>
			<label class="text-sm"
				>{{ t('agent.artifactManagement.search')
				}}<input
					v-model="filters.query"
					class="ml-2 rounded border border-border bg-background p-2"
					@keydown.enter.prevent="load()"
			/></label>
		</fieldset>
		<article v-for="item in items" :key="item.id" class="space-y-2 rounded border border-border p-3">
			<h4 class="break-all">{{ item.name }} · v{{ item.version }} · {{ item.sizeBytes }} B</h4>
			<p class="break-all text-xs">
				{{ item.appId }} / {{ item.id }} · {{ t('agent.artifactManagement.status.' + item.status) }} ·
				{{ item.mediaType }}
			</p>
			<p class="break-all text-xs">SHA-256: {{ item.sha256 ?? '—' }}</p>
			<p class="text-xs">
				{{
					t('agent.artifactManagement.times', {
						created: time(item.createdAt),
						ready: time(item.readyAt),
						expires: time(item.expiresAt),
						deleted: time(item.deletedAt),
					})
				}}
			</p>
			<p v-if="item.retained" class="text-xs">{{ t('agent.artifactManagement.retained') }}</p>
			<div class="flex flex-wrap gap-2">
				<UiButton type="button" :disabled="blocked || item.status !== 'ready'" @click="download(item)">{{
					t('agent.artifactManagement.download')
				}}</UiButton>
				<UiButton type="button" :disabled="blocked || item.status !== 'ready'" @click="retain(item)">{{
					t(item.retained ? 'agent.artifactManagement.releaseRetention' : 'agent.artifactManagement.retain')
				}}</UiButton>
				<UiButton
					type="button"
					:disabled="blocked || item.retained || item.status === 'deleted'"
					@click="deleteTarget = item"
					>{{ t('common.delete') }}</UiButton
				>
			</div>
			<ArtifactAttachmentEditor
				:key="item.id"
				:artifact="item"
				:apps="apps"
				:disabled="blocked"
				@changed="load()"
			/>
		</article>
		<div class="flex flex-wrap gap-2">
			<UiButton
				type="button"
				:disabled="operation.busy.value || offset === 0"
				@click="load(Math.max(0, offset - 20))"
				>{{ t('agent.settings.memoryManagement.previous') }}</UiButton
			>
			<UiButton
				type="button"
				:disabled="operation.busy.value || nextOffset === null"
				@click="nextOffset !== null && load(nextOffset)"
				>{{ t('agent.settings.memoryManagement.next') }}</UiButton
			>
		</div>
		<div v-if="deleteTarget" class="space-y-2 rounded border border-warning p-3">
			<p class="break-all">
				{{
					t('agent.artifactManagement.confirmDelete', {
						name: deleteTarget.name,
						id: deleteTarget.id,
						version: deleteTarget.version,
					})
				}}
			</p>
			<UiButton type="button" :disabled="blocked" @click="remove">{{ t('common.delete') }}</UiButton>
			<UiButton type="button" :disabled="operation.busy.value" @click="deleteTarget = null">{{
				t('common.cancel')
			}}</UiButton>
		</div>
		<form class="space-y-3 rounded border border-border p-3" @submit.prevent="upload">
			<h4>{{ t('agent.artifactManagement.upload') }}</h4>
			<p class="text-sm text-text-secondary">{{ t('agent.artifactManagement.uploadHelp') }}</p>
			<fieldset :disabled="blocked || uploadUnknown || !filters.appId" class="space-y-2">
				<input type="file" :aria-label="t('agent.artifactManagement.upload')" @change="chooseFile" />
				<p v-if="uploadFile" class="break-all text-xs">{{ uploadFile.name }} · {{ uploadFile.size }} B</p>
				<UiButton type="submit" :disabled="!uploadFile">{{ t('agent.artifactManagement.upload') }}</UiButton>
			</fieldset>
			<p v-if="uploadRecord" class="break-all text-xs">
				{{ uploadRecord.id }} · v{{ uploadRecord.version }} ·
				{{ t('agent.artifactManagement.status.' + uploadRecord.status) }}
			</p>
			<UiButton v-if="uploadRecord" type="button" :disabled="operation.busy.value" @click="checkUpload">{{
				t('agent.artifactManagement.checkUpload')
			}}</UiButton>
			<template v-if="uploadUnknown">
				<p class="text-sm text-warning">{{ t('agent.artifactManagement.uploadUnknown') }}</p>
				<UiCheckbox v-model="uploadAcknowledged">{{
					t('agent.artifactManagement.acknowledgeUpload')
				}}</UiCheckbox>
				<UiButton type="button" :disabled="blocked || !uploadAcknowledged" @click="newUploadIntent">{{
					t('agent.artifactManagement.newUpload')
				}}</UiButton>
			</template>
		</form>
		<div class="space-y-3 rounded border border-border p-3">
			<h4>{{ t('agent.artifactManagement.cleanup') }}</h4>
			<p class="text-sm text-text-secondary">{{ t('agent.artifactManagement.cleanupHelp') }}</p>
			<UiButton
				type="button"
				:disabled="blocked || !filters.appId || cleanupUnknown || cleanupPlan !== null"
				@click="prepareCleanup"
				>{{ t('agent.artifactManagement.prepareCleanup') }}</UiButton
			>
			<template v-if="cleanupPlan">
				<p>
					{{
						t('agent.artifactManagement.plan', {
							count: cleanupPlan.selectedCount,
							bytes: cleanupPlan.selectedBytes,
							protected: cleanupPlan.protectedCount,
							expires: time(cleanupPlan.expiresAt),
						})
					}}
				</p>
				<p v-for="group in cleanupPlan.byApp" :key="group.appId" class="break-all text-xs">
					{{ group.appId }} · {{ group.count }} · {{ group.bytes }} B
				</p>
				<UiButton type="button" :disabled="blocked || cleanupUnknown" @click="confirmCleanup">{{
					t('agent.artifactManagement.confirmCleanup')
				}}</UiButton>
				<UiButton type="button" :disabled="operation.busy.value || cleanupUnknown" @click="discardCleanup">{{
					t('common.cancel')
				}}</UiButton>
			</template>
			<p v-if="cleanupUnknown" class="text-sm text-warning">{{ t('agent.artifactManagement.cleanupUnknown') }}</p>
			<p v-if="cleanupResult">
				{{
					t('agent.artifactManagement.result', {
						count: cleanupResult.deletedCount,
						bytes: cleanupResult.deletedBytes,
						skipped: cleanupResult.skippedCount,
						failed: cleanupResult.failedCount,
						partial: cleanupResult.partial,
					})
				}}
			</p>
		</div>
	</section>
</template>
