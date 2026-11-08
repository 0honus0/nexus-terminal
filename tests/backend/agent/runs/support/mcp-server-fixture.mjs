import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';

/** The external MCP server is scripted; SDK negotiation, HTTP, authority and SQL stay real. */
export async function openMcp() {
	const requests = [];
	const pending = new Set();
	const failures = [];

	let tool = () => ({ content: [{ type: 'text', text: 'external-result' }] });

	let toolName = 'echo';

	let resource = () => ({
		ttlMs: 0,
		cacheScope: 'private',
		contents: [{ uri: 'fixture://document', text: 'resource-value' }],
	});

	let prompt = () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'prompt-value' } }] });

	const server = createServer((request, response) => {
		const task = Promise.resolve().then(async () => {
			if (request.method !== 'POST') {
				response.writeHead(request.method === 'DELETE' ? 204 : 405).end();
				return;
			}
			const chunks = [];
			for await (const chunk of request) {
				chunks.push(chunk);
			}
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			requests.push({ body, authorization: request.headers.authorization });
			if (body.id === undefined) {
				response.writeHead(202).end();
				return;
			}
			const cached = { ttlMs: 0, cacheScope: 'private' };
			let result;
			switch (body.method) {
				case 'server/discover':
					result = {
						supportedVersions: ['2026-07-28'],
						capabilities: { tools: {}, resources: {}, prompts: {} },
						_meta: { 'io.modelcontextprotocol/serverInfo': { name: 'B10 MCP', version: '1.0.0' } },
					};
					break;
				case 'tools/list':
					result = {
						...cached,
						tools: [{ name: toolName, description: 'Fixture tool', inputSchema: { type: 'object' } }],
					};
					break;
				case 'resources/list':
					result = { ...cached, resources: [{ uri: 'fixture://document', name: 'Document' }] };
					break;
				case 'prompts/list':
					result = { ...cached, prompts: [{ name: 'greeting', description: 'Fixture prompt' }] };
					break;
				case 'resources/read':
					result = await resource(body.params);
					break;
				case 'prompts/get':
					result = await prompt(body.params);
					break;
				case 'tools/call':
					result = await tool(body.params, response);
					if (result === null) {
						return;
					}
					break;
				default:
					assert.fail('Unexpected MCP method: ' + body.method);
			}
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', ...result } }),
			);
		});
		pending.add(task);
		void task.then(
			() => pending.delete(task),
			(error) => {
				pending.delete(task);
				failures.push(error);
				response.destroy(error);
			},
		);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const authority = '127.0.0.1:' + server.address().port;
	return {
		requests,
		configuration: {
			kind: 'mcp',
			displayName: 'B10 external MCP',
			endpoint: 'http://' + authority + '/mcp',
			privateHostExceptions: [authority],
			protocolVersion: '2026-07-28',
		},

		setTool(work) {
			tool = work;
		},

		setResource(work) {
			resource = work;
		},

		setPrompt(work) {
			prompt = work;
		},

		changeCatalog() {
			toolName = 'changed';
		},

		async close() {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			await Promise.allSettled([...pending]);
			assert.deepEqual(failures, []);
		},
	};
}
