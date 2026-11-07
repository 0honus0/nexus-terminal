import type { AgentPluginUiArtifactSelection } from '@nexus-terminal/shared/agent/plugins/ui-events';
import { attachManagedArtifact, getManagedArtifact } from '../../api/artifact-management-api';
import type { ManagedArtifact } from '../../model/artifact-types';
import type {
	HostArtifactSelection,
	HostArtifactSelectionAnchor,
	HostArtifactSelectionOptions,
} from './host-artifact-selection-types';
import { AgentManagementFailure } from '../../model/management-failure';

interface SelectedArtifact {
	key: string;
	item: ManagedArtifact;
}

function copyArtifact(item: ManagedArtifact): ManagedArtifact {
	return {
		id: item.id,
		appId: item.appId,
		name: item.name,
		mediaType: item.mediaType,
		kind: item.kind,
		sizeBytes: item.sizeBytes,
		sha256: item.sha256,
		status: item.status,
		retained: item.retained,
		version: item.version,
		createdAt: item.createdAt,
		readyAt: item.readyAt,
		expiresAt: item.expiresAt,
		deletedAt: item.deletedAt,
	};
}

function selection(key: string, item: ManagedArtifact): AgentPluginUiArtifactSelection {
	if (item.status !== 'ready' || item.sha256 === null) {
		throw new AgentManagementFailure('version_conflict', 'not_dispatched');
	}
	return {
		key,
		id: item.id,
		name: item.name,
		version: item.version,
		sha256: item.sha256,
		mediaType: item.mediaType,
		sizeBytes: item.sizeBytes,
	};
}

function rejectReadFailures(failures: unknown[]): void {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	const first =
		failures.find(
			(error) =>
				error instanceof AgentManagementFailure &&
				(error.code === 'unauthenticated' || error.code === 'forbidden'),
		) ?? failures[0];
	const cause = new AggregateError(failures, 'Selected Artifact reads failed');
	if (first instanceof AgentManagementFailure) {
		throw new AgentManagementFailure(first.code, first.outcome, { cause });
	}
	throw cause;
}

/** This owner belongs to one authenticated frame. Only explicit picker choices create keys. */
export function createHostArtifactSelection(options: HostArtifactSelectionOptions): HostArtifactSelection {
	const artifacts = new Map<string, ManagedArtifact>();
	const lifetime = new AbortController();
	const originalFrame = options.frame();
	let closed = false;
	let pickerGeneration = 0;

	function assertCurrent(signal: AbortSignal, outcome: 'not_dispatched' | 'unknown' = 'not_dispatched'): void {
		if (
			closed ||
			signal.aborted ||
			!originalFrame ||
			options.frame() !== originalFrame ||
			!originalFrame.isConnected
		) {
			throw new AgentManagementFailure('cancelled', outcome);
		}
	}

	function selected(keys: string[]): SelectedArtifact[] {
		if (new Set(keys).size !== keys.length) {
			throw new AgentManagementFailure('invalid_input', 'not_dispatched');
		}
		return keys.map((key) => {
			const item = artifacts.get(key);
			if (!item) throw new AgentManagementFailure('invalid_input', 'not_dispatched');
			return { key, item };
		});
	}

	function parentAnchor(
		anchor: HostArtifactSelectionAnchor,
		element: HTMLIFrameElement,
	): HostArtifactSelectionAnchor {
		if (
			![anchor.left, anchor.top, anchor.width, anchor.height].every(Number.isFinite) ||
			anchor.left < 0 ||
			anchor.top < 0 ||
			anchor.width < 0 ||
			anchor.height < 0 ||
			anchor.left + anchor.width > element.clientWidth ||
			anchor.top + anchor.height > element.clientHeight ||
			element.offsetWidth === 0 ||
			element.offsetHeight === 0
		) {
			throw new AgentManagementFailure('invalid_input', 'not_dispatched');
		}
		return projectAnchor(anchor, element);
	}

	function projectAnchor(
		anchor: HostArtifactSelectionAnchor,
		element: HTMLIFrameElement,
	): HostArtifactSelectionAnchor {
		const frame = element.getBoundingClientRect();
		const scaleX = frame.width / element.offsetWidth;
		const scaleY = frame.height / element.offsetHeight;
		return {
			left: frame.left + (element.clientLeft + anchor.left) * scaleX,
			top: frame.top + (element.clientTop + anchor.top) * scaleY,
			width: anchor.width * scaleX,
			height: anchor.height * scaleY,
		};
	}

	function storeChoice(item: ManagedArtifact): AgentPluginUiArtifactSelection {
		for (const [key, original] of artifacts) {
			if (original.appId === item.appId && original.id === item.id) {
				if (item.version >= original.version) artifacts.set(key, copyArtifact(item));
				return selection(key, item.version >= original.version ? item : original);
			}
		}
		const key = crypto.randomUUID();
		artifacts.set(key, copyArtifact(item));
		return selection(key, item);
	}

	return {
		async open(anchor, keys, requestSignal) {
			const signal = AbortSignal.any([requestSignal, lifetime.signal]);
			assertCurrent(signal);
			const originals = selected(keys);
			const element = options.frame();
			if (!element || element !== originalFrame) {
				throw new AgentManagementFailure('cancelled', 'not_dispatched');
			}
			let position = parentAnchor(anchor, element);
			const current = ++pickerGeneration;
			const values = await options.pick(
				{
					appId: options.appId,
					items: originals.map(({ item }) => copyArtifact(item)),
					element,

					anchor() {
						if (
							element.isConnected &&
							options.frame() === element &&
							element.offsetWidth > 0 &&
							element.offsetHeight > 0
						) {
							position = projectAnchor(anchor, element);
						}
						return {
							left: position.left,
							top: position.top,
							width: position.width,
							height: position.height,
						};
					},
				},
				signal,
			);
			assertCurrent(signal);
			if (current !== pickerGeneration) throw new AgentManagementFailure('cancelled', 'not_dispatched');
			if (
				new Set(values.map((item) => item.id)).size !== values.length ||
				values.some((item) => item.status !== 'ready')
			) {
				throw new AgentManagementFailure('invalid_input', 'not_dispatched');
			}
			return values.map(storeChoice);
		},

		async read(keys, requestSignal) {
			const signal = AbortSignal.any([requestSignal, lifetime.signal]);
			assertCurrent(signal);
			const originals = selected(keys);
			const results = await Promise.allSettled(
				originals.map(async (original) => ({
					original,
					item: await getManagedArtifact(original.item.appId, original.item.id, signal),
				})),
			);
			assertCurrent(signal);
			rejectReadFailures(results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])));
			for (const result of results) {
				if (result.status !== 'fulfilled') continue;
				const { original, item } = result.value;
				const current = artifacts.get(original.key);
				if (!current) throw new AgentManagementFailure('cancelled', 'not_dispatched');
				if (item.version < original.item.version) {
					throw new AgentManagementFailure('protocol_failure', 'unknown');
				}
			}
			for (const result of results) {
				if (result.status !== 'fulfilled') continue;
				const { original, item } = result.value;
				const current = artifacts.get(original.key);
				if (current && item.version >= current.version) {
					artifacts.set(original.key, copyArtifact(item));
				}
			}
			return selected(keys).map(({ key, item }) => selection(key, item));
		},

		async attach(key, threadId, requestSignal) {
			const signal = AbortSignal.any([requestSignal, lifetime.signal]);
			assertCurrent(signal);
			const original = selected([key])[0];
			if (!original || original.item.status !== 'ready') {
				throw new AgentManagementFailure('invalid_input', 'not_dispatched');
			}
			const result = await attachManagedArtifact(
				original.item,
				{ appId: options.appId, threadId, runId: null },
				signal,
			);
			assertCurrent(signal, 'unknown');
			const current = artifacts.get(key);
			if (!current) throw new AgentManagementFailure('cancelled', 'unknown');
			if (result.artifact.version >= current.version) {
				artifacts.set(key, copyArtifact(result.artifact));
			}
			const confirmed = artifacts.get(key);
			if (!confirmed) throw new AgentManagementFailure('cancelled', 'unknown');
			return selection(key, confirmed);
		},

		close() {
			if (closed) return;
			closed = true;
			pickerGeneration += 1;
			lifetime.abort();
			artifacts.clear();
		},
	};
}
