import type { HttpRoute } from './http-types.js';
import { MAX_HTTP_BODY_BYTES } from './http-limits.js';

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
			(route.maxBodyBytes !== undefined &&
				(!Number.isSafeInteger(route.maxBodyBytes) ||
					route.maxBodyBytes < 1 ||
					route.maxBodyBytes > MAX_HTTP_BODY_BYTES)) ||
			(route.maxPathParameterBytes !== undefined &&
				(!Number.isSafeInteger(route.maxPathParameterBytes) ||
					route.maxPathParameterBytes < 1 ||
					route.maxPathParameterBytes > 2048))
		) {
			throw new Error('Invalid HTTP route budget');
		}
		const shape =
			route.method +
			' ' +
			route.path
				.split('/')
				.map((part) => (part.startsWith(':') ? ':' : part))
				.join('/');
		const segments = route.path.split('/');
		if (
			segments.some(
				(part, index) =>
					part.startsWith('*') && (index !== segments.length - 1 || !/^\*[A-Za-z][A-Za-z0-9]*$/u.test(part)),
			)
		) {
			throw new Error('Invalid HTTP trailing path parameter');
		}
		const overlaps = routePatterns.some(
			(previous) => previous.method === route.method && patternsOverlap(previous.segments, segments),
		);
		if (routes.has(key) || routeShapes.has(shape) || overlaps) {
			throw new Error('Duplicate or ambiguous HTTP route');
		}
		routes.set(key, route);
		routeShapes.add(shape);
		routePatterns.push({ method: route.method, segments });
		if (route.path.split('/').some((part) => part.startsWith(':') || part.startsWith('*'))) {
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
					const trailing = entry.parts.at(-1)?.startsWith('*') === true;
					if (
						entry.route.method !== method ||
						(!trailing && entry.parts.length !== actualParts.length) ||
						(trailing && actualParts.length < entry.parts.length)
					) {
						continue;
					}
					const candidate: Record<string, string> = {};
					const matched = entry.parts.every((part, index) => {
						if (part.startsWith('*')) {
							const value = actualParts.slice(index).map(decodePart);
							if (
								value.some(
									(item) =>
										item === null ||
										item === '.' ||
										item === '..' ||
										!/^[A-Za-z0-9_.-]+$/u.test(item),
								)
							) {
								return false;
							}
							const path = value.join('/');
							if (Buffer.byteLength(path, 'utf8') > (entry.route.maxPathParameterBytes ?? 64)) {
								return false;
							}
							candidate[part.slice(1)] = path;
							return true;
						}
						const actual = decodePart(actualParts[index]);
						if (part.startsWith(':')) {
							if (
								!actual ||
								!matchesParameter(actual, entry.route.pathParameterAlphabet) ||
								Buffer.byteLength(actual, 'utf8') > (entry.route.maxPathParameterBytes ?? 64)
							) {
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

function matchesParameter(value: string, alphabet: HttpRoute['pathParameterAlphabet']): boolean {
	if (alphabet === 'segment') {
		return value !== '.' && value !== '..' && !/[\u0000-\u001f\u007f/\\]/u.test(value);
	}
	return (alphabet === 'opaque' ? /^[A-Za-z0-9_.:-]+$/u : /^[A-Za-z0-9_-]+$/u).test(value);
}

function patternsOverlap(previous: readonly string[], next: readonly string[]): boolean {
	if (previous.at(-1)?.startsWith('*') || next.at(-1)?.startsWith('*')) {
		for (let index = 0; index < Math.min(previous.length, next.length); index++) {
			const before = previous[index],
				after = next[index];
			if (before.startsWith('*') || after.startsWith('*')) {
				return true;
			}
			if (before !== after && !before.startsWith(':') && !after.startsWith(':')) {
				return false;
			}
		}
		return false;
	}
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

function decodePart(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}
