import type { JsonValue, Scope } from '../agent.types';
import type { AgentCapability } from '../host/app.types';
import { prepareJsonSchema } from '../json-schema-validator';
import type { AgentTool, ToolAvailabilityContext, ToolDescriptor } from './tool.types';

export interface CatalogToolSchema {
  name: string;
  description: string;
  inputSchema: JsonValue;
}

export interface CapabilityContribution {
  schemaVersion: 1;
  id: string;
  capability: AgentCapability;
  tools: readonly AgentTool[];
}

interface RegisteredTool {
  tool: AgentTool;
  scope: Scope | null;
  ownerKey: string | null;
}

const sameScope = (left: Scope, right: Scope): boolean => left.userId === right.userId && left.appId === right.appId;

const canonicalJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  ) as JsonValue;
};

export class ToolCatalog {
  private readonly tools = new Map<string, RegisteredTool>();

  registerContribution(contribution: CapabilityContribution): void {
    this.validateContribution(contribution, () => false);
    this.installContribution(contribution);
  }

  replaceOwnedContribution(scope: Scope, ownerKey: string, contribution: CapabilityContribution): void {
    this.validateContribution(
      contribution,
      (registered) =>
        registered.ownerKey === ownerKey && registered.scope !== null && sameScope(registered.scope, scope),
    );
    this.removeOwned(scope, ownerKey);
    this.installContribution(contribution, scope, ownerKey);
  }

  removeOwned(scope: Scope, ownerKey: string): void {
    for (const [name, registered] of this.tools) {
      if (registered.ownerKey === ownerKey && registered.scope && sameScope(registered.scope, scope))
        this.tools.delete(name);
    }
  }

  require(name: string, scope?: Scope): AgentTool {
    const registered = this.tools.get(name);
    if (!registered) throw new Error('TOOL_NOT_FOUND');
    if (registered.scope && (!scope || !sameScope(registered.scope, scope))) throw new Error('TOOL_NOT_FOUND');
    return registered.tool;
  }

  list(scope: Scope, availability?: ToolAvailabilityContext): ToolDescriptor[] {
    return [...this.tools.values()]
      .filter(
        (registered) =>
          (!registered.scope || sameScope(registered.scope, scope)) &&
          (!availability || !registered.tool.isAvailable || registered.tool.isAvailable(availability)),
      )
      .map((registered) => ({
        ...registered.tool.descriptor,
        inputSchema: canonicalJson(registered.tool.descriptor.inputSchema),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  discover(scope: Scope, query = '', max = 12, availability?: ToolAvailabilityContext): ToolDescriptor[] {
    if (!Number.isSafeInteger(max) || max < 1 || max > 256) throw new Error('VALIDATION_FAILED');
    const needle = query.trim().toLowerCase();
    return this.list(scope, availability)
      .filter((descriptor) => !needle || `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(needle))
      .slice(0, max);
  }

  schemas(scope: Scope, availability?: ToolAvailabilityContext): CatalogToolSchema[] {
    return this.discover(scope, '', 256, availability).map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
    }));
  }

  private validateContribution(
    contribution: CapabilityContribution,
    replaceable: (registered: RegisteredTool) => boolean,
  ): void {
    if (
      contribution.schemaVersion !== 1 ||
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(contribution.id) ||
      contribution.tools.length > 256
    ) {
      throw new Error('CAPABILITY_CONTRIBUTION_INVALID');
    }
    const names = new Set<string>();
    for (const tool of contribution.tools) {
      if (tool.descriptor.capability !== contribution.capability) {
        throw new Error('CAPABILITY_CONTRIBUTION_MISMATCH');
      }
      if (names.has(tool.descriptor.name)) throw new Error(`Duplicate Agent tool: ${tool.descriptor.name}`);
      names.add(tool.descriptor.name);
      const existing = this.tools.get(tool.descriptor.name);
      if (existing && !replaceable(existing)) throw new Error(`Duplicate Agent tool: ${tool.descriptor.name}`);
      prepareJsonSchema(tool.descriptor.inputSchema);
    }
  }

  private installContribution(contribution: CapabilityContribution, scope?: Scope, ownerKey?: string): void {
    for (const tool of contribution.tools) {
      this.tools.set(tool.descriptor.name, {
        tool,
        scope: scope ?? null,
        ownerKey: ownerKey ?? null,
      });
    }
  }
}
