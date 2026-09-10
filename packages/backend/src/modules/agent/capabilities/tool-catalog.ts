import type { JsonValue, Scope } from '../agent.types';
import type { AgentCapability } from '../host/app.types';
import { prepareJsonSchema } from '../json-schema-validator';
import type { AgentTool, ToolDescriptor } from './tool.types';

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

export interface CapabilityContributionView {
  schemaVersion: 1;
  id: string;
  capability: AgentCapability;
  tools: ToolDescriptor[];
}

interface RegisteredTool {
  tool: AgentTool;
  scope: Scope | null;
  ownerKey: string | null;
  contributionId: string | null;
}

const sameScope = (left: Scope, right: Scope): boolean => left.userId === right.userId && left.appId === right.appId;

export class ToolCatalog {
  private readonly tools = new Map<string, RegisteredTool>();

  registerContribution(contribution: CapabilityContribution, scope?: Scope, ownerKey?: string): void {
    this.validateContribution(contribution, () => false);
    this.installContribution(contribution, scope, ownerKey);
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

  discover(scope: Scope, query = '', max = 12): ToolDescriptor[] {
    if (!Number.isSafeInteger(max) || max < 1 || max > 256) throw new Error('VALIDATION_FAILED');
    const needle = query.trim().toLowerCase();
    return [...this.tools.values()]
      .filter((registered) => !registered.scope || sameScope(registered.scope, scope))
      .map((registered) => registered.tool.descriptor)
      .filter((descriptor) => !needle || `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(needle))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, max)
      .map((descriptor) => ({
        ...descriptor,
        inputSchema: JSON.parse(JSON.stringify(descriptor.inputSchema)) as JsonValue,
      }));
  }

  contributions(scope: Scope): CapabilityContributionView[] {
    const grouped = new Map<string, CapabilityContributionView>();
    for (const registered of this.tools.values()) {
      if (!registered.contributionId || (registered.scope && !sameScope(registered.scope, scope))) continue;
      const current = grouped.get(registered.contributionId) ?? {
        schemaVersion: 1 as const,
        id: registered.contributionId,
        capability: registered.tool.descriptor.capability,
        tools: [],
      };
      if (current.capability !== registered.tool.descriptor.capability)
        throw new Error('CAPABILITY_CONTRIBUTION_MISMATCH');
      current.tools.push({
        ...registered.tool.descriptor,
        inputSchema: JSON.parse(JSON.stringify(registered.tool.descriptor.inputSchema)) as JsonValue,
      });
      grouped.set(current.id, current);
    }
    return [...grouped.values()]
      .map((contribution) => ({
        ...contribution,
        tools: contribution.tools.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  schemas(scope: Scope): CatalogToolSchema[] {
    return this.discover(scope, '', 256).map((descriptor) => ({
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
        contributionId: contribution.id,
      });
    }
  }
}
