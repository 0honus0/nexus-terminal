import type { JsonValue } from '../../agent.types';

export type PlanItemStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface PlanItem {
  id: string;
  title: string;
  detail: string | null;
  status: PlanItemStatus;
  dependsOn: string[];
  evidenceRefs: string[];
}

export interface RunPlan {
  schemaVersion: 1;
  revision: number;
  items: PlanItem[];
}

export const EMPTY_RUN_PLAN: RunPlan = Object.freeze({ schemaVersion: 1, revision: 0, items: [] });

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const STATUSES = new Set<PlanItemStatus>(['pending', 'in_progress', 'blocked', 'completed', 'cancelled']);

const requireText = (value: unknown, max: number, code: string): string => {
  if (typeof value !== 'string') throw new Error(code);
  const text = value.trim();
  if (!text || Buffer.byteLength(text, 'utf8') > max) throw new Error(code);
  return text;
};

export const normalizePlanItems = (value: unknown): PlanItem[] => {
  if (!Array.isArray(value) || value.length > 64) throw new Error('RUN_PLAN_INVALID');
  const items: PlanItem[] = value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('RUN_PLAN_INVALID');
    const row = candidate as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => !['id', 'title', 'detail', 'status', 'dependsOn', 'evidenceRefs'].includes(key))
    ) {
      throw new Error('RUN_PLAN_INVALID');
    }
    const id = requireText(row.id, 64, 'RUN_PLAN_INVALID');
    if (!ITEM_ID.test(id)) throw new Error('RUN_PLAN_INVALID');
    const title = requireText(row.title, 256, 'RUN_PLAN_INVALID');
    const detail =
      row.detail === undefined || row.detail === null ? null : requireText(row.detail, 2048, 'RUN_PLAN_INVALID');
    if (!STATUSES.has(row.status as PlanItemStatus)) throw new Error('RUN_PLAN_INVALID');
    const dependsOn = row.dependsOn === undefined ? [] : row.dependsOn;
    const evidenceRefs = row.evidenceRefs === undefined ? [] : row.evidenceRefs;
    if (
      !Array.isArray(dependsOn) ||
      dependsOn.length > 16 ||
      dependsOn.some((item) => typeof item !== 'string' || !ITEM_ID.test(item))
    ) {
      throw new Error('RUN_PLAN_INVALID');
    }
    if (
      !Array.isArray(evidenceRefs) ||
      evidenceRefs.length > 32 ||
      evidenceRefs.some((item) => typeof item !== 'string' || !ARTIFACT_ID.test(item))
    ) {
      throw new Error('RUN_PLAN_INVALID');
    }
    if (new Set(dependsOn).size !== dependsOn.length || new Set(evidenceRefs).size !== evidenceRefs.length) {
      throw new Error('RUN_PLAN_INVALID');
    }
    return {
      id,
      title,
      detail,
      status: row.status as PlanItemStatus,
      dependsOn: [...dependsOn],
      evidenceRefs: [...evidenceRefs],
    };
  });
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new Error('RUN_PLAN_INVALID');
  for (const item of items) {
    if (item.dependsOn.includes(item.id) || item.dependsOn.some((dependency) => !ids.has(dependency)))
      throw new Error('RUN_PLAN_INVALID');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(items.map((item) => [item.id, item]));
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error('RUN_PLAN_CYCLE');
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of items) visit(item.id);
  return items;
};

export const parseRunPlan = (value: unknown): RunPlan => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_RUN_PLAN, items: [] };
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0) {
    return { ...EMPTY_RUN_PLAN, items: [] };
  }
  try {
    return { schemaVersion: 1, revision: row.revision as number, items: normalizePlanItems(row.items ?? []) };
  } catch {
    return { ...EMPTY_RUN_PLAN, items: [] };
  }
};

export const planToJson = (plan: RunPlan): JsonValue => plan as unknown as JsonValue;
