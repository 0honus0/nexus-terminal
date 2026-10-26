import { respondPresetModel } from './preset-model.mjs';
import { respondFunctionalModel } from './functional-model.mjs';
import http from 'node:http';
import regressionInputs from './regression-inputs.json' with { type: 'json' };

const host = '127.0.0.1';
const port = Number(process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT || 29091);
const expectedCredential = 'e2e-provider-secret';
let checkpointResponses = 0;
let releaseBrowserCompletion;
let browserCompletionReleased = false;
let browserCompletionHeld = false;
const imageRequests = new Map();

const readJson = async (request) => {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const sendSse = (response, value) => {
	const payload = Array.isArray(value?.choices)
		? { ...value, choices: value.choices.map((choice, index) => ({ index, ...choice })) }
		: value;
	response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const regressionResponse = (response, delta, finishReason = 'stop') => {
	response.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-store',
		Connection: 'keep-alive',
	});
	sendSse(response, { choices: [{ delta, finish_reason: null }] });
	sendSse(response, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 8 } });
	sendSse(response, { choices: [{ delta: {}, finish_reason: finishReason }] });
	response.end('data: [DONE]\n\n');
};

const server = http.createServer(async (request, response) => {
	if (request.method === 'POST' && request.url === '/reset') {
		if (browserCompletionHeld) {
			response.writeHead(409).end();
			return;
		}
		checkpointResponses = 0;
		imageRequests.clear();
		browserCompletionReleased = false;
		response.writeHead(204).end();
		return;
	}
	if (request.method === 'GET' && request.url === '/browser-lifecycle') {
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ held: browserCompletionHeld }));
		return;
	}
	if (request.method === 'POST' && request.url === '/browser-lifecycle/release') {
		browserCompletionReleased = true;
		releaseBrowserCompletion?.();
		response.writeHead(200);
		response.end();
		return;
	}
	const end = response.end.bind(response);
	response.end = (chunk, ...args) => {
		if (response.statusCode === 422) {
			console.error(`[E2E Agent Provider] 422 ${typeof chunk === 'string' ? chunk : ''}`);
		}
		return end(chunk, ...args);
	};
	if (request.method === 'GET' && request.url === '/health') {
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ ok: true, checkpointResponses }));
		return;
	}
	if (request.method === 'GET' && request.url === '/image-requests') {
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify(Object.fromEntries(imageRequests)));
		return;
	}

	if (request.method === 'GET' && request.url === '/v1/models') {
		if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
			response.writeHead(401, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: { message: 'invalid credential' } }));
			return;
		}
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(
			JSON.stringify({
				object: 'list',
				data: [
					{ id: 'e2e-model', object: 'model', owned_by: 'nexus-e2e', created: 1700000000 },
					{
						id: 'e2e-model-alt',
						object: 'model',
						owned_by: 'nexus-e2e',
						created: 1700000001,
						nexus_capabilities: {
							schema_version: 1,
							context_window: 16_384,
							max_output_tokens: 512,
							supports_tools: true,
							supports_image_input: true,
							supports_file_input: false,
							reasoning: {
								supported_efforts: ['low', 'high'],
								default_effort: 'low',
								mandatory: false,
							},
						},
					},
				],
			}),
		);
		return;
	}

	if (request.method === 'POST' && request.url === '/redirect/chat/completions') {
		response.writeHead(302, { Location: `http://${host}:${port}/v1/chat/completions` });
		response.end();
		return;
	}

	if (request.method === 'POST' && request.url === '/v1/responses') {
		if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
			response.writeHead(401, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: { message: 'invalid credential' } }));
			return;
		}
		let body;
		try {
			body = await readJson(request);
		} catch {
			response.writeHead(400).end();
			return;
		}
		if (
			!['e2e-model', 'e2e-model-alt'].includes(body?.model) ||
			body?.stream !== true ||
			body?.max_output_tokens !== 16 ||
			body?.prompt_cache_key !== undefined ||
			!Array.isArray(body?.input)
		) {
			response.writeHead(422, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: { message: 'unexpected Responses test request' } }));
			return;
		}
		response.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store',
			Connection: 'keep-alive',
		});
		const responseId = 'resp_e2e_provider_test';
		const messageId = 'msg_e2e_provider_test';
		sendSse(response, {
			type: 'response.created',
			response: { id: responseId, created_at: 1700000000, model: body.model },
		});
		sendSse(response, {
			type: 'response.output_item.added',
			output_index: 0,
			item: { type: 'message', id: messageId },
		});
		sendSse(response, { type: 'response.output_text.delta', item_id: messageId, output_index: 0, delta: 'OK' });
		sendSse(response, {
			type: 'response.output_item.done',
			output_index: 0,
			item: { type: 'message', id: messageId },
		});
		sendSse(response, {
			type: 'response.completed',
			response: {
				usage: { input_tokens: 5, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } },
			},
		});
		response.end();
		return;
	}

	if (request.method === 'POST' && request.url === '/v1/images/generations') {
		if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
			response.writeHead(401).end();
			return;
		}
		const image = await readJson(request);
		imageRequests.set(image.model, (imageRequests.get(image.model) ?? 0) + 1);
		const rejections = {
			'e2e-image-moderation': 'moderation_blocked',
			'e2e-image-policy': 'content_policy_violation',
			'e2e-image-unknown-rejection': 'unknown_vendor_code',
		};
		if (Object.hasOwn(rejections, image.model)) {
			response.writeHead(400, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					error: {
						code: rejections[image.model],
						type: 'image_generation_user_error',
						// Unknown codes must not be inferred from free-text messages.
						message: 'moderation_blocked content_policy_violation E2E_PRIVATE_VENDOR_BODY',
					},
				}),
			);
			return;
		}
		if (image.model !== 'e2e-image' || image.prompt !== 'E2E deterministic image') {
			response.writeHead(422).end();
			return;
		}
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(
			JSON.stringify({
				created: 1700000000,
				data: [
					{
						b64_json:
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNIWPAfAANjAgCeQrYLAAAAAElFTkSuQmCC',
					},
				],
			}),
		);
		return;
	}

	if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
		response.writeHead(404).end();
		return;
	}

	if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
		response.writeHead(401, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: { message: 'invalid credential' } }));
		return;
	}

	let body;
	try {
		body = await readJson(request);
	} catch {
		response.writeHead(400).end();
		return;
	}
	const tokenFields = ['max_tokens', 'max_completion_tokens'].filter((field) => body?.[field] !== undefined);
	const maxTokens = tokenFields.length === 1 ? Number(body[tokenFields[0]]) : NaN;
	if (
		!['e2e-model', 'e2e-model-alt'].includes(body?.model) ||
		body?.stream !== true ||
		!Number.isInteger(maxTokens) ||
		maxTokens < 1 ||
		maxTokens > 128
	) {
		response.writeHead(422, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: { message: 'unexpected test request' } }));
		return;
	}

	const messages = Array.isArray(body?.messages) ? body.messages : [];
	const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
	const latestUserText = JSON.stringify(latestUserMessage?.content ?? '');
	const isCheckpointRequest = messages.some(
		(message) =>
			message?.role === 'system' &&
			typeof message.content === 'string' &&
			message.content.includes('Summarize the supplied historical data into a task handoff.'),
	);
	if (isCheckpointRequest) {
		checkpointResponses += 1;
		const content = [
			'## Objective\nContinue Agent E2E.',
			'## Requirements\nRespect approval and selected targets.',
			'## Decisions\nDeveloper Skill loaded.',
			'## Work State\nEarlier fixture task returned OK.',
			'## Blockers\n(none)',
			'## Next Move\nFollow the current input.',
			'## Relevant Files\n(none)',
			'## Evidence\nPrior tool results are historical data.\n',
		].join('\n');
		response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
		sendSse(response, { choices: [{ delta: { content }, finish_reason: null }] });
		sendSse(response, { choices: [], usage: { prompt_tokens: 700, completion_tokens: 100 } });
		sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
		response.end('data: [DONE]\n\n');
		return;
	}

	const expectsNoWorkspaceTools = latestUserText.includes('E2E_NO_WORKSPACE_TOOLS');
	if (expectsNoWorkspaceTools) {
		const offeredToolNames = Array.isArray(body?.tools)
			? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === 'string')
			: [];
		const unavailableWorkspaceTools = [
			'workspace_create',
			'workspace_control',
			'workspace_toolchain_switch',
		].filter((name) => offeredToolNames.includes(name));
		if (unavailableWorkspaceTools.length > 0) {
			response.writeHead(422, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					error: {
						message: `Retired Workspace-only tools were offered to an SSH-only Run: ${unavailableWorkspaceTools.join(', ')}`,
					},
				}),
			);
			return;
		}
	}
	try {
		if (respondFunctionalModel(messages, latestUserText, response, regressionResponse)) return;
		if (respondPresetModel(messages, latestUserText, response, regressionResponse)) return;
	} catch (error) {
		// A deliberately strict model fixture should fail its one Run, never
		// terminate the shared provider and poison later isolated E2E scenarios.
		console.error('[E2E Agent Provider] Fixture scenario failed', error);
		if (!response.headersSent) {
			response.writeHead(422, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: { message: 'E2E model fixture failed validation' } }));
		} else {
			response.destroy(error);
		}
		return;
	}
	const acpExecution = latestUserText.match(/E2E_ACP_EXECUTE integration=([a-f0-9-]+) version=(\d+)/);
	if (acpExecution) {
		const result = messages.find(
			(message) => message.role === 'tool' && message.tool_call_id === 'call_acp_execute',
		);
		if (!result) {
			regressionResponse(
				response,
				{
					tool_calls: [
						{
							index: 0,
							id: 'call_acp_execute',
							type: 'function',
							function: {
								name: 'acp_integration_execute',
								arguments: JSON.stringify({
									integrationId: acpExecution[1],
									version: Number(acpExecution[2]),
									prompt: 'Request permission; do not write if rejected.',
								}),
							},
						},
					],
				},
				'tool_calls',
			);
		} else {
			regressionResponse(response, {
				content: 'ACP protocol finished; verify the independent process evidence.',
			});
		}
		return;
	}
	if (latestUserText.includes('E2E_TASK_READONLY_FUTURE_REPAIR')) {
		regressionResponse(response, {
			content: 'Read-only report delivered. Future repair is not authorized and was not executed.',
		});
		return;
	}
	if (latestUserText.includes('E2E_TASK_GATE_INPUT_RECOVERY')) {
		regressionResponse(response, { content: 'Choose a report format. Reply with report_format: concise.' });
		return;
	}
	if (latestUserText.includes('report_format: concise')) {
		regressionResponse(response, { content: 'Report format: concise.' });
		return;
	}
	if (latestUserText.includes('E2E_REGRESSION_CLARIFICATION_UI')) {
		regressionResponse(response, { content: 'Choose deployment color: blue or green.' });
		return;
	}
	if (latestUserText.includes('deployment_color: green')) {
		regressionResponse(response, { content: 'CHOSEN:green' });
		return;
	}
	const outputCase = regressionInputs.modelOutputs.find((fixture) => latestUserText.includes(fixture.marker));
	if (outputCase) {
		regressionResponse(response, { content: outputCase.expected });
		return;
	}
	const memoryCase = regressionInputs.memoryProposals.find((fixture) =>
		latestUserText.includes(`E2E_REGRESSION_${fixture.id}:`),
	);
	if (memoryCase) {
		const callId = 'call_e2e_memory_propose';
		const received = messages.find((message) => message.role === 'tool' && message.tool_call_id === callId);
		if (received) {
			const result = JSON.parse(received.content);
			if (typeof result.id !== 'string' || result.status !== 'candidate' || result.version !== 1) {
				regressionResponse(response, { content: 'Memory proposal returned no confirmed candidate.' });
				return;
			}
			regressionResponse(response, {
				content: JSON.stringify({ id: result.id, status: result.status, version: result.version }),
			});
		} else {
			regressionResponse(
				response,
				{
					tool_calls: [
						{
							index: 0,
							id: callId,
							type: 'function',
							function: {
								name: 'memory_propose',
								arguments: JSON.stringify({ content: memoryCase.content }),
							},
						},
					],
				},
				'tool_calls',
			);
		}
		return;
	}
	if (latestUserText.includes('E2E_REGRESSION_DEADLINE_SENTINEL')) {
		const refusal = messages.find(
			(message) => message.role === 'tool' && message.tool_call_id === 'call_e2e_regression',
		);
		if (refusal) {
			const result = JSON.parse(refusal.content);
			regressionResponse(response, { content: 'DELEGATION_REJECTED:' + result.failureCode });
			return;
		}
		const args = {
			profile: 'explore',
			objective: 'Return 42.',
			...(latestUserText.includes('boundary=duration') ? { durationSeconds: 121 } : {}),
			dependencyMode: 'success',
			...(latestUserText.includes('boundary=absolute')
				? { deadlineAt: regressionInputs.deadlines.rejectedSentinel }
				: {}),
		};
		regressionResponse(
			response,
			{
				tool_calls: [
					{
						index: 0,
						id: 'call_e2e_regression',
						type: 'function',
						function: {
							name: 'collaboration_delegate',
							arguments: JSON.stringify(args),
						},
					},
				],
			},
			'tool_calls',
		);
		return;
	}
	response.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-store',
		Connection: 'keep-alive',
	});
	if (latestUserText.includes('E2E_BROWSER_LIFECYCLE')) {
		const browserCallId = `call_e2e_browser_open_${latestUserText.match(/E2E_BROWSER_LIFECYCLE ([a-f0-9-]+)/)?.[1]}`;
		const opened = messages.some((message) => message?.role === 'tool' && message.tool_call_id === browserCallId);
		const approvalCallId = `${browserCallId}_approval`;
		const approvalRequested = latestUserText.includes('E2E_BROWSER_APPROVAL');
		const approvalSettled = messages.some(
			(message) => message?.role === 'tool' && message.tool_call_id === approvalCallId,
		);
		if (opened && approvalRequested && !approvalSettled) {
			const connection = /E2E_BROWSER_APPROVAL=(\d+)/.exec(latestUserText);
			sendSse(response, {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: approvalCallId,
									type: 'function',
									function: {
										name: 'shell_execute',
										arguments: JSON.stringify({
											connectionId: Number(connection[1]),
											kind: 'shell',
											script: 'printf browser-approval-e2e',
											mode: 'foreground',
										}),
									},
								},
							],
						},
						finish_reason: null,
					},
				],
			});
			sendSse(response, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 4 } });
			sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
			response.end('data: [DONE]\n\n');
			return;
		}
		if (!opened) browserCompletionReleased = false;
		if (opened && !browserCompletionReleased) {
			browserCompletionHeld = true;
			try {
				await new Promise((resolve) => {
					const timer = setTimeout(resolve, 30_000);
					releaseBrowserCompletion = () => {
						clearTimeout(timer);
						resolve();
					};
					response.once('close', releaseBrowserCompletion);
				});
			} finally {
				browserCompletionHeld = false;
				releaseBrowserCompletion = undefined;
			}
			if (response.destroyed) return;
		}
		const browserResult =
			opened && latestUserText.includes('E2E_CHILD_BROWSER_LIFECYCLE')
				? JSON.parse(
						messages.find((message) => message?.role === 'tool' && message.tool_call_id === browserCallId)
							.content,
					)
				: null;
		const delta = opened
			? {
					content: browserResult
						? JSON.stringify({ marker: 'Browser lifecycle fixture completed.', browserResult })
						: 'Browser lifecycle fixture completed.',
				}
			: {
					tool_calls: [
						{
							index: 0,
							id: browserCallId,
							type: 'function',
							function: {
								name: 'browser_open',
								arguments: JSON.stringify({
									targetId: 'e2e-lifecycle',
									expectedVersion: Number(/version=(\d+)/.exec(latestUserText)?.[1]),
								}),
							},
						},
					],
				};
		sendSse(response, { choices: [{ delta, finish_reason: null }] });
		sendSse(response, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 4 } });
		sendSse(response, { choices: [{ delta: {}, finish_reason: opened ? 'stop' : 'tool_calls' }] });
		response.end('data: [DONE]\n\n');
		return;
	}
	sendSse(response, { choices: [{ delta: { content: 'OK' }, finish_reason: null }] });
	sendSse(response, {
		choices: [],
		usage: {
			prompt_tokens: 5,
			completion_tokens: 1,
			prompt_tokens_details: { cached_tokens: 2 },
		},
	});
	sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
	response.end('data: [DONE]\n\n');
});

server.listen(port, host, () => {
	console.log(`[E2E Agent Provider] listening on http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
