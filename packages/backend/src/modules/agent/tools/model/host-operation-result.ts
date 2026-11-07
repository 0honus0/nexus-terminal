import type { HostBrowserOperationResult } from './host-operation-browser-result.js';
import { cloneHostBrowserOperationResult } from './host-operation-browser-result.js';
import type { PluginSkillResult } from '../../plugins/model/plugin-skill-types.js';
import type { CollaborationResult } from '../../runs/model/run-collaboration-types.js';
import type { ResultPage } from '../../context/model/context-types.js';
import type { MemoryRecord, MemoryCandidatePage, MemorySelectedItem } from '../../memory/model/memory-types.js';
import type {
	ToolArtifactCreated,
	ToolArtifactPresented,
	ToolArtifactPage,
	ToolProjectValue,
	ToolPathSnapshot,
	ToolDockerInspection,
	ToolDiagnosticsValue,
	ToolHostDiagnosticsValue,
	ToolDeliveryValue,
} from './tool-domain-types.js';
import type {
	ToolBatchResult,
	ToolWriteValue,
	ToolMoveValue,
	ToolDeleteValue,
	ToolDockerValue,
} from './tool-batch-types.js';
import type { ToolRemoteTextPageResult, ToolRemoteListPageResult } from './tool-remote-file-types.js';
import type { ToolJobAccepted, ToolJobSnapshot, ToolJobControlValue } from './tool-job-types.js';
import type { ToolConnection } from './tool-types.js';
import type { ToolDiscoveryPage } from './tool-discovery-types.js';

/** Internal live results. Each operation retains its actual domain result shape before wire conversion. */
interface HostOperationValues {
	'discovery.catalog': ToolDiscoveryPage;
	'discovery.activate': { names: string[] };
	'targets.list': { connections: Pick<ToolConnection, 'id' | 'name' | 'host' | 'port' | 'username'>[] };
	'diagnostics.host': ToolHostDiagnosticsValue;
	'diagnostics.readTarget': ToolDiagnosticsValue;
	'images.list': { models: { providerId: string; configurationVersion: number; modelId: string }[] };
	'images.generate': ToolArtifactPresented;
	'context.readResults': ResultPage;
	'artifacts.create': ToolArtifactCreated;
	'artifacts.read': ToolArtifactPage;
	'artifacts.present': ToolArtifactPresented;
	'artifacts.checkCapacity': { availableBytes: number };
	'memory.propose': Pick<MemoryRecord, 'id' | 'status' | 'version'>;
	'memory.retrieve':
		({ action: 'candidates' } & MemoryCandidatePage) | { action: 'select'; items: MemorySelectedItem[] };
	'project.bindingRead': ToolProjectValue;
	'project.bindingWrite': ToolProjectValue;
	'remote.readTextPage': ToolRemoteTextPageResult;
	'remote.listPage': ToolRemoteListPageResult;
	'remote.inspect': { status: 'ok'; value: ToolPathSnapshot } | { status: 'not_found' | 'not_text' };
	'remote.search': {
		matches: { queryIndex: number; path: string; line: number; column: number; text: string }[];
		truncated: boolean;
	};
	'remote.write': { items: ToolBatchResult<ToolWriteValue>[] };
	'remote.patch': ToolWriteValue;
	'remote.move': { items: ToolBatchResult<ToolMoveValue>[] };
	'remote.delete': { items: ToolBatchResult<ToolDeleteValue>[] };
	'remote.deliver': ToolDeliveryValue;
	'shell.execute': ToolJobAccepted | ToolJobSnapshot;
	'shell.jobs': ToolJobControlValue;
	'docker.inspect': { status: 'ok'; value: ToolDockerInspection } | { status: 'not_found' };
	'docker.control': { items: ToolBatchResult<ToolDockerValue>[] };
}

type HostDomainOperationResult = {
	[Operation in keyof HostOperationValues]: { operation: Operation; value: HostOperationValues[Operation] };
}[keyof HostOperationValues];

export type HostOperationResult =
	HostDomainOperationResult | HostBrowserOperationResult | PluginSkillResult | CollaborationResult;

function cloneBatch<Value extends ToolWriteValue | ToolMoveValue | ToolDeleteValue | ToolDockerValue>(
	items: ToolBatchResult<Value>[],
	cloneValue: (value: Value) => Value,
): ToolBatchResult<Value>[] {
	return items.map((item) => {
		if (item.status === 'completed') {
			return { index: item.index, status: item.status, value: cloneValue(item.value) };
		}
		if (item.status === 'failed') {
			return { index: item.index, status: item.status, failureCode: item.failureCode };
		}
		return { index: item.index, status: item.status };
	});
}

function cloneWrite(value: ToolWriteValue): ToolWriteValue {
	return { path: value.path, status: value.status, bytes: value.bytes, sha256: value.sha256 };
}

function clonePresented(value: ToolArtifactPresented): ToolArtifactPresented {
	return { id: value.id, name: value.name, sizeBytes: value.sizeBytes };
}

function cloneCapturedPage(value: ResultPage): ResultPage {
	return {
		toolCallId: value.toolCallId,
		sha256: value.sha256,
		originalBytes: value.originalBytes,
		offset: value.offset,
		nextOffset: value.nextOffset,
		text: value.text,
	};
}

function cloneJobResult(
	value: import('./tool-job-types.js').ToolJobResult,
): import('./tool-job-types.js').ToolJobResult {
	if (value.status === 'not_started') {
		return { status: value.status };
	}
	return {
		status: value.status,
		commands: value.commands.map((command) =>
			command.status === 'not_started'
				? { index: command.index, status: command.status }
				: {
						index: command.index,
						status: command.status,
						exitCode: command.exitCode,
						signal: command.signal,
						stdout: command.stdout,
						stderr: command.stderr,
						truncated: command.truncated,
					},
		),
	};
}

function cloneJobSummary(
	value: import('./tool-job-types.js').ToolJobSummary,
): import('./tool-job-types.js').ToolJobSummary {
	return {
		jobId: value.jobId,
		state: value.state,
		revision: value.revision,
		waitingForSpace: value.waitingForSpace,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function cloneJobSnapshot(value: ToolJobSnapshot): ToolJobSnapshot {
	return {
		jobId: value.jobId,
		state: value.state,
		revision: value.revision,
		waitingForSpace: value.waitingForSpace,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		result: value.result === null ? null : cloneJobResult(value.result),
	};
}

function cloneJobs(value: ToolJobControlValue): ToolJobControlValue {
	if ('nextOffset' in value) {
		return { jobs: value.jobs.map(cloneJobSummary), nextOffset: value.nextOffset };
	}
	if ('nextIndex' in value) {
		return {
			jobs: value.jobs.map((job) => ({
				jobId: job.jobId,
				state: job.state,
				offset: job.offset,
				nextOffset: job.nextOffset,
				capturedBytes: job.capturedBytes,
				available: job.available,
				waitingForSpace: job.waitingForSpace,
				output: job.output.map((event) => ({
					commandIndex: event.commandIndex,
					stream: event.stream,
					text: event.text,
				})),
				complete: job.complete,
			})),
			nextIndex: value.nextIndex,
		};
	}
	return { jobs: value.jobs.map(cloneJobSnapshot) };
}

function cloneChild(
	value: import('../../runs/model/run-collaboration-types.js').CollaborationChildView,
): import('../../runs/model/run-collaboration-types.js').CollaborationChildView {
	return {
		id: value.id,
		parentId: value.parentId,
		status: value.status,
		profile: value.profile,
		output: value.output,
		outputBytes: value.outputBytes,
		outputTruncated: value.outputTruncated,
		maxRequests: value.maxRequests,
		deadline: value.deadline,
	};
}

function cloneFact(
	value: import('../../runs/model/run-collaboration-types.js').CollaborationFact | null,
): import('../../runs/model/run-collaboration-types.js').CollaborationFact | null {
	return value === null
		? null
		: { key: value.key, value: value.value, version: value.version, authorId: value.authorId };
}

/** Crosses application boundaries with an explicit allow-list; no domain metadata or nested reference is retained. */
export function cloneHostOperationResult(result: HostOperationResult): HostOperationResult {
	switch (result.operation) {
		case 'discovery.catalog':
			return {
				operation: result.operation,
				value: {
					definitions: result.value.definitions.map((item) => ({
						name: item.name,
						semanticName: item.semanticName,
						description: item.description,
						parameters: item.parameters.map((parameter) => parameter),
						keywords: item.keywords.map((keyword) => keyword),
						loader: item.loader,
					})),
					sha256: result.value.sha256,
					nextCursor: result.value.nextCursor,
				},
			};
		case 'discovery.activate':
			return { operation: result.operation, value: { names: result.value.names.map((name) => name) } };
		case 'targets.list':
			return {
				operation: result.operation,
				value: {
					connections: result.value.connections.map((item) => ({
						id: item.id,
						name: item.name,
						host: item.host,
						port: item.port,
						username: item.username,
					})),
				},
			};
		case 'diagnostics.host': {
			const value = result.value;
			return {
				operation: result.operation,
				value: {
					collectedAt: value.collectedAt,
					process: {
						uptimeSeconds: value.process.uptimeSeconds,
						residentBytes: value.process.residentBytes,
						heapUsedBytes: value.process.heapUsedBytes,
						runtimeVersion: value.process.runtimeVersion,
						heapTotalBytes: value.process.heapTotalBytes,
						externalBytes: value.process.externalBytes,
						arrayBufferBytes: value.process.arrayBufferBytes,
						cpuUserSeconds: value.process.cpuUserSeconds,
						cpuSystemSeconds: value.process.cpuSystemSeconds,
						gcCount: value.process.gcCount,
						gcDurationSeconds: value.process.gcDurationSeconds,
					},
					database: { available: value.database.available, schemaVersion: value.database.schemaVersion },
					modules: value.modules.map((module) => ({
						id: module.id,
						status: module.status,
						metrics: module.metrics.map((metric) => ({
							name: metric.name,
							unit: metric.unit,
							value: metric.value,
						})),
					})),
				},
			};
		}
		case 'diagnostics.readTarget':
			return {
				operation: result.operation,
				value: {
					generatedAt: result.value.generatedAt,
					cpuPercent: result.value.cpuPercent,
					memUsedBytes: result.value.memUsedBytes,
					memTotalBytes: result.value.memTotalBytes,
					diskUsedBytes: result.value.diskUsedBytes,
					diskTotalBytes: result.value.diskTotalBytes,
					loadAverage: result.value.loadAverage.map((value) => value),
				},
			};
		case 'skills.catalog':
			return {
				operation: result.operation,
				value: {
					items: result.value.items.map((item) => ({
						name: item.name,
						description: item.description,
						version: item.version,
						sha256: item.sha256,
					})),
					nextOffset: result.value.nextOffset,
					catalogSha256: result.value.catalogSha256,
				},
			};
		case 'skills.read':
			return {
				operation: result.operation,
				value: {
					name: result.value.name,
					description: result.value.description,
					version: result.value.version,
					sha256: result.value.sha256,
					body: result.value.body,
				},
			};
		case 'images.list':
			return {
				operation: result.operation,
				value: {
					models: result.value.models.map((item) => ({
						providerId: item.providerId,
						configurationVersion: item.configurationVersion,
						modelId: item.modelId,
					})),
				},
			};
		case 'images.generate':
		case 'artifacts.present':
			return { operation: result.operation, value: clonePresented(result.value) };
		case 'context.readResults':
			return { operation: result.operation, value: cloneCapturedPage(result.value) };
		case 'artifacts.create':
			return {
				operation: result.operation,
				value: {
					id: result.value.id,
					version: result.value.version,
					status: result.value.status,
					sizeBytes: result.value.sizeBytes,
					sha256: result.value.sha256,
				},
			};
		case 'artifacts.read':
			return {
				operation: result.operation,
				value: {
					id: result.value.id,
					sha256: result.value.sha256,
					sizeBytes: result.value.sizeBytes,
					offset: result.value.offset,
					nextOffset: result.value.nextOffset,
					encoding: result.value.encoding,
					base64: result.value.base64,
					text: result.value.text,
				},
			};
		case 'artifacts.checkCapacity':
			return { operation: result.operation, value: { availableBytes: result.value.availableBytes } };
		case 'memory.propose':
			return {
				operation: result.operation,
				value: { id: result.value.id, status: result.value.status, version: result.value.version },
			};
		case 'memory.retrieve':
			if (result.value.action === 'candidates') {
				return {
					operation: result.operation,
					value: {
						action: result.value.action,
						items: result.value.items.map((item) => ({
							id: item.id,
							version: item.version,
							content: item.content,
							confidence: item.confidence,
						})),
						nextOffset: result.value.nextOffset,
						candidatesSha256: result.value.candidatesSha256,
						maxItems: result.value.maxItems,
						maxBytes: result.value.maxBytes,
					},
				};
			}
			return {
				operation: result.operation,
				value: {
					action: result.value.action,
					items: result.value.items.map((item) => ({
						id: item.id,
						version: item.version,
						content: item.content,
						confidence: item.confidence,
						score: item.score,
					})),
				},
			};
		case 'project.bindingRead':
		case 'project.bindingWrite':
			return {
				operation: result.operation,
				value: {
					binding:
						result.value.binding === null
							? null
							: {
									connectionId: result.value.binding.connectionId,
									directory: result.value.binding.directory,
								},
				},
			};
		case 'remote.readTextPage': {
			if (result.value.status !== 'ok') {
				return { operation: result.operation, value: { status: result.value.status } };
			}
			const page = result.value.value;
			return {
				operation: result.operation,
				value: {
					status: 'ok',
					value: {
						path: page.path,
						text: page.text,
						bytes: page.bytes,
						sizeBytes: page.sizeBytes,
						offset: page.offset,
						nextOffset: page.nextOffset,
						sha256: page.sha256,
						pageSha256: page.pageSha256,
						fingerprint: page.fingerprint,
					},
				},
			};
		}
		case 'remote.listPage': {
			if (result.value.status !== 'ok') {
				return { operation: result.operation, value: { status: result.value.status } };
			}
			const page = result.value.value;
			return {
				operation: result.operation,
				value: {
					status: 'ok',
					value: {
						entries: page.entries.map((item) => ({
							name: item.name,
							kind: item.kind,
							size: item.size,
							modifiedAt: item.modifiedAt,
						})),
						nextAfter: page.nextAfter,
						fingerprint: page.fingerprint,
					},
				},
			};
		}
		case 'remote.inspect': {
			if (result.value.status !== 'ok') {
				return { operation: result.operation, value: { status: result.value.status } };
			}
			const value = result.value.value;
			return {
				operation: result.operation,
				value: {
					status: 'ok',
					value: {
						path: value.path,
						kind: value.kind,
						fingerprint: value.fingerprint,
						fileCount: value.fileCount,
						directoryCount: value.directoryCount,
						bytes: value.bytes,
					},
				},
			};
		}
		case 'remote.search':
			return {
				operation: result.operation,
				value: {
					matches: result.value.matches.map((item) => ({
						queryIndex: item.queryIndex,
						path: item.path,
						line: item.line,
						column: item.column,
						text: item.text,
					})),
					truncated: result.value.truncated,
				},
			};
		case 'remote.write':
			return { operation: result.operation, value: { items: cloneBatch(result.value.items, cloneWrite) } };
		case 'remote.patch':
			return { operation: result.operation, value: cloneWrite(result.value) };
		case 'remote.move':
			return {
				operation: result.operation,
				value: {
					items: cloneBatch(result.value.items, (value) => ({
						path: value.path,
						destinationPath: value.destinationPath,
						kind: value.kind,
						fingerprint: value.fingerprint,
					})),
				},
			};
		case 'remote.delete':
			return {
				operation: result.operation,
				value: {
					items: cloneBatch(result.value.items, (value) => ({
						path: value.path,
						kind: value.kind,
						fileCount: value.fileCount,
						directoryCount: value.directoryCount,
					})),
				},
			};
		case 'docker.control':
			return {
				operation: result.operation,
				value: {
					items: cloneBatch(result.value.items, (value) => ({
						containerId: value.containerId,
						action: value.action,
						state: value.state,
					})),
				},
			};
		case 'remote.deliver':
			return {
				operation: result.operation,
				value: {
					items: result.value.items.map((item) =>
						item.status === 'completed'
							? {
									index: item.index,
									status: item.status,
									value: {
										id: item.value.id,
										name: item.value.name,
										sizeBytes: item.value.sizeBytes,
										sha256: item.value.sha256,
									},
								}
							: item.status === 'not_started'
								? { index: item.index, status: item.status }
								: { index: item.index, status: item.status, failureCode: item.failureCode },
					),
				},
			};
		case 'shell.execute':
			return {
				operation: result.operation,
				value:
					'accepted' in result.value
						? { jobId: result.value.jobId, accepted: true }
						: cloneJobSnapshot(result.value),
			};
		case 'shell.jobs':
			return { operation: result.operation, value: cloneJobs(result.value) };
		case 'docker.inspect':
			return {
				operation: result.operation,
				value:
					result.value.status === 'not_found'
						? { status: result.value.status }
						: {
								status: 'ok',
								value: {
									containerId: result.value.value.containerId,
									state: result.value.value.state,
									image: result.value.value.image,
									fingerprint: result.value.value.fingerprint,
								},
							},
			};
		case 'browser.catalog':
		case 'browser.open':
		case 'browser.close':
		case 'browser.snapshot':
		case 'browser.screenshot':
		case 'browser.console':
		case 'browser.navigate':
		case 'browser.back':
		case 'browser.scroll':
		case 'browser.press':
		case 'browser.select':
		case 'browser.wait':
		case 'browser.click':
		case 'browser.type':
		case 'browser.upload':
		case 'browser.download':
			return cloneHostBrowserOperationResult(result);
		case 'collaboration.delegate':
			return { operation: result.operation, value: cloneChild(result.value) };
		case 'collaboration.list':
			return {
				operation: result.operation,
				value: { children: result.value.children.map(cloneChild), nextCursor: result.value.nextCursor },
			};
		case 'collaboration.readOutput':
			return {
				operation: result.operation,
				value: {
					childId: result.value.childId,
					sha256: result.value.sha256,
					originalBytes: result.value.originalBytes,
					offset: result.value.offset,
					nextOffset: result.value.nextOffset,
					text: result.value.text,
				},
			};
		case 'collaboration.join':
			return {
				operation: result.operation,
				value: { ready: result.value.ready, children: result.value.children.map(cloneChild) },
			};
		case 'collaboration.cancel':
			return { operation: result.operation, value: { children: result.value.children.map(cloneChild) } };
		case 'collaboration.sendMessage':
			return { operation: result.operation, value: { sequence: result.value.sequence } };
		case 'collaboration.readMessages':
			return {
				operation: result.operation,
				value: {
					messages: result.value.messages.map((message) => ({
						sequence: message.sequence,
						senderId: message.senderId,
						body: message.body,
						expiresAt: message.expiresAt,
					})),
					nextCursor: result.value.nextCursor,
					consumedThrough: result.value.consumedThrough,
				},
			};
		case 'collaboration.consumeMessages':
			return { operation: result.operation, value: { consumedThrough: result.value.consumedThrough } };
		case 'collaboration.readFact':
		case 'collaboration.writeFact':
			return { operation: result.operation, value: { fact: cloneFact(result.value.fact) } };
	}
}
