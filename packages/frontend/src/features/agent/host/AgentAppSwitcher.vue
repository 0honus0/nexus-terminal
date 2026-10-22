<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInput } from '@/foundation/ui';
	import type { HostApp } from '../model/host-types';

	const props = defineProps<{ apps: HostApp[]; activeAppId: string | null }>();
	const emit = defineEmits<{ switch: [appId: string] }>();
	const { t } = useI18n();

	const open = ref(false);
	const query = ref('');
	const triggerRef = ref<HTMLElement | null>(null);
	const panelRef = ref<HTMLElement | null>(null);
	const position = ref({ left: '0px', top: '0px', maxWidth: '0px', maxHeight: '0px' });
	/*
	 * Same guard as the composer popovers: the placeholder caps make the panel
	 * collapse to zero, so anything measured before they are released is wrong
	 * (this one silently fell back to 260x220 and placed the panel accordingly
	 * for one frame). Nothing is painted until the real measurement lands.
	 */
	const positioned = ref(false);
	let hubResizeObserver: ResizeObserver | null = null;

	// Teleported panel bounds: stay inside the owning Agent Hub window when the
	// trigger lives inside one, otherwise fall back to the viewport.
	const HUB_SELECTOR = '.agent-hub-window';
	const EDGE_INSET = 12;

	const getHubElement = (): HTMLElement | null => {
		const hub = triggerRef.value?.closest(HUB_SELECTOR);
		return hub instanceof HTMLElement ? hub : null;
	};

	const resolveBounds = () => {
		const hub = getHubElement();
		if (hub) {
			const rect = hub.getBoundingClientRect();
			return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
		}
		return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
	};

	const observeHub = () => {
		if (typeof ResizeObserver === 'undefined') return;
		hubResizeObserver?.disconnect();
		const hub = getHubElement();
		if (!hub) return;
		hubResizeObserver = new ResizeObserver(() => positionPanel());
		hubResizeObserver.observe(hub);
	};

	const enabledApps = computed(() => props.apps.filter((app) => app.enabled));
	const candidateApps = computed(() => enabledApps.value);

	const filteredApps = computed(() => {
		const needle = query.value.trim().toLowerCase();
		if (!needle) return candidateApps.value;
		return candidateApps.value.filter((app) => `${app.displayName} ${app.id}`.toLowerCase().includes(needle));
	});

	function surfaceLabel(app: HostApp): string {
		return t(app.surface === 'custom' ? 'agent.hub.customSurface' : 'agent.hub.agentSurface');
	}

	const positionPanel = (): boolean => {
		const anchor = triggerRef.value?.getBoundingClientRect();
		const popup = panelRef.value;
		if (!anchor || !popup) return false;
		const bounds = resolveBounds();
		const availableWidth = Math.max(0, bounds.right - bounds.left - EDGE_INSET * 2);
		const availableHeight = Math.max(0, bounds.bottom - bounds.top - EDGE_INSET * 2);
		popup.style.maxWidth = `${availableWidth}px`;
		popup.style.maxHeight = `${availableHeight}px`;
		const popupRect = popup.getBoundingClientRect();
		const width = Math.min(popupRect.width || 260, availableWidth);
		const height = Math.min(popupRect.height || 220, availableHeight);

		let left = anchor.left;
		if (left + width > bounds.right - EDGE_INSET) {
			left = Math.max(bounds.left + EDGE_INSET, anchor.right - width);
		}
		left = Math.max(bounds.left + EDGE_INSET, Math.min(left, bounds.right - EDGE_INSET - width));

		let top = anchor.bottom + 6;
		if (top + height > bounds.bottom - EDGE_INSET) {
			top = Math.max(bounds.top + EDGE_INSET, anchor.top - height - 6);
		}
		top = Math.max(bounds.top + EDGE_INSET, Math.min(top, bounds.bottom - EDGE_INSET - height));

		position.value = {
			left: `${Math.round(left)}px`,
			top: `${Math.round(top)}px`,
			maxWidth: `${availableWidth}px`,
			maxHeight: `${availableHeight}px`,
		};
		positioned.value = true;
		return true;
	};

	const toggle = async () => {
		if (open.value) {
			close();
			return;
		}
		open.value = true;
		query.value = '';
		await nextTick();
		if (!positionPanel()) requestAnimationFrame(() => positionPanel());
		observeHub();
		panelRef.value?.focus();
	};

	const close = (restoreFocus = false) => {
		if (!open.value) return;
		open.value = false;
		positioned.value = false;
		hubResizeObserver?.disconnect();
		if (restoreFocus) queueMicrotask(() => triggerRef.value?.querySelector<HTMLButtonElement>('button')?.focus());
	};

	const selectApp = (appId: string) => {
		emit('switch', appId);
		close();
	};

	const onPointerDown = (event: PointerEvent) => {
		if (!open.value || !(event.target instanceof Node)) return;
		if (triggerRef.value?.contains(event.target) || panelRef.value?.contains(event.target)) return;
		close();
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (!open.value || event.key !== 'Escape') return;
		event.preventDefault();
		close(true);
	};

	onMounted(() => {
		window.addEventListener('resize', positionPanel);
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
	});

	onBeforeUnmount(() => {
		hubResizeObserver?.disconnect();
		window.removeEventListener('resize', positionPanel);
		document.removeEventListener('pointerdown', onPointerDown, true);
		document.removeEventListener('keydown', onKeyDown, true);
	});
</script>

<template>
	<div ref="triggerRef" class="relative inline-flex shrink-0 items-center">
		<UiButton
			density="compact"
			:appearance="open ? 'soft' : 'ghost'"
			:icon-only="true"
			class="agent-app-new-tab rounded-full"
			:aria-label="$t('agent.hub.chooseApp')"
			:title="$t('agent.hub.chooseApp')"
			:aria-expanded="open"
			@click="toggle"
		>
			<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
		</UiButton>

		<Teleport to="body">
			<div
				v-if="open"
				data-agent-hub-portal
				ref="panelRef"
				role="dialog"
				:aria-label="$t('agent.hub.chooseApp')"
				tabindex="-1"
				:style="[position, positioned ? null : { visibility: 'hidden' }]"
				class="ui-surface ui-radius--panel ui-glass-panel fixed z-[60] flex w-72 flex-col overflow-hidden shadow-2xl outline-none"
			>
				<div
					class="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs font-semibold"
				>
					<div class="flex items-center gap-1.5">
						<span class="text-foreground">{{ $t('agent.hub.apps') }}</span>
						<span
							class="rounded border border-border/60 bg-header px-1.5 py-0.5 text-[11px] font-medium text-text-secondary"
						>
							{{ candidateApps.length }}
						</span>
					</div>
					<UiButton
						density="compact"
						appearance="ghost"
						icon-only
						:aria-label="$t('agent.hub.closeApps')"
						:title="$t('agent.hub.closeApps')"
						@click.stop="close()"
					>
						<i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
					</UiButton>
				</div>

				<div v-if="candidateApps.length > 4" class="border-b border-border/45 p-2">
					<UiInput
						v-model="query"
						type="search"
						density="compact"
						class="w-full"
						:placeholder="$t('agent.hub.searchApps')"
						:aria-label="$t('agent.hub.searchApps')"
						autofocus
					>
						<template #leading>
							<i class="fa-solid fa-magnifying-glass text-[10px]" aria-hidden="true"></i>
						</template>
					</UiInput>
				</div>

				<div class="max-h-64 overflow-y-auto p-1.5 space-y-1">
					<button
						v-for="app in filteredApps"
						:key="app.id"
						type="button"
						class="flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-header"
						:class="
							app.id === activeAppId
								? 'border border-border/80 bg-card font-medium text-foreground shadow-xs'
								: 'border border-transparent text-text-secondary hover:text-foreground'
						"
						@click="selectApp(app.id)"
					>
						<div class="flex min-w-0 items-center gap-2">
							<div class="min-w-0">
								<div class="truncate text-xs font-medium leading-none">{{ app.displayName }}</div>
								<div class="mt-1 truncate text-[11px] text-text-secondary">
									{{ surfaceLabel(app) }}
								</div>
							</div>
						</div>

						<div class="flex shrink-0 items-center gap-1.5">
							<i
								v-if="app.id === activeAppId"
								class="fa-solid fa-check text-xs text-foreground"
								aria-hidden="true"
							></i>
						</div>
					</button>
				</div>
			</div>
		</Teleport>
	</div>
</template>
