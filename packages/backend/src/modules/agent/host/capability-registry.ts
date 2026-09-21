import type { JsonValue } from '../agent.types';
import type { AgentTargetKind, AgentTargetSelector } from '../capabilities/tool-target.types';
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
  type CapabilityGrant,
  type CapabilityDefinitionView,
  type CapabilityGrantScope,
  type CapabilityScopeKind,
  type TargetCapabilityScope,
  type TargetGrantSelection,
} from './capability.types';

interface CapabilityDefinition {
  id: AgentCapability;
  scopeKind: CapabilityScopeKind;
  supportedTargets: readonly AgentTargetKind[];
}

const TARGET_CAPABILITIES = new Map<AgentCapability, readonly AgentTargetKind[]>([
  ['file.read', ['workspace', 'ssh']],
  ['file.write', ['workspace', 'ssh']],
  ['file.delete', ['workspace', 'ssh']],
]);

const definitions = new Map<AgentCapability, CapabilityDefinition>(
  AGENT_CAPABILITIES.map((id) => {
    const supportedTargets = TARGET_CAPABILITIES.get(id) ?? [];
    return [id, { id, scopeKind: supportedTargets.length > 0 ? 'targets' : 'global', supportedTargets }] as const;
  }),
);

const invalid = (): never => {
  throw new Error('APP_GRANT_SCOPE_INVALID');
};

const exactKeys = (record: Record<string, unknown>, allowed: readonly string[]): void => {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) invalid();
};

const decodeTargetGrantSelection = (value: unknown): TargetGrantSelection => {
  if (!value || Array.isArray(value) || typeof value !== 'object') return invalid();
  const record = value as Record<string, unknown>;
  if (record.mode === 'all') {
    exactKeys(record, ['mode']);
    return { mode: 'all' };
  }
  if (record.mode === 'ids') {
    exactKeys(record, ['mode', 'ids']);
    if (!Array.isArray(record.ids) || record.ids.length > 256) return invalid();
    const ids = record.ids.map((item) => {
      if (typeof item !== 'string' || !item || item.length > 128) return invalid();
      return item;
    });
    if (new Set(ids).size !== ids.length) return invalid();
    return { mode: 'ids', ids: [...ids].sort() };
  }
  return invalid();
};

export class CapabilityRegistry {
  list(): CapabilityDefinitionView[] {
    return [...definitions.values()].map((item) => ({
      ...item,
      supportedTargets: [...item.supportedTargets],
      defaultScope: this.defaultScope(item.id),
    }));
  }

  require(capability: AgentCapability): CapabilityDefinition {
    const definition = definitions.get(capability);
    if (!definition) throw new Error('APP_CAPABILITY_UNDECLARED');
    return definition;
  }

  defaultScope(capability: AgentCapability): CapabilityGrantScope {
    const definition = this.require(capability);
    if (definition.scopeKind === 'global') return { kind: 'global' };
    return {
      kind: 'targets',
      targets: Object.fromEntries(
        definition.supportedTargets.map((target) => [target, { mode: 'all' }]),
      ) as TargetCapabilityScope['targets'],
    };
  }

  grant(capability: AgentCapability, scope: CapabilityGrantScope, grantedAt: number): CapabilityGrant {
    return { capability, schemaVersion: 2, scope: this.parseScope(capability, scope), grantedAt };
  }

  parseScope(capability: AgentCapability, value: unknown): CapabilityGrantScope {
    const definition = this.require(capability);
    if (!value || Array.isArray(value) || typeof value !== 'object') return invalid();
    const record = value as Record<string, unknown>;
    if (definition.scopeKind === 'global') {
      exactKeys(record, ['kind']);
      if (record.kind !== 'global') return invalid();
      return { kind: 'global' };
    }
    exactKeys(record, ['kind', 'targets']);
    if (
      record.kind !== 'targets' ||
      !record.targets ||
      Array.isArray(record.targets) ||
      typeof record.targets !== 'object'
    ) {
      return invalid();
    }
    const targetsRecord = record.targets as Record<string, unknown>;
    if (Object.keys(targetsRecord).some((target) => !definition.supportedTargets.includes(target as AgentTargetKind))) {
      return invalid();
    }
    const targets: TargetCapabilityScope['targets'] = {};
    for (const target of definition.supportedTargets) {
      if (targetsRecord[target] !== undefined) targets[target] = decodeTargetGrantSelection(targetsRecord[target]);
    }
    return { kind: 'targets', targets };
  }

  parseGrant(value: {
    capability: AgentCapability;
    schemaVersion: number;
    scope: unknown;
    grantedAt: number;
  }): CapabilityGrant {
    if (value.schemaVersion !== 2) throw new Error('APP_GRANT_SCHEMA_INVALID');
    return this.grant(value.capability, this.parseScope(value.capability, value.scope), value.grantedAt);
  }

  intersect(
    capability: AgentCapability,
    left: CapabilityGrantScope,
    right: CapabilityGrantScope,
  ): CapabilityGrantScope | null {
    const definition = this.require(capability);
    const leftScope = this.parseScope(capability, left);
    const rightScope = this.parseScope(capability, right);
    if (definition.scopeKind === 'global') return { kind: 'global' };
    if (leftScope.kind !== 'targets' || rightScope.kind !== 'targets') return null;
    const targets: TargetCapabilityScope['targets'] = {};
    for (const target of definition.supportedTargets) {
      const intersection = this.intersectSelection(leftScope.targets[target], rightScope.targets[target]);
      if (intersection) targets[target] = intersection;
    }
    return Object.keys(targets).length > 0 ? { kind: 'targets', targets } : null;
  }

  restrictTargets(
    capability: AgentCapability,
    scope: CapabilityGrantScope,
    allowedTargets: readonly AgentTargetKind[],
  ): CapabilityGrantScope | null {
    const definition = this.require(capability);
    const parsed = this.parseScope(capability, scope);
    if (definition.scopeKind === 'global') return parsed;
    if (parsed.kind !== 'targets') return null;
    const allowed = new Set(allowedTargets);
    const targets: TargetCapabilityScope['targets'] = {};
    for (const target of definition.supportedTargets) {
      if (allowed.has(target) && parsed.targets[target]) targets[target] = parsed.targets[target];
    }
    return Object.keys(targets).length > 0 ? { kind: 'targets', targets } : null;
  }

  allows(capability: AgentCapability, scope: CapabilityGrantScope, target?: AgentTargetSelector): boolean {
    const definition = this.require(capability);
    const parsed = this.parseScope(capability, scope);
    if (definition.scopeKind === 'global') return true;
    if (!target || parsed.kind !== 'targets') return false;
    const selection = parsed.targets[target.target];
    if (!selection) return false;
    return selection.mode === 'all' || selection.ids.includes(target.id);
  }

  private intersectSelection(
    left: TargetGrantSelection | undefined,
    right: TargetGrantSelection | undefined,
  ): TargetGrantSelection | null {
    if (!left || !right) return null;
    if (left.mode === 'all') return right.mode === 'all' ? { mode: 'all' } : { mode: 'ids', ids: [...right.ids] };
    if (right.mode === 'all') return { mode: 'ids', ids: [...left.ids] };
    const rightIds = new Set(right.ids);
    const ids = left.ids.filter((id) => rightIds.has(id));
    return ids.length > 0 ? { mode: 'ids', ids } : null;
  }

  toJson(scope: CapabilityGrantScope): JsonValue {
    return scope as unknown as JsonValue;
  }
}
