<script setup lang="ts">
	import { onScopeDispose, ref, useId, watch } from 'vue';
	import { Globe, Pencil, Plus, RotateCw, ShieldCheck, Trash2 } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import type { LogApi } from '../../log/browser/log-api.js';
	import type { MarketplaceRepository } from '../marketplace-catalog-types.js';
	import { MarketplaceAddRepositorySchema, MarketplaceUpdateRepositorySchema } from '../marketplace-http-types.js';
	import { CodedError } from '../../utils/error.js';
	import {
		UiBadge,
		UiButton,
		UiDialog,
		UiField,
		UiInput,
		UiList,
		UiListItem,
		UiSection,
		UiToolbar,
	} from '../../ui/browser/ui-components-api.js';
	import type { MarketplaceDesktopApi } from './marketplace-desktop-api.js';

	const { api, repositories, minimized, log } = defineProps<{
		api: MarketplaceDesktopApi;
		repositories: readonly MarketplaceRepository[];
		minimized: boolean;
		log: Pick<LogApi, 'report'>;
	}>();
	const emit = defineEmits<{ changed: [] }>();
	const { t } = useI18n({ useScope: 'global' });
	const url = ref('');
	const editing = ref<MarketplaceRepository>();
	const removing = ref<MarketplaceRepository>();
	const pending = ref<string>();
	const formId = useId();
	let disposed = false;

	onScopeDispose(() => {
		disposed = true;
	});
	watch(
		() => minimized,
		(hidden) => {
			if (hidden) {
				editing.value = undefined;
				removing.value = undefined;
			}
		},
	);

	function report(code: string, level: 'info' | 'error'): void {
		log.report({ source: 'marketplace', code, level, userVisible: true });
	}

	async function change(action: string, operation: () => Promise<unknown>, onSuccess?: () => void): Promise<void> {
		if (pending.value) return;
		pending.value = action;
		try {
			await operation();
			report('MARKETPLACE_REPOSITORY_SAVED', 'info');
			if (!disposed) onSuccess?.();
		} catch (cause) {
			report(cause instanceof CodedError ? cause.code : 'MARKETPLACE_REQUEST_FAILED', 'error');
		} finally {
			// 网络响应不确定时重新读取仓库与缓存，表单保留原输入。
			if (!disposed) {
				pending.value = undefined;
				emit('changed');
			}
		}
	}

	function add(): void {
		const input = MarketplaceAddRepositorySchema.safeParse({ url: url.value.trim() });
		if (!input.success) return report('MARKETPLACE_REPOSITORY_URL_INVALID', 'error');
		void change(
			'add',
			() => api.saveRepository(input.data),
			() => {
				url.value = '';
			},
		);
	}

	function save(): void {
		const record = editing.value;
		if (!record) return;
		const parsed = MarketplaceUpdateRepositorySchema.safeParse({
			repositoryId: record.id,
			label: record.label,
			url: record.url.trim(),
		});
		if (!parsed.success) return report('MARKETPLACE_REPOSITORY_EDIT_INVALID', 'error');
		void change(
			'edit',
			() => api.saveRepository({ id: record.id, ...parsed.data }),
			() => {
				editing.value = undefined;
			},
		);
	}

	function remove(id: string): void {
		void change(
			'remove',
			() => api.removeRepository(id),
			() => {
				removing.value = undefined;
			},
		);
	}
</script>

<template>
	<UiSection
		class="marketplace-repositories"
		collapsible
		:title="t('marketplace.repositories')"
		:aria-label="t('marketplace.repositories')"
		:icon="Globe"
	>
		<form class="repository-add" @submit.prevent="add">
			<UiToolbar>
				<UiInput
					v-model="url"
					type="url"
					required
					:aria-label="t('marketplace.repositoryURL')"
					:placeholder="t('marketplace.repositoryPlaceholder')"
					:disabled="!!pending"
				/>
				<template #actions>
					<UiButton type="submit" tone="primary" :disabled="!!pending" :loading="pending === 'add'">
						<template #leading><Plus :size="16" /></template>
						{{ t('marketplace.addRepository') }}
					</UiButton>
				</template>
			</UiToolbar>
		</form>
		<UiList v-if="repositories.length">
			<UiListItem
				v-for="repo in repositories"
				:key="repo.id"
				:title="repo.label"
				:description="repo.url"
				:icon="repo.official ? ShieldCheck : Globe"
			>
				<template v-if="repo.official" #badge
					><UiBadge>{{ t('marketplace.officialRepository') }}</UiBadge></template
				>
				<template #actions>
					<UiButton
						icon-only
						appearance="ghost"
						:disabled="!!pending"
						:loading="pending === 'refresh:' + repo.id"
						:aria-label="t('marketplace.refreshRepository', { name: repo.label })"
						@click="change('refresh:' + repo.id, () => api.refreshRepository(repo.id))"
						><RotateCw :size="16"
					/></UiButton>
					<UiButton
						icon-only
						appearance="ghost"
						:disabled="!!pending"
						:aria-label="t('marketplace.editRepository', { name: repo.label })"
						@click="editing = { ...repo }"
						><Pencil :size="16"
					/></UiButton>
					<UiButton
						icon-only
						appearance="ghost"
						tone="danger"
						:disabled="!!pending"
						:aria-label="t('marketplace.removeRepository', { name: repo.label })"
						@click="removing = repo"
						><Trash2 :size="16"
					/></UiButton>
				</template>
			</UiListItem>
		</UiList>
		<p v-else>{{ t('marketplace.noRepositories') }}</p>
	</UiSection>
	<UiDialog
		:open="!!editing"
		:close-disabled="pending === 'edit'"
		:title="t('marketplace.editRepositoryTitle')"
		:close-label="t('closeApplication')"
		@update:open="(open) => !open && (editing = undefined)"
	>
		<form v-if="editing" :id="formId" class="repository-edit" @submit.prevent="save">
			<UiField :label="t('marketplace.repositoryName')" v-slot="field">
				<UiInput :id="field.id" v-model="editing.label" :disabled="!!pending" required />
			</UiField>
			<UiField :label="t('marketplace.repositoryURL')" v-slot="field">
				<UiInput :id="field.id" v-model="editing.url" type="url" :disabled="!!pending" required />
			</UiField>
		</form>
		<template #footer>
			<UiButton type="submit" :form="formId" tone="primary" :loading="pending === 'edit'">{{
				t('marketplace.saveRepository')
			}}</UiButton>
		</template>
	</UiDialog>
	<UiDialog
		:open="!!removing"
		:title="t('marketplace.removeRepositoryTitle')"
		:close-label="t('closeApplication')"
		@update:open="(open) => !open && (removing = undefined)"
	>
		<p v-if="removing">{{ t('marketplace.removeRepositoryConfirm', { name: removing.label }) }}</p>
		<template #footer>
			<UiButton tone="danger" :loading="pending === 'remove'" @click="removing && remove(removing.id)">
				{{ t('marketplace.removeRepositoryTitle') }}
			</UiButton>
		</template>
	</UiDialog>
</template>

<style scoped>
	.marketplace-repositories {
		margin-top: 28px;
	}
	.repository-add {
		margin-block: 15px;
	}
	.repository-edit {
		display: grid;
		gap: 16px;
	}
	p {
		color: var(--ui-muted);
		font-size: 13px;
	}
</style>
