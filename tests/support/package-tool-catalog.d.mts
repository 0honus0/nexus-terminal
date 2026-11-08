import type { AgentToolIdentity } from '../../packages/shared/src/agent/tools/identity';
export type ExpectedToolIdentity = { packageId: string; name: string };
export type ToolReference = string | ExpectedToolIdentity | { rawToolName: string };
type Declaration = { name: string; description?: string; parameters: Record<string, unknown> };
type Catalog = { tools?: Array<Declaration | { function: Declaration }> };
export function expectedToolIdentity(name: string): ExpectedToolIdentity;
export function hasToolIdentity(
	value:
		| { identity_json: string }
		| { identity: AgentToolIdentity }
		| { inspection: { identity: AgentToolIdentity } }
		| AgentToolIdentity,
	expected: string | ExpectedToolIdentity,
): boolean;
export function findPackageTool(body: Catalog, packageId: string, localName: string): Declaration | undefined;
export function packageTool(body: Catalog, packageId: string, localName: string): Declaration;
export function findFixtureTool(body: Catalog, reference: string | ExpectedToolIdentity): Declaration | undefined;
export function rawToolName(name: string): { rawToolName: string };
export function fixtureToolName(body: Catalog, reference: ToolReference): string;

export function toolIdentityOf(
	value:
		| { identity_json: string }
		| { identity: AgentToolIdentity }
		| { inspection: { identity: AgentToolIdentity } }
		| AgentToolIdentity,
): AgentToolIdentity;
export function pluginToolRows<T extends { identity_json: string }>(rows: T[]): T[];

export function hasApprovalIdentity(value: { operationName: string }, expected: string): boolean;
export function hasApprovalIdentity(
	value: Parameters<typeof hasToolIdentity>[0],
	expected: ExpectedToolIdentity,
): boolean;
