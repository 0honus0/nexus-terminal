import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { quickCommandsApi } from '../api/quickCommandsApi';
import type {
  QuickCommand,
  QuickCommandGroup,
  QuickCommandInput,
  QuickCommandSort,
  QuickCommandTag,
} from '../model/quickCommand';
const EXPANDED_KEY = 'quick-commands.expanded-groups';
export const useQuickCommandsStore = defineStore('quick-commands', () => {
  const items = ref<QuickCommand[]>([]),
    tags = ref<QuickCommandTag[]>([]),
    search = ref(''),
    sort = ref<QuickCommandSort>('name'),
    loading = ref(false),
    selectedId = ref<number | null>(null);
  const expanded = ref<Record<string, boolean>>({});
  try {
    expanded.value = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '{}');
  } catch {
    expanded.value = {};
  }
  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    return items.value.filter(
      (x) =>
        !term ||
        `${x.name ?? ''} ${x.command} ${x.tagIds.map((id) => tags.value.find((t) => t.id === id)?.name ?? '').join(' ')}`
          .toLowerCase()
          .includes(term),
    );
  });
  const compare = (a: QuickCommand, b: QuickCommand) =>
    sort.value === 'usageCount'
      ? b.usageCount - a.usageCount
      : sort.value === 'lastUsed'
        ? b.updatedAt - a.updatedAt
        : (a.name ?? a.command).localeCompare(b.name ?? b.command);
  const flat = computed(() => [...filtered.value].sort(compare));
  const groups = computed<QuickCommandGroup[]>(() => {
    const result: QuickCommandGroup[] = tags.value
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        commands: filtered.value.filter((x) => x.tagIds.includes(tag.id)).sort(compare),
      }))
      .filter((g) => g.commands.length);
    const untagged = filtered.value
      .filter((x) => !x.tagIds.some((id) => tags.value.some((t) => t.id === id)))
      .sort(compare);
    if (untagged.length) result.push({ id: null, name: 'Untagged', commands: untagged });
    return result;
  });
  const visible = computed(() =>
    groups.value.flatMap((group) => (expanded.value[group.name] === false ? [] : group.commands)),
  );
  const selected = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null);

  watch([search, sort], () => {
    selectedId.value = null;
  });

  async function load() {
    loading.value = true;
    try {
      [items.value, tags.value] = await Promise.all([quickCommandsApi.list(), quickCommandsApi.listTags()]);
    } finally {
      loading.value = false;
    }
  }
  async function save(input: QuickCommandInput, id?: number) {
    const item = id ? await quickCommandsApi.update(id, input) : await quickCommandsApi.create(input);
    const i = items.value.findIndex((x) => x.id === item.id);
    if (i >= 0) items.value[i] = item;
    else items.value.push(item);
    return item;
  }
  async function remove(id: number) {
    await quickCommandsApi.remove(id);
    items.value = items.value.filter((x) => x.id !== id);
    if (selectedId.value === id) selectedId.value = null;
  }
  async function recordUsage(id: number) {
    try {
      const updated = await quickCommandsApi.incrementUsage(id);
      if (!updated) return;
      const index = items.value.findIndex((item) => item.id === id);
      if (index >= 0) items.value[index] = updated;
    } catch {
      // Usage accounting is auxiliary; a failed counter update must never block command execution.
    }
  }
  async function addTag(name: string) {
    const tag = await quickCommandsApi.createTag(name);
    tags.value.push(tag);
    return tag;
  }
  async function removeTag(id: number) {
    await quickCommandsApi.removeTag(id);
    tags.value = tags.value.filter((tag) => tag.id !== id);
    items.value = items.value.map((item) =>
      item.tagIds.includes(id) ? { ...item, tagIds: item.tagIds.filter((tagId) => tagId !== id) } : item,
    );
  }
  async function renameTag(id: number, name: string) {
    const tag = tags.value.find((item) => item.id === id);
    if (!tag) throw new Error('Quick Command tag not found.');
    const oldName = tag.name;
    const updated = await quickCommandsApi.renameTag(id, name);
    const index = tags.value.findIndex((item) => item.id === id);
    if (index >= 0) tags.value[index] = updated;
    if (oldName !== updated.name && expanded.value[oldName] !== undefined) {
      const open = expanded.value[oldName];
      delete expanded.value[oldName];
      expanded.value[updated.name] = open;
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded.value));
    }
    return updated;
  }
  async function createTagForCommands(name: string, commandIds: number[]) {
    const tag = await addTag(name);
    if (!commandIds.length) return { tag, assigned: true as const };
    try {
      await quickCommandsApi.assignTag(commandIds, tag.id);
      const idSet = new Set(commandIds);
      items.value = items.value.map((item) =>
        idSet.has(item.id) && !item.tagIds.includes(tag.id) ? { ...item, tagIds: [...item.tagIds, tag.id] } : item,
      );
      if (expanded.value.Untagged !== undefined) {
        const open = expanded.value.Untagged;
        delete expanded.value.Untagged;
        expanded.value[tag.name] = open;
        localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded.value));
      }
      return { tag, assigned: true as const };
    } catch (cause) {
      return { tag, assigned: false as const, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
  function toggle(name: string) {
    expanded.value[name] = !(expanded.value[name] ?? true);
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded.value));
    selectedId.value = null;
  }
  function setSearch(value: string) {
    search.value = value;
  }
  function selectNext(grouped = true) {
    const candidates = grouped ? visible.value : flat.value;
    if (!candidates.length) {
      selectedId.value = null;
      return;
    }
    const current = candidates.findIndex((item) => item.id === selectedId.value);
    selectedId.value = candidates[(current + 1) % candidates.length]!.id;
  }
  function selectPrevious(grouped = true) {
    const candidates = grouped ? visible.value : flat.value;
    if (!candidates.length) {
      selectedId.value = null;
      return;
    }
    const current = candidates.findIndex((item) => item.id === selectedId.value);
    const index = current < 0 ? candidates.length - 1 : (current - 1 + candidates.length) % candidates.length;
    selectedId.value = candidates[index]!.id;
  }
  function resetSelection() {
    selectedId.value = null;
  }
  return {
    items,
    tags,
    search,
    sort,
    loading,
    expanded,
    flat,
    groups,
    visible,
    selectedId,
    selected,
    load,
    save,
    remove,
    recordUsage,
    addTag,
    removeTag,
    renameTag,
    createTagForCommands,
    toggle,
    setSearch,
    selectNext,
    selectPrevious,
    resetSelection,
  };
});
