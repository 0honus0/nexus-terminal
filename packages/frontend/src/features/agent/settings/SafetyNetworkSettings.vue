<script setup lang="ts">
  import { UiButton } from '@/foundation/ui';
  import { computed, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useConnections, type ConnectionDto } from '@/features/connections/public';
  import type { AgentTargetDenylistViewDto } from '../api/agent-api';

  const props = defineProps<{ denylist: AgentTargetDenylistViewDto; busy: boolean }>();
  const emit = defineEmits<{ save: [connectionIds: number[], reason: string] }>();
  const { t } = useI18n();
  const connectionsStore = useConnections();
  const loadingConnections = ref(false);
  const connectionsResolved = ref(connectionsStore.connections.value.length > 0);
  const connectionLoadFailed = ref(false);
  const searchQuery = ref('');
  const reason = ref('');
  const selectedIds = ref<Set<number>>(new Set());
  const expanded = ref(false);

  onMounted(async () => {
    if (connectionsStore.connections.value.length) {
      connectionsResolved.value = true;
      return;
    }
    loadingConnections.value = true;
    connectionLoadFailed.value = false;
    try {
      await connectionsStore.load();
      connectionsResolved.value = true;
    } catch {
      connectionLoadFailed.value = true;
    } finally {
      loadingConnections.value = false;
    }
  });

  // 与父级安全黑名单同步
  watch(
    () => props.denylist.revision,
    () => {
      selectedIds.value = new Set(props.denylist.list.map((entry) => entry.connectionId));
      reason.value = props.denylist.list[0]?.reason || '';
    },
    { immediate: true },
  );

  // 快捷原因预设
  const reasonPresets = computed(() => [
    t('agent.settings.safety.reasonPresets.production'),
    t('agent.settings.safety.reasonPresets.compliance'),
    t('agent.settings.safety.reasonPresets.maintenance'),
    t('agent.settings.safety.reasonPresets.sandbox'),
  ]);

  const setPresetReason = (preset: string) => {
    reason.value = preset;
  };

  // 过滤后的连接列表
  const allConnections = computed(() => connectionsStore.connections.value);
  const blockedConnections = computed(() =>
    allConnections.value.filter((connection) => selectedIds.value.has(connection.id)),
  );

  const filteredConnections = computed(() => {
    const list = allConnections.value;
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.host && c.host.toLowerCase().includes(q)) ||
        (c.username && c.username.toLowerCase().includes(q)) ||
        String(c.id).includes(q) ||
        String(c.port).includes(q),
    );
  });

  // 切换单个连接的禁止状态
  const toggleConnection = (id: number) => {
    const next = new Set(selectedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds.value = next;
  };

  // 全部禁止（当前过滤列表）
  const blockAll = () => {
    const next = new Set(selectedIds.value);
    filteredConnections.value.forEach((c) => next.add(c.id));
    selectedIds.value = next;
  };

  // 全部允许（当前过滤列表）
  const allowAll = () => {
    const next = new Set(selectedIds.value);
    filteredConnections.value.forEach((c) => next.delete(c.id));
    selectedIds.value = next;
  };

  // 是否所有过滤结果均被禁止
  const isAllFilteredBlocked = computed(() => {
    if (!filteredConnections.value.length) return false;
    return filteredConnections.value.every((c) => selectedIds.value.has(c.id));
  });

  // 是否无任何过滤结果被禁止
  const isNoneFilteredBlocked = computed(() => {
    if (!filteredConnections.value.length) return true;
    return filteredConnections.value.every((c) => !selectedIds.value.has(c.id));
  });

  // 判定是否发生实质变更
  const isDirty = computed(() => {
    const initial = new Set(props.denylist.list.map((e) => e.connectionId));
    if (initial.size !== selectedIds.value.size) return true;
    for (const id of selectedIds.value) {
      if (!initial.has(id)) return true;
    }
    return false;
  });

  // 获取连接图标
  const connectionIcon = (type: ConnectionDto['type']) => {
    if (type === 'RDP') return 'fa-solid fa-desktop';
    return 'fa-solid fa-terminal';
  };

  // 识别黑名单中已被物理删除的历史残留连接 ID
  const orphanIds = computed(() => {
    if (!connectionsResolved.value) return [];
    const existing = new Set(allConnections.value.map((c) => c.id));
    return Array.from(selectedIds.value).filter((id) => !existing.has(id));
  });

  const removeOrphanId = (id: number) => {
    const next = new Set(selectedIds.value);
    next.delete(id);
    selectedIds.value = next;
  };

  // 保存安全黑名单
  const save = () => {
    const connectionIds = Array.from(selectedIds.value).sort((a, b) => a - b);
    const finalReason = reason.value.trim() || t('agent.settings.safety.defaultReason');
    emit('save', connectionIds, finalReason);
  };
</script>

<template>
  <section class="rounded-2xl border border-border/70 bg-card/25 shadow-xs transition-all">
    <!-- 头部横栏与状态徽标 -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5 rounded-t-2xl"
    >
      <div>
        <div class="flex items-center gap-2.5">
          <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.safety.title') }}</h3>
          <!-- 统计药丸 -->
          <span
            class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all"
            :class="
              selectedIds.size > 0
                ? 'border-error/30 bg-error/10 text-error font-semibold'
                : 'border-success/30 bg-success/10 text-success '
            "
          >
            {{ $t('agent.settings.safety.blockedCount', { blocked: selectedIds.size, total: allConnections.length }) }}
          </span>
        </div>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.safety.description') }}</p>
      </div>

      <div class="flex items-center gap-2">
        <span class="hidden text-[11px] font-mono text-text-secondary/60 sm:inline">
          {{ $t('agent.settings.safety.revision', { revision: denylist.revision }) }}
        </span>
        <UiButton
          type="button"
          appearance="soft"
          tone="neutral"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <i class="fa-solid fa-shield-halved text-[10px] text-primary/80" aria-hidden="true"></i>
          <span>{{
            $t(expanded ? 'agent.settings.safety.collapseTargets' : 'agent.settings.safety.manageTargets')
          }}</span>
          <i
            class="fa-solid fa-chevron-down text-[8px] text-text-secondary transition-transform"
            :class="{ 'rotate-180': expanded }"
            aria-hidden="true"
          ></i>
        </UiButton>
      </div>
    </div>

    <div class="border-t border-border/55 px-4 py-3 sm:px-5">
      <div class="flex items-start gap-2.5">
        <i class="fa-solid fa-lock mt-0.5 shrink-0 text-[10px] text-text-secondary/65" aria-hidden="true"></i>
        <div class="min-w-0 flex-1">
          <div class="text-[11px] leading-relaxed text-text-secondary">
            {{ $t('agent.settings.safety.scopeHint') }}
          </div>
          <div v-if="blockedConnections.length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="connection in blockedConnections.slice(0, 6)"
              :key="connection.id"
              class="inline-flex max-w-52 items-center gap-1 rounded-md bg-error/8 px-2 py-1 text-[11px] text-error"
            >
              <i class="fa-solid fa-ban text-[8px]" aria-hidden="true"></i>
              <span class="truncate">{{ connection.name || connection.host }}</span>
            </span>
            <span
              v-if="blockedConnections.length > 6"
              class="rounded-md bg-header/60 px-2 py-1 text-[11px] text-text-secondary"
            >
              +{{ blockedConnections.length - 6 }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="expanded" class="space-y-4 border-t border-border/60 p-4 sm:p-5">
      <!-- 强制安全边界说明 -->
      <div
        class="flex items-start gap-2.5 rounded-xl border border-border bg-background/80 p-3.5 shadow-2xs text-xs text-text-secondary leading-relaxed"
      >
        <i class="fa-solid fa-shield-halved text-sm text-primary/80 mt-0.5 shrink-0"></i>
        <span>{{ $t('agent.settings.safety.guardrails') }}</span>
      </div>

      <!-- 搜索与快捷批量选择栏 -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <!-- 快速搜索框 -->
        <div class="relative flex-1 max-w-md">
          <i
            class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary/70 pointer-events-none"
          ></i>
          <input
            v-model="searchQuery"
            type="text"
            data-no-highlight
            class="h-8.5 w-full rounded-xl border border-border bg-background pl-8.5 pr-3 text-xs shadow-2xs text-foreground placeholder:text-text-secondary/60 outline-none focus:border-border-hover transition-all"
            :placeholder="$t('agent.settings.safety.searchConnections')"
          />
        </div>

        <!-- 批量全选/全清操作 -->
        <div v-if="filteredConnections.length > 0" class="flex items-center gap-2">
          <UiButton
            appearance="soft"
            tone="danger"
            type="button"
            :disabled="busy || isAllFilteredBlocked"
            @click="blockAll"
          >
            <i class="fa-solid fa-ban text-[11px]"></i>
            <span>{{ $t('agent.settings.safety.blockAll') }}</span>
          </UiButton>
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="busy || isNoneFilteredBlocked"
            @click="allowAll"
          >
            <i class="fa-solid fa-check text-[11px]"></i>
            <span>{{ $t('agent.settings.safety.allowAll') }}</span>
          </UiButton>
        </div>
      </div>

      <!-- 连接加载状态 -->
      <div v-if="loadingConnections" class="py-8 text-center text-xs text-text-secondary">
        <i class="fa-solid fa-circle-notch fa-spin text-lg text-primary mb-2"></i>
        <div>{{ $t('agent.settings.safety.loadingConnections') }}</div>
      </div>

      <div
        v-else-if="connectionLoadFailed"
        class="rounded-xl border border-error/30 bg-error/5 p-4 text-center text-xs text-error"
      >
        {{ $t('agent.settings.safety.connectionLoadFailed') }}
      </div>

      <!-- 空态提示（系统无连接） -->
      <div
        v-else-if="allConnections.length === 0"
        class="rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/20"
      >
        <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <i class="fa-solid fa-network-wired text-base"></i>
        </div>
        <div class="mt-2.5 text-xs font-medium text-foreground">{{ $t('agent.settings.safety.emptyConnections') }}</div>
        <p class="mt-1 text-[11px] text-text-secondary">{{ $t('agent.settings.safety.emptyConnectionsDetail') }}</p>
      </div>

      <!-- 搜索无结果 -->
      <div
        v-else-if="filteredConnections.length === 0"
        class="py-6 text-center text-xs text-text-secondary rounded-xl border border-border/50 bg-header/10"
      >
        {{ $t('agent.settings.safety.noSearchResults', { query: searchQuery }) }}
      </div>

      <!-- 可视化连接卡片列表（直观展示所有连接，点击即可禁止/允许） -->
      <div
        v-else
        class="rounded-xl border border-border bg-background/50 p-2.5 grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto"
      >
        <div
          v-for="connection in filteredConnections"
          :key="connection.id"
          class="flex items-center justify-between gap-3 rounded-xl border p-3 transition-all cursor-pointer select-none"
          :class="
            selectedIds.has(connection.id)
              ? 'border-error/50 bg-error/10 shadow-xs ring-1 ring-error/30'
              : 'border border-border bg-card hover:border-border-hover hover:bg-header/40 shadow-2xs'
          "
          @click="toggleConnection(connection.id)"
        >
          <!-- 左侧信息区 -->
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <!-- 复选框（大触点） -->
            <input
              type="checkbox"
              class="h-4 w-4 rounded accent-error cursor-pointer shrink-0"
              :checked="selectedIds.has(connection.id)"
              @click.stop="toggleConnection(connection.id)"
            />

            <!-- 协议图标 -->
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all"
              :class="
                selectedIds.has(connection.id)
                  ? 'border-error/30 bg-error/15 text-error'
                  : 'border-border/60 bg-header/50 text-text-secondary'
              "
            >
              <i :class="connectionIcon(connection.type)" class="text-xs"></i>
            </div>

            <!-- 连接详情 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold text-foreground truncate">
                  {{ connection.name || connection.host }}
                </span>
                <!-- ID 微标 -->
                <span class="rounded bg-header px-1.5 py-0.5 text-[11px] font-mono text-text-secondary font-medium">
                  ID: #{{ connection.id }}
                </span>
              </div>
              <div class="mt-0.5 flex items-center gap-2 text-[11px] text-text-secondary/80 font-mono truncate">
                <span v-if="connection.username" class="text-text-secondary">{{ connection.username }}@</span>
                <span>{{ connection.host }}:{{ connection.port }}</span>
                <span
                  class="rounded bg-card/80 border border-border/70 px-1.5 py-0.5 text-[11px] uppercase font-semibold text-text-secondary"
                >
                  {{ connection.type }}
                </span>
              </div>
            </div>
          </div>

          <!-- 右侧状态徽标 -->
          <div class="shrink-0">
            <span
              v-if="selectedIds.has(connection.id)"
              class="inline-flex items-center gap-1 rounded-md bg-error/15 border border-error/30 px-2 py-1 text-[11px] font-semibold text-error shadow-2xs"
            >
              <i class="fa-solid fa-ban text-[9px]"></i>
              <span>{{ $t('agent.settings.safety.blockedBadge') }}</span>
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1 rounded-md bg-success/10 border border-success/25 px-2 py-1 text-[11px] font-medium text-success"
            >
              <i class="fa-solid fa-check text-[9px]"></i>
              <span>{{ $t('agent.settings.safety.allowedBadge') }}</span>
            </span>
          </div>
        </div>
      </div>

      <!-- 历史残留孤立 ID 提醒与一键清理（若黑名单中包含已不存在的连接） -->
      <div
        v-if="orphanIds.length > 0"
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
      >
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-warning text-xs shrink-0"></i>
          <span>{{ $t('agent.settings.safety.orphanIds') }}</span>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="id in orphanIds"
              :key="id"
              type="button"
              class="inline-flex items-center gap-1 rounded bg-warning/15 border border-warning/30 px-1.5 py-0.5 font-mono text-[11px] hover:bg-warning/25 cursor-pointer"
              :title="$t('agent.settings.safety.removeOrphanId')"
              @click="removeOrphanId(id)"
            >
              <span>#{{ id }}</span>
              <i class="fa-solid fa-xmark text-[8px]"></i>
            </button>
          </div>
        </div>
        <button
          type="button"
          class="text-[11px] underline hover:no-underline cursor-pointer"
          @click="orphanIds.forEach((id) => removeOrphanId(id))"
        >
          {{ $t('agent.settings.safety.clearOrphanIds') }}
        </button>
      </div>

      <!-- 底部原因说明与保存安全策略操作条 -->
      <div class="pt-4 border-t border-border space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label class="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <span>{{ $t('agent.settings.safety.reason') }}</span>
            <span class="text-[11px] text-text-secondary font-normal">{{
              $t('agent.settings.safety.reasonAudit')
            }}</span>
          </label>
          <!-- 快捷预设药丸 -->
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] text-text-secondary">{{ $t('agent.settings.safety.commonReasons') }}</span>
            <button
              v-for="preset in reasonPresets"
              :key="preset"
              type="button"
              class="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-text-secondary hover:border-primary/40 hover:text-primary transition-all cursor-pointer shadow-2xs"
              @click="setPresetReason(preset)"
            >
              {{ preset }}
            </button>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <input
            v-model="reason"
            type="text"
            maxlength="512"
            data-no-highlight
            class="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs shadow-2xs text-foreground placeholder:text-text-secondary/60 outline-none focus:border-border-hover transition-all"
            :placeholder="$t('agent.settings.safety.reasonPlaceholder')"
            @keydown.enter.prevent="save"
          />
          <UiButton
            type="button"
            :appearance="isDirty && reason.trim() ? 'solid' : 'soft'"
            :tone="isDirty && reason.trim() ? 'primary' : 'neutral'"
            :disabled="busy || !reason.trim()"
            @click="save"
          >
            <i class="fa-solid fa-shield-check text-xs"></i>
            <span>{{ $t('agent.settings.safety.savePolicy') }}</span>
          </UiButton>
        </div>
      </div>
    </div>
  </section>
</template>
