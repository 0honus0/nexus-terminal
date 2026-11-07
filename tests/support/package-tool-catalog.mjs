import assert from 'node:assert/strict';
import { readAgentToolIdentity } from '../../packages/shared/dist/agent/tools/identity-codec.js';
import approvalOperations from './tool-approval-operations.json' with { type: 'json' };
import toolPackages from './tool-package-identities.json' with { type: 'json' };

const declarations = (body) => (body.tools ?? []).map((entry) => entry.function ?? entry);

/** The package map describes test expectations; the actual Host catalog owns every wire name. */
export function expectedToolIdentity(name) {
	const packageId = toolPackages[name];
	assert.ok(packageId, 'Expected an explicit installed-package identity for tool: ' + name);
	return { packageId, name };
}

export function toolIdentityOf(value) {
	const candidate =
		value?.identity ??
		value?.inspection?.identity ??
		(typeof value?.identity_json === 'string' ? JSON.parse(value.identity_json) : value);
	return readAgentToolIdentity(candidate);
}

export function pluginToolRows(rows) {
	return rows.filter((row) => toolIdentityOf(row).kind === 'plugin');
}

export function hasToolIdentity(value, expected) {
	const identity = toolIdentityOf(value);
	const reference = typeof expected === 'string' ? expectedToolIdentity(expected) : expected;
	const key = reference.name.startsWith(reference.packageId + '.')
		? reference.name
		: reference.packageId + '.' + reference.name;
	return identity?.kind === 'plugin' && identity.packageId === reference.packageId && identity.name === key;
}

/** Discovery may inspect absence; emitting an actual positive call always requires packageTool. */
export function findPackageTool(body, packageId, localName) {
	const suffix = '_' + localName.slice(0, 48);
	const matches = declarations(body).filter(
		(entry) => /^nt_[a-f0-9]{12}_/u.test(entry.name) && entry.name.endsWith(suffix),
	);
	assert.ok(matches.length <= 1, 'Ambiguous installed package tool: ' + packageId + ' / ' + localName);
	if (matches.length === 0) return undefined;
	assert.match(matches[0].name, /^nt_[a-f0-9]{12}_[a-zA-Z0-9_-]+$/u);
	return matches[0];
}

/** Select the actual Host declaration by signed package identity and local tool name. */
export function packageTool(body, packageId, localName) {
	const definition = findPackageTool(body, packageId, localName);
	assert.ok(definition, 'Expected one installed package tool: ' + packageId + ' / ' + localName);
	return definition;
}

export function findFixtureTool(body, reference) {
	if (typeof reference === 'string' && /^nt_[a-f0-9]{12}_[a-zA-Z0-9_-]+$/u.test(reference)) {
		return declarations(body).find((entry) => entry.name === reference);
	}
	const identity = typeof reference === 'string' ? expectedToolIdentity(reference) : reference;
	return findPackageTool(body, identity.packageId, identity.name);
}

/** Negative fixtures must deliberately opt into an untrusted/unknown Provider name. */
export const rawToolName = (name) => ({ rawToolName: name });

export function fixtureToolName(body, reference) {
	if (typeof reference === 'object' && reference !== null && 'rawToolName' in reference) return reference.rawToolName;
	const definition = findFixtureTool(body, reference);
	assert.ok(definition, 'Positive fixture call is absent from actual Provider catalog: ' + JSON.stringify(reference));
	return definition.name;
}

/** Explicit test expectations match the independently governed Host operation, never its parent wire name. */
export function hasApprovalIdentity(value, expected) {
	if (typeof expected !== 'string') return hasToolIdentity(value, expected);
	const operations = approvalOperations[expected];
	assert.ok(operations, 'Expected explicit Host approval operations for tool: ' + expected);
	return operations.includes(value.operationName);
}
