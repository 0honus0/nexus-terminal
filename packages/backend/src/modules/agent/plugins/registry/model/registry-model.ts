import { createHash, randomUUID } from 'node:crypto';
import { JsonSchemaValidator } from '../../../../../platform/validation/json-schema-validator.js';
import { AgentFailure } from '../../../agent-failure.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import type {
	RegistryBinding,
	RegistryCaller,
	RegistryDefinition,
	RegistryDescription,
	RegistryEntry,
	RegistryEventValue,
	RegistryPage,
	RegistryProvider,
	RegistryQuery,
	RegistryResolvedCall,
	RegistryScope,
} from './registry-types.js';
import type { RegistryBoundCallable } from './registry-types.js';

interface Registration {
	provider: RegistryProvider;
	description: RegistryDescription;
	input: JsonSchemaValidator | null;
	result: JsonSchemaValidator;
}

interface BoundRegistration {
	caller: RegistryScope & { ownerId: string };
	binding: RegistryBinding;
	registration: Registration;
}

function packageReference(value: RegistryProvider['package']): RegistryProvider['package'] {
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

function definition(value: RegistryDefinition): RegistryDefinition {
	if (value.kind === 'event') {
		return {
			kind: value.kind,
			key: value.key,
			contract: value.contract,
			apiVersion: value.apiVersion,
			summary: value.summary,
			payloadSchemaJson: value.payloadSchemaJson,
			source:
				value.source.kind === 'transient'
					? { kind: 'transient' }
					: { kind: value.source.kind, callableKey: value.source.callableKey },
		};
	}
	return {
		kind: value.kind,
		key: value.key,
		contract: value.contract,
		apiVersion: value.apiVersion,
		summary: value.summary,
		instructions: value.instructions,
		inputSchemaJson: value.inputSchemaJson,
		resultSchemaJson: value.resultSchemaJson,
		capabilities: value.capabilities.map((value) => value),
		tags: value.tags.map((value) => value),
		execution: value.execution,
	};
}

function entry(value: RegistryEntry): RegistryEntry {
	return {
		id: value.id,
		instanceId: value.instanceId,
		package: packageReference(value.package),
		generation: value.generation,
		key: value.key,
		kind: value.kind,
		contract: value.contract,
		apiVersion: value.apiVersion,
		summary: value.summary,
		tags: value.tags.map((value) => value),
	};
}

function binding(value: RegistryBinding): RegistryBinding {
	return {
		id: value.id,
		entryId: value.entryId,
		instanceId: value.instanceId,
		generation: value.generation,
		configurationRevision: value.configurationRevision,
		schemaSha256: value.schemaSha256,
	};
}

function provider(value: RegistryProvider): RegistryProvider {
	return {
		packageRevision: value.packageRevision,
		userId: value.userId,
		appId: value.appId,
		instanceId: value.instanceId,
		generation: value.generation,
		configurationRevision: value.configurationRevision,
		package: packageReference(value.package),
		namespaces: value.namespaces.map((value) => value),
		appEntry: value.appEntry,
		tools: value.tools,
		services: value.services,
		capabilities: value.capabilities.map((value) => value),
	};
}

function key(scope: RegistryScope): string {
	return scope.userId + ':' + scope.appId;
}

function sameScope(a: RegistryScope, b: RegistryScope): boolean {
	return a.userId === b.userId && a.appId === b.appId;
}

/** Ephemeral registrations and handles. Persistent effects belong to the Operation owner. */
export class RegistryModel {
	private readonly entries = new Map<string, Registration>();
	private readonly instances = new Map<string, { provider: RegistryProvider; entries: Registration[] }>();
	private readonly bindings = new Map<string, BoundRegistration>();
	private readonly revisions = new Map<string, number>();
	private readonly listeners = new Map<string, Set<() => void>>();
	private readonly events = new Map<string, Set<(event: RegistryEventValue) => void>>();
	private readonly latestEvents = new Map<string, RegistryEventValue>();

	constructor(private readonly observerFailed: (error: unknown) => void) {}

	publish(
		owner: RegistryProvider,
		definitions: readonly RegistryDefinition[],
		expectedGeneration: string | null,
	): () => void {
		const current = this.instances.get(owner.instanceId);
		if (
			(current?.provider.generation ?? null) !== expectedGeneration ||
			(current && !sameScope(current.provider, owner))
		) {
			throw new AgentFailure('version_conflict');
		}
		// Compile and validate the whole replacement before invalidating any existing handler.
		const snapshot = provider(owner);
		const unchangedProvider =
			current !== undefined && JSON.stringify(current.provider) === JSON.stringify(snapshot);
		const previousEntries = new Map(current?.entries.map((item) => [item.description.entry.key, item]));
		// Share only compiled schemas within this publication. Registrations retain the validators they use;
		// retired schemas have no process-wide cache or independent lifetime.
		const validators = new Map<string, JsonSchemaValidator>();
		for (const item of current?.entries ?? []) {
			const value = item.description.definition;
			if (value.kind === 'event') {
				validators.set(value.payloadSchemaJson, item.result);
			} else {
				if (item.input) {
					validators.set(value.inputSchemaJson, item.input);
				}
				validators.set(value.resultSchemaJson, item.result);
			}
		}

		const compile = (schema: string): JsonSchemaValidator => {
			let validator = validators.get(schema);
			if (!validator) {
				validator = new JsonSchemaValidator(schema);
				validators.set(schema, validator);
			}
			return validator;
		};

		const keys = new Set<string>();
		const prepared = definitions.map((value): Registration => {
			if (
				keys.has(value.key) ||
				!snapshot.namespaces.some(
					(namespace) => value.contract === namespace || value.contract.startsWith(namespace + '.'),
				)
			) {
				throw new AgentFailure('invalid_input');
			}
			keys.add(value.key);
			if (
				(value.kind === 'app' && value.key !== snapshot.appEntry) ||
				(value.kind === 'tool' && !snapshot.tools) ||
				(value.kind === 'service' && !snapshot.services) ||
				(value.kind !== 'event' &&
					value.capabilities.some((capability) => !snapshot.capabilities.includes(capability)))
			) {
				throw new AgentFailure('capability_undeclared');
			}
			const previous = unchangedProvider ? previousEntries.get(value.key) : undefined;
			const projectedDefinition = definition(value);
			if (previous && JSON.stringify(previous.description.definition) === JSON.stringify(projectedDefinition)) {
				return previous;
			}
			const schemas =
				value.kind === 'event' ? [value.payloadSchemaJson] : [value.inputSchemaJson, value.resultSchemaJson];
			let input: JsonSchemaValidator | null;
			let result: JsonSchemaValidator;
			try {
				input = value.kind === 'event' ? null : compile(value.inputSchemaJson);
				result = compile(value.kind === 'event' ? value.payloadSchemaJson : value.resultSchemaJson);
			} catch (cause) {
				throw new AgentFailure('invalid_input', { cause });
			}
			return {
				provider: snapshot,
				input,
				result,
				description: {
					entry: {
						id: randomUUID(),
						instanceId: snapshot.instanceId,
						generation: snapshot.generation,
						package: packageReference(snapshot.package),
						key: value.key,
						kind: value.kind,
						contract: value.contract,
						apiVersion: value.apiVersion,
						summary: value.summary,
						tags: value.kind === 'event' ? [] : value.tags.map((tag) => tag),
					},
					definition: projectedDefinition,
					schemaSha256: createHash('sha256').update(JSON.stringify(schemas)).digest('hex'),
				},
			};
		});
		const callableKeys = new Set(
			prepared
				.filter((item) => item.description.definition.kind !== 'event')
				.map((item) => item.description.entry.key),
		);
		for (const value of prepared) {
			const def = value.description.definition;
			if (def.kind === 'event' && def.source.kind !== 'transient') {
				if (!callableKeys.has(def.source.callableKey)) {
					throw new AgentFailure('invalid_input');
				}
			}
		}
		if (current) {
			const retained = new Set(prepared);
			for (const item of current.entries) {
				if (!retained.has(item)) {
					this.removeEntry(item);
				}
			}
		}
		const publication = { provider: snapshot, entries: prepared };
		this.instances.set(owner.instanceId, publication);
		for (const value of prepared) {
			this.entries.set(value.description.entry.id, value);
		}
		this.changed(owner);
		return () => {
			if (this.instances.get(owner.instanceId) === publication) {
				this.remove(owner);
				this.changed(owner);
			}
		};
	}

	providerOf(scope: RegistryScope, instanceId: string, generation: string): RegistryProvider {
		const current = this.instances.get(instanceId);
		if (!current || !sameScope(scope, current.provider) || current.provider.generation !== generation) {
			throw new AgentFailure('version_conflict');
		}
		return provider(current.provider);
	}

	wait(scope: RegistryScope, revision: number, signal: AbortSignal): Promise<number> {
		return new Promise((resolve, reject) => {
			let unsubscribe = () => {};

			const close = () => {
				unsubscribe();
				signal.removeEventListener('abort', abort);
			};

			const abort = () => {
				close();
				reject(new AgentFailure('provider_unavailable', { cause: signal.reason }));
			};

			const changed = () => {
				const current = this.revision(scope);
				if (current !== revision) {
					close();
					resolve(current);
				}
			};

			unsubscribe = this.subscribe(scope, changed);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) {
				abort();
			} else {
				changed();
			}
		});
	}

	waitEvent(
		caller: RegistryCaller,
		entryId: string,
		afterRevision: number,
		signal: AbortSignal,
	): Promise<RegistryEventValue> {
		return new Promise((resolve, reject) => {
			let unsubscribeEvent = () => {};

			let unsubscribeDirectory = () => {};

			const close = () => {
				unsubscribeEvent();
				unsubscribeDirectory();
				signal.removeEventListener('abort', abort);
			};

			const abort = () => {
				close();
				reject(new AgentFailure('provider_unavailable', { cause: signal.reason }));
			};

			const check = () => {
				try {
					const current = this.latestEvent(caller, entryId);
					if (current && current.revision > afterRevision) {
						close();
						resolve(current);
					}
				} catch (error) {
					close();
					reject(error);
				}
			};

			try {
				unsubscribeEvent = this.subscribeEvent(caller, entryId, check);
				unsubscribeDirectory = this.subscribe(caller, check);
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) {
					abort();
				} else {
					check();
				}
			} catch (error) {
				close();
				reject(error);
			}
		});
	}

	private removeEntry(value: Registration): void {
		this.entries.delete(value.description.entry.id);
		this.events.delete(value.description.entry.id);
		this.latestEvents.delete(value.description.entry.id);
		for (const [id, bound] of this.bindings) {
			if (bound.registration === value) {
				this.bindings.delete(id);
			}
		}
	}

	private notify(work: () => void): void {
		try {
			work();
		} catch (error) {
			this.observerFailed(error);
		}
	}

	revision(scope: RegistryScope): number {
		return this.revisions.get(key(scope)) ?? 0;
	}

	private remove(owner: RegistryProvider): void {
		const current = this.instances.get(owner.instanceId);
		if (!current || current.provider.generation !== owner.generation) {
			return;
		}
		for (const value of current.entries) {
			this.removeEntry(value);
		}
		for (const [id, value] of this.bindings) {
			if (value.binding.instanceId === owner.instanceId && value.binding.generation === owner.generation) {
				this.bindings.delete(id);
			}
		}
		this.instances.delete(owner.instanceId);
	}

	invalidate(scope: RegistryScope): void {
		this.changed(scope);
	}

	private changed(scope: RegistryScope): void {
		const id = key(scope);
		this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
		// Observers only schedule invalidation; a failed observer cannot roll back a published batch.
		for (const listener of this.listeners.get(id) ?? []) {
			this.notify(listener);
		}
	}

	subscribe(scope: RegistryScope, listener: () => void): () => void {
		const id = key(scope);
		let listeners = this.listeners.get(id);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(id, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			if (!listeners.size) {
				this.listeners.delete(id);
			}
		};
	}

	private visible(caller: RegistryCaller, value: Registration): boolean {
		const definition = value.description.definition;
		const toolVisible =
			definition.kind !== 'tool' ||
			(caller.visibleToolInstanceIds.includes(value.provider.instanceId) &&
				(caller.visibleToolKeys === null || caller.visibleToolKeys.includes(definition.key)));
		return (
			sameScope(caller, value.provider) &&
			caller.visibleInstanceIds.includes(value.provider.instanceId) &&
			toolVisible &&
			(definition.kind === 'event' ||
				definition.capabilities.every((capability) => caller.capabilities.includes(capability)))
		);
	}

	discover(caller: RegistryCaller, query: RegistryQuery): RegistryPage {
		const revision = this.revisions.get(key(caller)) ?? 0;
		let after = '';
		if (query.cursor !== null) {
			const separator = query.cursor.indexOf(':');
			if (separator === -1 || query.cursor.slice(0, separator) !== String(revision)) {
				throw new AgentFailure('version_conflict');
			}
			after = query.cursor.slice(separator + 1);
		}
		const available = [...this.entries.values()]
			.filter(
				(value) =>
					this.visible(caller, value) &&
					(query.contract === null || query.contract === value.description.entry.contract) &&
					(query.apiVersion === null || query.apiVersion === value.description.entry.apiVersion) &&
					(query.kind === null || query.kind === value.description.entry.kind),
			)
			.sort((a, b) => a.description.entry.id.localeCompare(b.description.entry.id));
		const result: RegistryEntry[] = [];
		let size = 256;
		let nextCursor: string | null = null;
		for (const value of available) {
			if (value.description.entry.id <= after) {
				continue;
			}
			const projected = entry(value.description.entry);
			const bytes = Buffer.byteLength(JSON.stringify(projected));
			if (size + bytes > AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024) {
				const last = result.at(-1);
				if (!last) {
					throw new AgentFailure('limit_exceeded');
				}
				nextCursor = revision + ':' + last.id;
				break;
			}
			size += bytes + 1;
			result.push(projected);
		}
		return { revision, entries: result, nextCursor };
	}

	describe(caller: RegistryCaller, entryId: string): RegistryDescription {
		const value = this.entries.get(entryId);
		if (!value || !this.visible(caller, value)) {
			throw new AgentFailure('not_found');
		}
		return {
			entry: entry(value.description.entry),
			definition: definition(value.description.definition),
			schemaSha256: value.description.schemaSha256,
		};
	}

	bind(caller: RegistryCaller, entryId: string): RegistryBinding {
		const registration = this.entries.get(entryId);
		if (
			!registration ||
			!this.visible(caller, registration) ||
			registration.description.definition.kind === 'event'
		) {
			throw new AgentFailure('not_found');
		}
		const value: RegistryBinding = {
			id: randomUUID(),
			entryId,
			instanceId: registration.provider.instanceId,
			generation: registration.provider.generation,
			configurationRevision: registration.provider.configurationRevision,
			schemaSha256: registration.description.schemaSha256,
		};
		this.bindings.set(value.id, {
			caller: { userId: caller.userId, appId: caller.appId, ownerId: caller.ownerId },
			registration,
			binding: value,
		});
		return binding(value);
	}

	private bound(caller: RegistryCaller, bindingId: string): BoundRegistration {
		const value = this.bindings.get(bindingId);
		if (
			!value ||
			!sameScope(value.caller, caller) ||
			value.caller.ownerId !== caller.ownerId ||
			this.entries.get(value.binding.entryId) !== value.registration ||
			!this.visible(caller, value.registration)
		) {
			throw new AgentFailure('version_conflict');
		}
		const def = value.registration.description.definition;
		if (def.kind === 'event' || !value.registration.input) {
			throw new AgentFailure('invalid_input');
		}
		return value;
	}

	describeBinding(caller: RegistryCaller, bindingId: string): RegistryBoundCallable {
		const value = this.bound(caller, bindingId);
		const def = value.registration.description.definition;
		if (def.kind === 'event') {
			throw new AgentFailure('invalid_input');
		}
		return {
			binding: binding(value.binding),
			provider: provider(value.registration.provider),
			definition: {
				kind: def.kind,
				key: def.key,
				contract: def.contract,
				apiVersion: def.apiVersion,
				summary: def.summary,
				instructions: def.instructions,
				inputSchemaJson: def.inputSchemaJson,
				resultSchemaJson: def.resultSchemaJson,
				capabilities: def.capabilities.map((capability) => capability),
				tags: def.tags.map((tag) => tag),
				execution: def.execution,
			},
		};
	}

	resolve(caller: RegistryCaller, bindingId: string, argumentsJson: string): RegistryResolvedCall {
		const value = this.bound(caller, bindingId);
		const description = this.describeBinding(caller, bindingId);
		if (!value.registration.input) {
			throw new AgentFailure('invalid_input');
		}
		const json = this.validatedJson(value.registration.input, argumentsJson);
		return {
			binding: description.binding,
			provider: description.provider,
			definition: description.definition,
			argumentsJson: json,

			validateResult: (resultJson) => this.validatedJson(value.registration.result, resultJson),
		};
	}

	validateResult(caller: RegistryCaller, bindingId: string, resultJson: string): string {
		const value = this.bindings.get(bindingId);
		if (!value || !sameScope(caller, value.caller) || caller.ownerId !== value.caller.ownerId) {
			throw new AgentFailure('version_conflict');
		}
		return this.validatedJson(value.registration.result, resultJson);
	}

	private validatedJson(validator: JsonSchemaValidator, json: string): string {
		let value: unknown;
		try {
			value = JSON.parse(json);
		} catch (cause) {
			throw new AgentFailure('invalid_input', { cause });
		}
		if (!validator.validate(value)) {
			throw new AgentFailure('invalid_input');
		}
		return JSON.stringify(value);
	}

	release(caller: RegistryScope & { ownerId: string }): void {
		for (const [id, value] of this.bindings) {
			if (sameScope(caller, value.caller) && caller.ownerId === value.caller.ownerId) {
				this.bindings.delete(id);
			}
		}
	}

	subscribeEvent(caller: RegistryCaller, entryId: string, listener: (event: RegistryEventValue) => void): () => void {
		const value = this.entries.get(entryId);
		if (!value || !this.visible(caller, value) || value.description.definition.kind !== 'event') {
			throw new AgentFailure('not_found');
		}
		let listeners = this.events.get(entryId);
		if (!listeners) {
			listeners = new Set();
			this.events.set(entryId, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			if (!listeners.size && this.events.get(entryId) === listeners) {
				this.events.delete(entryId);
			}
		};
	}

	latestEvent(caller: RegistryCaller, entryId: string): RegistryEventValue | null {
		const value = this.entries.get(entryId);
		if (!value || !this.visible(caller, value) || value.description.definition.kind !== 'event') {
			throw new AgentFailure('not_found');
		}
		const event = this.latestEvents.get(entryId);
		return event
			? {
					instanceId: event.instanceId,
					generation: event.generation,
					key: event.key,
					revision: event.revision,
					cursor: event.cursor,
					payloadJson: event.payloadJson,
				}
			: null;
	}

	publishEvent(
		owner: RegistryProvider,
		input: { key: string; cursor: string | null; payloadJson: string },
	): RegistryEventValue {
		const instance = this.instances.get(owner.instanceId);
		if (!instance || !sameScope(owner, instance.provider) || owner.generation !== instance.provider.generation) {
			throw new AgentFailure('version_conflict');
		}
		const value = instance.entries.find((value) => value.description.entry.key === input.key);
		if (!value || value.description.definition.kind !== 'event') {
			throw new AgentFailure('not_found');
		}
		const payloadJson = this.validatedJson(value.result, input.payloadJson);
		const revision = (this.latestEvents.get(value.description.entry.id)?.revision ?? 0) + 1;
		if (!Number.isSafeInteger(revision)) {
			throw new AgentFailure('limit_exceeded');
		}
		const event: RegistryEventValue = {
			instanceId: owner.instanceId,
			generation: owner.generation,
			key: input.key,
			revision,
			cursor: input.cursor,
			payloadJson,
		};
		this.latestEvents.set(value.description.entry.id, event);
		for (const listener of this.events.get(value.description.entry.id) ?? []) {
			this.notify(() =>
				listener({
					instanceId: event.instanceId,
					generation: event.generation,
					key: event.key,
					revision,
					cursor: event.cursor,
					payloadJson,
				}),
			);
		}
		return {
			instanceId: event.instanceId,
			generation: event.generation,
			key: event.key,
			revision,
			cursor: event.cursor,
			payloadJson,
		};
	}
}
