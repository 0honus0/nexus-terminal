import type { HttpRoute } from './http-types.js';
import { MAX_JSON_BODY_BYTES } from './http-limits.js';

export interface MatchedHttpRoute {
	route: HttpRoute;
	params: Record<string, string>;
}

export interface HttpRouter {
	match(method: string, path: string): MatchedHttpRoute | null;
}

export function compileHttpRoutes(definitions: readonly HttpRoute[]): HttpRouter {
	const routes = new Map<string, HttpRoute>();
	const routeShapes = new Set<string>();
	const routePatterns: Array<{ method: string; segments: string[] }> = [];
	const parameterized: { route: HttpRoute; parts: string[] }[] = [];
	for (const route of definitions) {
		const key = route.method + ' ' + route.path;
		if (
			route.maxBodyBytes !== undefined &&
			(!Number.isSafeInteger(route.maxBodyBytes) ||
				route.maxBodyBytes < 1 ||
				route.maxBodyBytes > MAX_JSON_BODY_BYTES)
		) {
			throw new Error('Invalid HTTP route body budget');
		}
		const shape =
			route.method +
			' ' +
			route.path
				.split('/')
				.map((part) => (part.startsWith(':') ? ':' : part))
				.join('/');
		const segments = route.path.split('/');
		const overlaps = routePatterns.some(
			(previous) => previous.method === route.method && patternsOverlap(previous.segments, segments),
		);
		if (routes.has(key) || routeShapes.has(shape) || overlaps) {
			throw new Error('Duplicate or ambiguous HTTP route');
		}
		routes.set(key, route);
		routeShapes.add(shape);
		routePatterns.push({ method: route.method, segments });
		if (route.path.split('/').some((part) => part.startsWith(':'))) {
			parameterized.push({ route, parts: route.path.split('/') });
		}
	}

	return {
		match(method, path) {
			let route = routes.get(method + ' ' + path);
			const params: Record<string, string> = {};
			if (!route) {
				const actualParts = path.split('/');
				for (const entry of parameterized) {
					if (entry.route.method !== method || entry.parts.length !== actualParts.length) {
						continue;
					}
					const candidate: Record<string, string> = {};
					const matched = entry.parts.every((part, index) => {
						const actual = actualParts[index];
						if (part.startsWith(':')) {
							if (!actual || !/^[A-Za-z0-9_-]{1,64}$/u.test(actual)) {
								return false;
							}
							candidate[part.slice(1)] = actual;
							return true;
						}
						return part === actual;
					});
					if (matched) {
						route = entry.route;
						Object.assign(params, candidate);
						break;
					}
				}
			}
			return route ? { route, params } : null;
		},
	};
}

function patternsOverlap(previous: readonly string[], next: readonly string[]): boolean {
	if (previous.length !== next.length) {
		return false;
	}
	let previousMoreSpecific = false;
	let nextMoreSpecific = false;
	for (let index = 0; index < next.length; index += 1) {
		const before = previous[index];
		const after = next[index];
		if (before === after) {
			continue;
		}
		const beforeParam = before.startsWith(':');
		const afterParam = after.startsWith(':');
		if (!beforeParam && !afterParam) {
			return false;
		}
		nextMoreSpecific ||= beforeParam && !afterParam;
		previousMoreSpecific ||= !beforeParam && afterParam;
	}
	return previousMoreSpecific && nextMoreSpecific;
}
