import type { ProcessDiagnosticSource, ProcessDiagnostic } from '../process-diagnostic.js';
import { PerformanceObserver } from 'node:perf_hooks';
import { Gauge, Histogram, Registry } from '@prometheus-io/client';
import {
	DIAGNOSTIC_MODULE_IDS,
	DIAGNOSTIC_RESOURCE_UNITS,
	type DiagnosticModuleId,
	type DiagnosticResourceName,
} from '@nexus-terminal/shared/system/diagnostics/values';
import type { ResourceCollector, ModuleResourceDiagnostic } from '../resource-diagnostic.js';
import type { HttpRoute } from '../../http/http-types.js';

export class NodeProcessDiagnostic implements ProcessDiagnosticSource {
	private readonly registry = new Registry();
	private readonly memory = new Gauge({
		name: 'nexus_process_memory_bytes',
		help: 'Process RSS and main-isolate memory; categories overlap.',
		labelNames: ['kind'],
		registers: [this.registry],
	});
	private readonly cpu = new Gauge({
		name: 'nexus_process_cpu_seconds',
		help: 'Cumulative process CPU time.',
		labelNames: ['kind'],
		registers: [this.registry],
	});
	private readonly resources = new Gauge({
		name: 'nexus_module_resource',
		help: 'Owner-reported resource counts, logical payload bytes or isolate memory, not module RSS.',
		labelNames: ['module', 'resource', 'unit'],
		registers: [this.registry],
	});
	private readonly gc = new Histogram({
		name: 'nexus_main_gc_duration_seconds',
		help: 'Main-isolate GC pauses since this diagnostic owner was installed.',
		buckets: [0.001, 0.01, 0.1, 1, 2, 5],
		registers: [this.registry],
	});
	private readonly httpRequests = new Gauge({
		name: 'nexus_module_active_http_requests',
		help: 'Currently executing installed module HTTP handlers.',
		labelNames: ['module'],
		registers: [this.registry],
	});
	private readonly observedModules = new Set<DiagnosticModuleId>();
	private readonly observer: PerformanceObserver;
	private readonly collectors = new Map<DiagnosticModuleId, ResourceCollector>();
	private pending: Promise<ProcessDiagnostic> | null = null;
	private closed = false;

	constructor() {
		this.observer = new PerformanceObserver((list) => {
			if (this.closed) {
				return;
			}
			for (const entry of list.getEntries()) {
				if (Number.isFinite(entry.duration) && entry.duration >= 0) {
					this.gc.observe(entry.duration / 1000);
				}
			}
		});
		this.observer.observe({ entryTypes: ['gc'] });
	}

	register(collector: ResourceCollector): void {
		if (this.closed || this.collectors.has(collector.id)) {
			throw new Error('Diagnostic collector unavailable');
		}
		this.collectors.set(collector.id, collector);
	}

	observeHttpRoutes(id: DiagnosticModuleId, routes: readonly HttpRoute[]): HttpRoute[] {
		if (!this.observedModules.has(id)) {
			this.observedModules.add(id);
			this.httpRequests.set({ module: id }, 0);
		}
		return routes.map((route) => ({
			method: route.method,
			path: route.path,
			...(route.maxBodyBytes === undefined ? {} : { maxBodyBytes: route.maxBodyBytes }),
			...(route.maxPathParameterBytes === undefined
				? {}
				: { maxPathParameterBytes: route.maxPathParameterBytes }),
			...(route.pathParameterAlphabet === undefined
				? {}
				: { pathParameterAlphabet: route.pathParameterAlphabet }),

			handle: async (context) => {
				if (!this.closed) {
					this.httpRequests.inc({ module: id });
				}
				try {
					await route.handle(context);
				} finally {
					if (!this.closed) {
						this.httpRequests.dec({ module: id });
					}
				}
			},
		}));
	}

	collect(): Promise<ProcessDiagnostic> {
		if (this.closed) {
			return Promise.reject(new Error('Diagnostics closed'));
		}
		if (this.pending) {
			return this.pending;
		}
		const pending = this.read();
		this.pending = pending;
		void pending.then(
			() => {
				if (this.pending === pending) {
					this.pending = null;
				}
			},
			() => {
				if (this.pending === pending) {
					this.pending = null;
				}
			},
		);
		return pending;
	}

	private async read(): Promise<ProcessDiagnostic> {
		const memory = process.memoryUsage();
		const cpu = process.cpuUsage();
		this.memory.set({ kind: 'rss' }, memory.rss);
		this.memory.set({ kind: 'heap_used' }, memory.heapUsed);
		this.memory.set({ kind: 'heap_total' }, memory.heapTotal);
		this.memory.set({ kind: 'external' }, memory.external);
		this.memory.set({ kind: 'array_buffers' }, memory.arrayBuffers);
		this.cpu.set({ kind: 'user' }, cpu.user / 1_000_000);
		this.cpu.set({ kind: 'system' }, cpu.system / 1_000_000);
		this.resources.reset();
		const modules = await Promise.all(
			DIAGNOSTIC_MODULE_IDS.map(async (id): Promise<ModuleResourceDiagnostic> => {
				const collector = this.collectors.get(id);
				if (!collector) {
					return { id, status: this.observedModules.has(id) ? 'available' : 'not_instrumented', metrics: [] };
				}
				try {
					const metrics = await collector.collect();
					if (this.closed) {
						throw new Error('Diagnostics closed');
					}
					if (!metrics.length) {
						throw new Error('Empty diagnostic collector');
					}
					const names = new Set<DiagnosticResourceName>();
					for (const metric of metrics) {
						if (
							metric.name === 'active_http_requests' ||
							names.has(metric.name) ||
							DIAGNOSTIC_RESOURCE_UNITS[metric.name] !== metric.unit ||
							!Number.isSafeInteger(metric.value) ||
							metric.value < 0
						) {
							throw new Error('Invalid diagnostic metric');
						}
						names.add(metric.name);
					}
					for (const metric of metrics) {
						this.resources.set({ module: id, resource: metric.name, unit: metric.unit }, metric.value);
					}
					return {
						id,
						status: 'available',
						metrics: metrics.map((metric) => ({
							name: metric.name,
							unit: metric.unit,
							value: metric.value,
						})),
					};
				} catch {
					return { id, status: 'unavailable', metrics: [] };
				}
			}),
		);
		if (this.closed) {
			throw new Error('Diagnostics closed');
		}
		const [memoryValues, cpuValues, gcValues, resourceValues, httpValues] = await Promise.all([
			this.memory.get(),
			this.cpu.get(),
			this.gc.get(),
			this.resources.get(),
			this.httpRequests.get(),
		]);
		if (this.closed) {
			throw new Error('Diagnostics closed');
		}

		const memoryValue = (kind: string): number => {
			const metric = memoryValues.values.find((value) => value.labels.kind === kind);
			if (!metric) {
				throw new Error('Missing memory metric');
			}
			return metric.value;
		};

		const cpuValue = (kind: string): number => {
			const metric = cpuValues.values.find((value) => value.labels.kind === kind);
			if (!metric) {
				throw new Error('Missing CPU metric');
			}
			return metric.value;
		};

		for (const module of modules) {
			if (module.status !== 'available') {
				continue;
			}
			for (const metric of module.metrics) {
				const resource = resourceValues.values.find(
					(value) =>
						'module' in value.labels &&
						'resource' in value.labels &&
						value.labels.module === module.id &&
						value.labels.resource === metric.name,
				);
				if (!resource) {
					throw new Error('Missing resource metric');
				}
				metric.value = resource.value;
			}
			const http = httpValues.values.find((value) => value.labels.module === module.id);
			if (http) {
				module.metrics.push({ name: 'active_http_requests', unit: 'count', value: http.value });
			}
		}
		const gcCount = gcValues.values.find((value) => value.metricName === 'nexus_main_gc_duration_seconds_count');
		const gcDuration = gcValues.values.find((value) => value.metricName === 'nexus_main_gc_duration_seconds_sum');
		if (!gcCount || !gcDuration) {
			throw new Error('Missing GC metric');
		}
		return {
			uptimeSeconds: Math.floor(process.uptime()),
			residentBytes: memoryValue('rss'),
			heapUsedBytes: memoryValue('heap_used'),
			heapTotalBytes: memoryValue('heap_total'),
			externalBytes: memoryValue('external'),
			arrayBufferBytes: memoryValue('array_buffers'),
			cpuUserSeconds: cpuValue('user'),
			cpuSystemSeconds: cpuValue('system'),
			gcCount: gcCount.value,
			gcDurationSeconds: gcDuration.value,
			runtimeVersion: process.version,
			modules,
		};
	}

	close(): void {
		this.closed = true;
		this.observer.disconnect();
		this.collectors.clear();
		this.observedModules.clear();
		this.registry.clear();
	}
}
