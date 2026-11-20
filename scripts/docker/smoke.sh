#!/usr/bin/env bash
set -euo pipefail

image=${1:?Pass the local image tag}
container=$(docker run --detach --volume /app/data --publish 127.0.0.1::8080 "$image")
trap 'docker rm --force --volumes "$container" >/dev/null 2>&1 || true' EXIT

binding=$(docker port "$container" 8080/tcp)
if ! NEXUS_SMOKE_ORIGIN="http://$binding" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { WebSocket } from 'ws';

const origin = process.env.NEXUS_SMOKE_ORIGIN;
const ready = AbortSignal.timeout(20_000);
for (;;) {
	try {
		const state = await fetch(origin + '/api/auth/state', { signal: ready });
		await state.body?.cancel();
		if (state.ok) break;
	} catch {
		ready.throwIfAborted();
	}
	await setTimeout(100, undefined, { signal: ready });
}

const signal = AbortSignal.timeout(15_000);
const frontend = await fetch(origin, { signal });
assert.equal(frontend.status, 200);
const asset = (await frontend.text()).match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
assert.ok(asset);
const script = await fetch(origin + asset, { signal });
assert.equal(script.status, 200);
assert.match(script.headers.get('content-type'), /javascript/);
await script.body.cancel();

const input = JSON.stringify({ username: 'smoke', password: 'fixture-owner' });
const headers = { 'content-type': 'application/json', origin };
const setup = '/api/auth/initialize';
const denied = await fetch(origin + setup, {
	method: 'POST',
	headers: { ...headers, origin: 'https://cross-site.invalid' },
	body: input,
	signal,
});
assert.equal(denied.status, 403);
await denied.body.cancel();
const login = await fetch(origin + setup, { method: 'POST', headers, body: input, signal });
assert.equal(login.status, 201, await login.clone().text());
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
await login.body.cancel();

const settings = { pluginId: '@nexus-terminal/settings', name: 'preferences' };
const marketplace = '/api/plugins/' + encodeURIComponent('@nexus-terminal/marketplace');
const pluginReady = AbortSignal.timeout(20_000);
for (const path of [marketplace + '/plugins', '/api/plugins/' + encodeURIComponent(settings.pluginId) + '/preferences']) {
	// Authentication is available before built-in plugins finish registering their routes.
	for (;;) {
		const response = await fetch(origin + path, { headers: { cookie }, signal: pluginReady });
		if (response.status !== 404) {
			assert.equal(response.status, 200, path);
			await response.json();
			break;
		}
		await response.body?.cancel();
		await setTimeout(100, undefined, { signal: pluginReady });
	}
}

const socketSignal = AbortSignal.timeout(5000);
const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/state/ws', {
	headers: { cookie },
	origin,
	handshakeTimeout: 5000,
});
try {
	await once(socket, 'open', { signal: socketSignal });
	const reply = once(socket, 'message', { signal: socketSignal });
	socket.send(JSON.stringify({ type: 'subscribe', topic: settings }));
	const [data] = await reply;
	const snapshot = JSON.parse(String(data));
	assert.equal(snapshot.type, 'snapshot');
	assert.deepEqual(snapshot.topic, settings);
} finally {
	socket.terminate();
}
JS
then
	docker logs "$container" >&2
	exit 1
fi

docker stop --time 10 "$container" >/dev/null
if [[ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" != 0 ]]; then
	docker logs "$container" >&2
	exit 1
fi
