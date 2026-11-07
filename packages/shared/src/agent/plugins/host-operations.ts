import * as z from 'zod/mini';
import { hostDiagnosticSchema } from '../../system/diagnostics/model.js';
import { AGENT_TOOL_JOB_STATES, AGENT_TOOL_RESULT_PAGE_MAX_BYTES } from '../tools/values.js';
import { AGENT_RUN_STATUSES, AGENT_RUN_FAILURE_CODES, AGENT_RUN_MAX_PROMPT_BYTES } from '../runs/values.js';
import { AGENT_MEMORY_STATUSES } from '../memory/values.js';
import { AGENT_ARTIFACT_STATUSES } from '../artifacts/values.js';
import { AGENT_ID_PATTERN } from '../values.js';
import { AGENT_CHILD_PROFILES } from '../collaboration/values.js';
import { AGENT_BROWSER_MAX_SETTLE_MS } from '../integrations/browser-values.js';
import { AGENT_EXECUTION_LIMIT_MAXIMA } from '../execution/values.js';
import { AGENT_ARTIFACT_MAX_BYTES } from '../artifacts/values.js';
import { AGENT_MEMORY_MAX_CONTENT_BYTES, hasAgentMemoryContentCapacity } from '../memory/values.js';
import {
	REMOTE_FILE_MAX_PATH_BYTES,
	REMOTE_FILE_TEXT_PAGE_MIN_BYTES,
	REMOTE_FILE_TEXT_PAGE_MAX_BYTES,
} from '../../remote/files/values.js';
import { DOCKER_ACTIONS } from '../../remote/docker/values.js';
import { isWellFormedFileText } from '../../remote/files/text-codec.js';
import { isAgentPluginVersion } from './values.js';

function text(maxBytes = Number.MAX_SAFE_INTEGER, allowEmpty = false) {
	return z
		.string()
		.check(
			z.refine(
				(value) =>
					(allowEmpty || value.length > 0) &&
					!value.includes('\0') &&
					isWellFormedFileText(value) &&
					new TextEncoder().encode(value).byteLength <= maxBytes,
			),
		);
}

function integer(min = 0, max = Number.MAX_SAFE_INTEGER) {
	return z.int().check(z.gte(min), z.lte(max));
}

function path(maxBytes = REMOTE_FILE_MAX_PATH_BYTES) {
	return text(maxBytes).check(z.refine((value) => value.startsWith('/') && !value.split('/').includes('..')));
}

const id = z.string().check(z.regex(AGENT_ID_PATTERN));

const hash = z.string().check(z.regex(/^[a-f0-9]{64}$/u));

const onError = z.enum(['stop', 'continue']);

const nodeRef = text(64).check(z.regex(/^[0-9]+$/u));

const settleMs = integer(0, AGENT_BROWSER_MAX_SETTLE_MS);

const fileWriteItem = z.strictObject({
	path: path(),
	content: text(Number.MAX_SAFE_INTEGER, true),
	expectedSha256: z.union([hash, z.literal('absent')]),
});

const fileMoveItem = z.strictObject({ path: path(), destinationPath: path(), expectedFingerprint: hash });

const fileDeleteItem = z.strictObject({ path: path(), expectedFingerprint: hash, scope: z.enum(['entry', 'tree']) });

const dockerControlItem = z.strictObject({
	containerId: hash,
	expectedFingerprint: hash,
	action: z.enum(DOCKER_ACTIONS),
});

const resultReadItem = z.strictObject({
	toolCallId: id,
	sha256: hash,
	offset: integer(),
	maxBytes: integer(8, AGENT_TOOL_RESULT_PAGE_MAX_BYTES),
});

/** Canonical domain requests. Every field is explicit; model defaults and adaptation belong to packages. */
export const agentPluginHostOperationRequestSchema = z.union([
	z.strictObject({ operation: z.literal('discovery.catalog'), cursor: integer(), sha256: z.nullable(hash) }),
	z.strictObject({ operation: z.literal('discovery.activate'), names: z.array(text(64)) }),
	z.strictObject({ operation: z.literal('targets.list') }),
	z.strictObject({ operation: z.literal('diagnostics.host') }),
	z.strictObject({ operation: z.literal('browser.catalog') }),
	z.strictObject({ operation: z.literal('images.list') }),
	z.strictObject({ operation: z.literal('diagnostics.readTarget'), connectionId: integer(1) }),
	z.strictObject({ operation: z.literal('skills.catalog'), offset: integer() }),
	z.strictObject({
		operation: z.literal('skills.read'),
		name: text(64).check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
		version: text(64).check(z.refine(isAgentPluginVersion)),
		sha256: hash,
	}),
	z.strictObject({
		operation: z.literal('images.generate'),
		providerId: id,
		configurationVersion: integer(1),
		modelId: text(512),
		prompt: text(),
	}),
	z.strictObject({ operation: z.literal('context.readResults'), item: resultReadItem }),
	z.strictObject({
		operation: z.literal('artifacts.create'),
		name: text(256),
		mediaType: text(128),
		base64: text(4 * Math.ceil(AGENT_ARTIFACT_MAX_BYTES / 3), true),
	}),
	z.strictObject({
		operation: z.literal('artifacts.read'),
		artifactId: id,
		offset: integer(0, AGENT_ARTIFACT_MAX_BYTES),
		maxBytes: integer(1, AGENT_TOOL_RESULT_PAGE_MAX_BYTES),
		encoding: z.enum(['base64', 'utf8']),
	}),
	z.strictObject({ operation: z.literal('artifacts.present'), artifactId: id }),
	z.strictObject({
		operation: z.literal('artifacts.checkCapacity'),
		sizeBytes: integer(0, AGENT_ARTIFACT_MAX_BYTES),
	}),
	z.strictObject({
		operation: z.literal('memory.propose'),
		content: text(AGENT_MEMORY_MAX_CONTENT_BYTES).check(z.refine(hasAgentMemoryContentCapacity)),
		confidence: z.number().check(z.gte(0), z.lte(1)),
		expiresAt: z.nullable(integer()),
	}),
	z.strictObject({
		operation: z.literal('memory.retrieve'),
		action: z.literal('candidates'),
		limit: integer(1),
		offset: integer(),
	}),
	z.strictObject({
		operation: z.literal('memory.retrieve'),
		action: z.literal('select'),
		limit: integer(1),
		candidatesSha256: hash,
		items: z.array(z.strictObject({ id, version: integer(1), score: integer(1) })),
	}),
	z.strictObject({ operation: z.literal('project.bindingRead'), connectionId: integer(1) }),
	z.strictObject({
		operation: z.literal('project.bindingWrite'),
		connectionId: integer(1),
		directory: z.nullable(path()),
	}),
	z.strictObject({
		operation: z.literal('remote.readTextPage'),
		connectionId: integer(1),
		path: path(),
		offset: integer(),
		maxBytes: integer(REMOTE_FILE_TEXT_PAGE_MIN_BYTES, REMOTE_FILE_TEXT_PAGE_MAX_BYTES),
	}),
	z.strictObject({
		operation: z.literal('remote.listPage'),
		connectionId: integer(1),
		path: path(),
		after: text(REMOTE_FILE_MAX_PATH_BYTES, true).check(
			z.refine((value) => !value.includes('/') && value !== '.' && value !== '..'),
		),
	}),
	z.strictObject({ operation: z.literal('remote.inspect'), connectionId: integer(1), path: path() }),
	z.strictObject({
		operation: z.literal('remote.search'),
		connectionId: integer(1),
		path: path(),
		queries: z
			.array(text().check(z.refine((value) => !value.includes('\n') && !value.includes('\r'))))
			.check(z.minLength(1)),
		maxResults: integer(1),
	}),
	z.strictObject({
		operation: z.literal('remote.write'),
		connectionId: integer(1),
		items: z.array(fileWriteItem).check(z.minLength(1)),
		onError,
	}),
	z.strictObject({
		operation: z.literal('remote.patch'),
		connectionId: integer(1),
		path: path(),
		expectedSha256: hash,
		edits: z
			.array(
				z
					.strictObject({ oldText: text(), newText: text(Number.MAX_SAFE_INTEGER, true) })
					.check(z.refine((value) => value.oldText !== value.newText)),
			)
			.check(z.minLength(1)),
	}),
	z.strictObject({
		operation: z.literal('remote.move'),
		connectionId: integer(1),
		items: z.array(fileMoveItem).check(z.minLength(1)),
		onError,
	}),
	z.strictObject({
		operation: z.literal('remote.delete'),
		connectionId: integer(1),
		items: z.array(fileDeleteItem).check(z.minLength(1)),
		onError,
	}),
	z.strictObject({
		operation: z.literal('remote.deliver'),
		connectionId: integer(1),
		paths: z.array(path()).check(z.minLength(1)),
	}),
	z.strictObject({
		operation: z.literal('shell.execute'),
		connectionId: integer(1),
		commands: z.array(text().check(z.refine((value) => !!value.trim()))).check(z.minLength(1)),
		onError,
		cwd: z.nullable(path()),
		mode: z.enum(['foreground', 'background']),
		yieldSeconds: z.nullable(integer(0, AGENT_EXECUTION_LIMIT_MAXIMA.toolTimeoutSeconds)),
	}),
	z.strictObject({
		operation: z.literal('shell.jobs'),
		connectionId: integer(1),
		action: z.enum(['list', 'status', 'wait', 'cancel', 'output']),
		jobIds: z.array(id),
		waitMode: z.enum(['all', 'any']),
		waitSeconds: integer(0, 30),
		offset: integer(),
	}),
	z.strictObject({ operation: z.literal('docker.inspect'), connectionId: integer(1), containerId: hash }),
	z.strictObject({
		operation: z.literal('docker.control'),
		connectionId: integer(1),
		items: z.array(dockerControlItem).check(z.minLength(1)),
		onError,
	}),
	z.strictObject({ operation: z.literal('browser.open'), targetId: text(128), expectedVersion: integer(1) }),
	z.strictObject({ operation: z.literal('browser.close'), sessionId: id }),
	z.strictObject({ operation: z.literal('browser.screenshot'), sessionId: id }),
	z.strictObject({ operation: z.literal('browser.snapshot'), sessionId: id, maxNodes: integer(1) }),
	z.strictObject({
		operation: z.literal('browser.console'),
		sessionId: id,
		after: integer(),
		limit: integer(1, 100),
	}),
	z.strictObject({ operation: z.literal('browser.navigate'), sessionId: id, settleMs, url: text(4096) }),
	z.strictObject({ operation: z.literal('browser.back'), sessionId: id, settleMs }),
	z.strictObject({
		operation: z.literal('browser.scroll'),
		sessionId: id,
		settleMs,
		deltaX: integer(Number.MIN_SAFE_INTEGER),
		deltaY: integer(Number.MIN_SAFE_INTEGER),
	}),
	z.strictObject({
		operation: z.literal('browser.press'),
		sessionId: id,
		settleMs,
		key: text(32),
		focus: z.nullable(z.strictObject({ snapshotId: id, nodeRef })),
		modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).check(z.maxLength(4)),
	}),
	z.strictObject({
		operation: z.literal('browser.select'),
		sessionId: id,
		settleMs,
		snapshotId: id,
		nodeRef,
		values: z.array(text(Number.MAX_SAFE_INTEGER, true)).check(z.minLength(1)),
	}),
	z.strictObject({
		operation: z.literal('browser.wait'),
		sessionId: id,
		mode: z.enum(['timeout', 'networkIdle']),
		maxMillis: integer(1),
	}),
	z.strictObject({ operation: z.literal('browser.click'), sessionId: id, settleMs, snapshotId: id, nodeRef }),
	z.strictObject({
		operation: z.literal('browser.type'),
		sessionId: id,
		settleMs,
		snapshotId: id,
		nodeRef,
		text: text(Number.MAX_SAFE_INTEGER, true),
	}),
	z.strictObject({
		operation: z.literal('browser.upload'),
		sessionId: id,
		settleMs,
		snapshotId: id,
		nodeRef,
		artifactId: id,
		expectedVersion: integer(1),
		sha256: hash,
	}),
	z.strictObject({
		operation: z.literal('browser.download'),
		sessionId: id,
		snapshotId: id,
		nodeRef,
		maxBytes: integer(1, AGENT_ARTIFACT_MAX_BYTES),
	}),
	z.strictObject({
		operation: z.literal('collaboration.delegate'),
		profile: z.enum(AGENT_CHILD_PROFILES),
		objective: text(AGENT_RUN_MAX_PROMPT_BYTES),
		inputJson: z.string(),
		targets: z.array(integer(1)),
		dependencies: z.array(id),
		dependencyMode: z.enum(['success', 'settled']),
	}),
	z.strictObject({ operation: z.literal('collaboration.list'), after: z.nullable(id), limit: integer(1) }),
	z.strictObject({
		operation: z.literal('collaboration.readOutput'),
		childId: id,
		offset: integer(),
		maxBytes: integer(8, AGENT_TOOL_RESULT_PAGE_MAX_BYTES),
	}),
	z.strictObject({
		operation: z.literal('collaboration.join'),
		childIds: z.array(id).check(z.minLength(1)),
		mode: z.enum(['all', 'any']),
		waitSeconds: integer(1, 30),
	}),
	z.strictObject({ operation: z.literal('collaboration.cancel'), childIds: z.array(id).check(z.minLength(1)) }),
	z.strictObject({
		operation: z.literal('collaboration.sendMessage'),
		recipientId: id,
		body: text(),
		ttlSeconds: integer(1),
	}),
	z.strictObject({
		operation: z.literal('collaboration.readMessages'),
		after: integer(),
		limit: integer(1),
	}),
	z.strictObject({
		operation: z.literal('collaboration.consumeMessages'),
		through: integer(),
		expectedConsumed: integer(),
	}),
	z.strictObject({ operation: z.literal('collaboration.readFact'), key: text(128) }),
	z.strictObject({
		operation: z.literal('collaboration.writeFact'),
		key: text(128),
		value: text(),
		expectedVersion: integer(0, Number.MAX_SAFE_INTEGER - 1),
	}),
]);

export type AgentPluginHostOperationRequest = z.infer<typeof agentPluginHostOperationRequestSchema>;

// Domain output strings may contain NUL (for example captured shell stdout).
const outputText = z.string().check(z.refine(isWellFormedFileText));

const nullableCount = z.nullable(integer());

const pageResult = z.strictObject({
	toolCallId: id,
	sha256: hash,
	originalBytes: integer(),
	offset: integer(),
	nextOffset: nullableCount,
	text: outputText,
});

const artifactPresented = z.strictObject({ id, name: outputText, sizeBytes: integer() });

const artifactCreated = z.strictObject({
	id,
	version: integer(1),
	status: z.enum(AGENT_ARTIFACT_STATUSES),
	sizeBytes: integer(),
	sha256: z.nullable(hash),
});

const artifactPage = z.strictObject({
	id,
	sha256: hash,
	sizeBytes: integer(),
	offset: integer(),
	nextOffset: nullableCount,
	encoding: z.enum(['base64', 'utf8']),
	base64: z.nullable(outputText),
	text: z.nullable(outputText),
});

const bindingResult = z.strictObject({
	binding: z.nullable(z.strictObject({ connectionId: integer(1), directory: path() })),
});

const textPage = z.strictObject({
	path: path(),
	text: outputText,
	bytes: integer(),
	sizeBytes: integer(),
	offset: integer(),
	nextOffset: nullableCount,
	sha256: z.nullable(hash),
	pageSha256: hash,
	fingerprint: hash,
});

const fileKind = z.enum(['file', 'directory', 'symlink', 'other']);

const directoryPage = z.strictObject({
	entries: z.array(z.strictObject({ name: outputText, kind: fileKind, size: integer(), modifiedAt: z.number() })),
	nextAfter: z.nullable(outputText),
	fingerprint: hash,
});

const missing = z.strictObject({ status: z.literal('not_found') });

const notText = z.strictObject({ status: z.literal('not_text') });

const pathSnapshot = z.strictObject({
	path: path(),
	kind: z.enum(['file', 'directory']),
	fingerprint: hash,
	fileCount: integer(),
	directoryCount: integer(),
	bytes: integer(),
});

const writeValue = z.strictObject({
	path: path(),
	status: z.enum(['created', 'replaced']),
	bytes: integer(),
	sha256: hash,
});

const moveValue = z.strictObject({
	path: path(),
	destinationPath: path(),
	kind: z.enum(['file', 'directory']),
	fingerprint: hash,
});

const deleteValue = z.strictObject({
	path: path(),
	kind: z.enum(['file', 'directory']),
	fileCount: integer(),
	directoryCount: integer(),
});

const dockerValue = z.strictObject({
	containerId: hash,
	action: z.enum(DOCKER_ACTIONS),
	state: z.nullable(outputText),
});

const batchFailure = z.strictObject({
	index: integer(),
	status: z.literal('failed'),
	failureCode: z.enum(['not_found', 'not_text', 'conflict', 'command_failed', 'invalid_input', 'limit_exceeded']),
});

const batchNotStarted = z.strictObject({ index: integer(), status: z.literal('not_started') });

const batchUnknown = z.strictObject({ index: integer(), status: z.literal('unknown') });

const commandResult = z.union([
	z.strictObject({ index: integer(), status: z.literal('not_started') }),
	z.strictObject({
		index: integer(),
		status: z.enum(['completed', 'nonzero']),
		exitCode: integer(0, 255),
		signal: z.nullable(outputText),
		stdout: outputText,
		stderr: outputText,
		truncated: z.boolean(),
	}),
]);

const jobResult = z.union([
	z.strictObject({ status: z.literal('not_started') }),
	z.strictObject({ status: z.enum(['completed', 'nonzero']), commands: z.array(commandResult) }),
]);

const jobSummaryFields = {
	jobId: id,
	state: z.enum(AGENT_TOOL_JOB_STATES),
	revision: integer(1),
	waitingForSpace: z.boolean(),
	createdAt: integer(),
	updatedAt: integer(),
};

const jobSummary = z.strictObject(jobSummaryFields);

const jobSnapshot = z.strictObject({ ...jobSummaryFields, result: z.nullable(jobResult) });

const jobOutput = z.strictObject({
	jobId: id,
	state: z.enum(AGENT_TOOL_JOB_STATES),
	offset: integer(),
	nextOffset: integer(),
	capturedBytes: integer(),
	available: z.boolean(),
	waitingForSpace: z.boolean(),
	output: z.array(
		z.strictObject({ commandIndex: integer(), stream: z.enum(['stdout', 'stderr']), text: outputText }),
	),
	complete: z.boolean(),
});

const jobExecuteValue = z.union([z.strictObject({ jobId: id, accepted: z.literal(true) }), jobSnapshot]);

const jobControlValue = z.union([
	z.strictObject({ jobs: z.array(jobSummary), nextOffset: nullableCount }),
	z.strictObject({ jobs: z.array(jobOutput), nextIndex: nullableCount }),
	z.strictObject({ jobs: z.array(jobSnapshot) }),
]);

const browserPage = z.strictObject({ kind: z.literal('page'), url: outputText, title: outputText });

const browserArtifact = z.strictObject({
	artifactId: id,
	version: integer(1),
	sha256: hash,
	sizeBytes: integer(),
	mediaType: outputText,
});

const skill = z.strictObject({
	name: outputText,
	description: outputText,
	version: text(64).check(z.refine(isAgentPluginVersion)),
	sha256: hash,
});

const child = z.strictObject({
	id,
	parentId: z.nullable(id),
	status: z.enum(AGENT_RUN_STATUSES),
	profile: z.enum(AGENT_CHILD_PROFILES),
	output: z.nullable(outputText),
	outputBytes: integer(),
	outputTruncated: z.boolean(),
	maxRequests: integer(1),
	deadline: integer(),
});

const fact = z.strictObject({ key: outputText, value: outputText, version: integer(1), authorId: id });

/** Result metadata such as activated tools, artifacts and targets stays in the trusted Host closure. */
export const agentPluginHostOperationResultSchema = z.discriminatedUnion('operation', [
	z.strictObject({
		operation: z.literal('discovery.catalog'),
		value: z.strictObject({
			definitions: z.array(
				z.strictObject({
					name: text(64),
					semanticName: outputText,
					description: outputText,
					parameters: z.array(outputText),
					keywords: z.array(outputText),
					loader: z.boolean(),
				}),
			),
			sha256: hash,
			nextCursor: z.nullable(integer()),
		}),
	}),
	z.strictObject({ operation: z.literal('discovery.activate'), value: z.strictObject({ names: z.array(text(64)) }) }),
	z.strictObject({
		operation: z.literal('targets.list'),
		value: z.strictObject({
			connections: z.array(
				z.strictObject({
					id: integer(1),
					name: outputText,
					host: outputText,
					port: integer(1, 65535),
					username: outputText,
				}),
			),
		}),
	}),
	z.strictObject({ operation: z.literal('diagnostics.host'), value: hostDiagnosticSchema }),
	z.strictObject({
		operation: z.literal('diagnostics.readTarget'),
		value: z.strictObject({
			generatedAt: integer(),
			cpuPercent: z.nullable(z.number()),
			memUsedBytes: nullableCount,
			memTotalBytes: nullableCount,
			diskUsedBytes: nullableCount,
			diskTotalBytes: nullableCount,
			loadAverage: z.array(z.number()),
		}),
	}),
	z.strictObject({
		operation: z.literal('skills.catalog'),
		value: z.strictObject({ items: z.array(skill), nextOffset: z.nullable(integer()), catalogSha256: hash }),
	}),
	z.strictObject({
		operation: z.literal('skills.read'),
		value: z.strictObject({
			name: outputText,
			description: outputText,
			version: text(64).check(z.refine(isAgentPluginVersion)),
			sha256: hash,
			body: outputText,
		}),
	}),
	z.strictObject({
		operation: z.literal('images.list'),
		value: z.strictObject({
			models: z.array(z.strictObject({ providerId: id, configurationVersion: integer(1), modelId: outputText })),
		}),
	}),
	z.strictObject({ operation: z.literal('images.generate'), value: artifactPresented }),
	z.strictObject({ operation: z.literal('context.readResults'), value: pageResult }),
	z.strictObject({ operation: z.literal('artifacts.create'), value: artifactCreated }),
	z.strictObject({ operation: z.literal('artifacts.read'), value: artifactPage }),
	z.strictObject({ operation: z.literal('artifacts.present'), value: artifactPresented }),
	z.strictObject({
		operation: z.literal('artifacts.checkCapacity'),
		value: z.strictObject({ availableBytes: integer() }),
	}),
	z.strictObject({
		operation: z.literal('memory.propose'),
		value: z.strictObject({ id, status: z.enum(AGENT_MEMORY_STATUSES), version: integer(1) }),
	}),
	z.strictObject({
		operation: z.literal('memory.retrieve'),
		value: z.discriminatedUnion('action', [
			z.strictObject({
				action: z.literal('candidates'),
				items: z.array(
					z.strictObject({
						id,
						version: integer(1),
						content: text(AGENT_MEMORY_MAX_CONTENT_BYTES).check(z.refine(hasAgentMemoryContentCapacity)),
						confidence: z.number().check(z.gte(0), z.lte(1)),
					}),
				),
				nextOffset: z.nullable(integer()),
				candidatesSha256: hash,
				maxItems: integer(1),
				maxBytes: integer(1),
			}),
			z.strictObject({
				action: z.literal('select'),
				items: z.array(
					z.strictObject({
						id,
						version: integer(1),
						content: text(AGENT_MEMORY_MAX_CONTENT_BYTES).check(z.refine(hasAgentMemoryContentCapacity)),
						confidence: z.number().check(z.gte(0), z.lte(1)),
						score: integer(1),
					}),
				),
			}),
		]),
	}),
	z.strictObject({ operation: z.literal('project.bindingRead'), value: bindingResult }),
	z.strictObject({ operation: z.literal('project.bindingWrite'), value: bindingResult }),
	z.strictObject({
		operation: z.literal('remote.readTextPage'),
		value: z.discriminatedUnion('status', [
			z.strictObject({ status: z.literal('ok'), value: textPage }),
			missing,
			notText,
		]),
	}),
	z.strictObject({
		operation: z.literal('remote.listPage'),
		value: z.discriminatedUnion('status', [
			z.strictObject({ status: z.literal('ok'), value: directoryPage }),
			missing,
		]),
	}),
	z.strictObject({
		operation: z.literal('remote.inspect'),
		value: z.discriminatedUnion('status', [
			z.strictObject({ status: z.literal('ok'), value: pathSnapshot }),
			missing,
			notText,
		]),
	}),
	z.strictObject({
		operation: z.literal('remote.search'),
		value: z.strictObject({
			matches: z.array(
				z.strictObject({
					queryIndex: integer(),
					path: path(),
					line: integer(1),
					column: integer(1),
					text: outputText,
				}),
			),
			truncated: z.boolean(),
		}),
	}),
	z.strictObject({
		operation: z.literal('remote.write'),
		value: z.strictObject({
			items: z.array(
				z.discriminatedUnion('status', [
					z.strictObject({ index: integer(), status: z.literal('completed'), value: writeValue }),
					batchFailure,
					batchNotStarted,
					batchUnknown,
				]),
			),
		}),
	}),
	z.strictObject({
		operation: z.literal('remote.move'),
		value: z.strictObject({
			items: z.array(
				z.discriminatedUnion('status', [
					z.strictObject({ index: integer(), status: z.literal('completed'), value: moveValue }),
					batchFailure,
					batchNotStarted,
					batchUnknown,
				]),
			),
		}),
	}),
	z.strictObject({
		operation: z.literal('remote.delete'),
		value: z.strictObject({
			items: z.array(
				z.discriminatedUnion('status', [
					z.strictObject({ index: integer(), status: z.literal('completed'), value: deleteValue }),
					batchFailure,
					batchNotStarted,
					batchUnknown,
				]),
			),
		}),
	}),
	z.strictObject({
		operation: z.literal('docker.control'),
		value: z.strictObject({
			items: z.array(
				z.discriminatedUnion('status', [
					z.strictObject({ index: integer(), status: z.literal('completed'), value: dockerValue }),
					batchFailure,
					batchNotStarted,
					batchUnknown,
				]),
			),
		}),
	}),
	z.strictObject({ operation: z.literal('remote.patch'), value: writeValue }),
	z.strictObject({
		operation: z.literal('remote.deliver'),
		value: z.strictObject({
			items: z.array(
				z.discriminatedUnion('status', [
					z.strictObject({
						index: integer(),
						status: z.literal('completed'),
						value: z.strictObject({ id, name: outputText, sizeBytes: integer(), sha256: z.nullable(hash) }),
					}),
					z.strictObject({
						index: integer(),
						status: z.literal('failed'),
						failureCode: z.enum(AGENT_RUN_FAILURE_CODES),
					}),
					z.strictObject({
						index: integer(),
						status: z.literal('unknown'),
						failureCode: z.enum(AGENT_RUN_FAILURE_CODES),
					}),
					batchNotStarted,
				]),
			),
		}),
	}),
	z.strictObject({ operation: z.literal('shell.execute'), value: jobExecuteValue }),
	z.strictObject({ operation: z.literal('shell.jobs'), value: jobControlValue }),
	z.strictObject({
		operation: z.literal('docker.inspect'),
		value: z.discriminatedUnion('status', [
			z.strictObject({
				status: z.literal('ok'),
				value: z.strictObject({ containerId: hash, state: outputText, image: outputText, fingerprint: hash }),
			}),
			missing,
		]),
	}),
	z.strictObject({
		operation: z.literal('browser.catalog'),
		value: z.strictObject({
			targets: z.array(
				z.strictObject({
					targetId: outputText,
					expectedVersion: integer(1),
					allowedUrlPatterns: z.array(outputText),
				}),
			),
		}),
	}),
	z.strictObject({
		operation: z.literal('browser.open'),
		value: z.strictObject({
			sessionId: id,
			targetId: outputText,
			targetVersion: integer(1),
			runId: id,
			createdAt: integer(),
		}),
	}),
	z.strictObject({ operation: z.literal('browser.close'), value: z.strictObject({ status: z.literal('closed') }) }),
	z.strictObject({
		operation: z.literal('browser.snapshot'),
		value: z.strictObject({
			snapshotId: id,
			url: outputText,
			title: outputText,
			nodes: z.array(
				z.strictObject({
					ref: outputText,
					parentRef: z.nullable(outputText),
					tag: outputText,
					text: outputText,
					attributes: z.array(z.strictObject({ name: outputText, value: outputText })),
				}),
			),
			truncated: z.boolean(),
		}),
	}),
	z.strictObject({ operation: z.literal('browser.screenshot'), value: browserArtifact }),
	z.strictObject({ operation: z.literal('browser.download'), value: browserArtifact }),
	z.strictObject({
		operation: z.literal('browser.console'),
		value: z.strictObject({
			entries: z.array(z.strictObject({ sequence: integer(), type: outputText, text: outputText })),
			nextCursor: integer(),
			truncated: z.boolean(),
		}),
	}),
	z.strictObject({ operation: z.literal('browser.navigate'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.back'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.scroll'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.press'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.select'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.wait'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.click'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.type'), value: browserPage }),
	z.strictObject({ operation: z.literal('browser.upload'), value: browserPage }),
	z.strictObject({ operation: z.literal('collaboration.delegate'), value: child }),
	z.strictObject({
		operation: z.literal('collaboration.list'),
		value: z.strictObject({ children: z.array(child), nextCursor: z.nullable(id) }),
	}),
	z.strictObject({
		operation: z.literal('collaboration.readOutput'),
		value: z.strictObject({
			childId: id,
			sha256: hash,
			originalBytes: integer(),
			offset: integer(),
			nextOffset: nullableCount,
			text: outputText,
		}),
	}),
	z.strictObject({
		operation: z.literal('collaboration.join'),
		value: z.strictObject({ ready: z.boolean(), children: z.array(child) }),
	}),
	z.strictObject({
		operation: z.literal('collaboration.cancel'),
		value: z.strictObject({ children: z.array(child) }),
	}),
	z.strictObject({
		operation: z.literal('collaboration.sendMessage'),
		value: z.strictObject({ sequence: integer(1) }),
	}),
	z.strictObject({
		operation: z.literal('collaboration.readMessages'),
		value: z.strictObject({
			messages: z.array(
				z.strictObject({ sequence: integer(1), senderId: id, body: outputText, expiresAt: integer() }),
			),
			nextCursor: integer(),
			consumedThrough: integer(),
		}),
	}),
	z.strictObject({
		operation: z.literal('collaboration.consumeMessages'),
		value: z.strictObject({ consumedThrough: integer() }),
	}),
	z.strictObject({
		operation: z.literal('collaboration.readFact'),
		value: z.strictObject({ fact: z.nullable(fact) }),
	}),
	z.strictObject({
		operation: z.literal('collaboration.writeFact'),
		value: z.strictObject({ fact: z.nullable(fact) }),
	}),
]);

export type AgentPluginHostOperationResult = z.infer<typeof agentPluginHostOperationResultSchema>;
