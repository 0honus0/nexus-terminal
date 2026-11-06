import * as z from 'zod/mini';
import {
	DIAGNOSTIC_MODULE_IDS,
	DIAGNOSTIC_RESOURCE_UNITS,
	DIAGNOSTIC_RESOURCE_STATUSES,
	type DiagnosticResourceName,
} from './values.js';

const count = z.int().check(z.gte(0));

const amount = z.number().check(z.gte(0), z.lte(Number.MAX_SAFE_INTEGER));

const names = Object.keys(DIAGNOSTIC_RESOURCE_UNITS).filter((name): name is DiagnosticResourceName =>
	Object.hasOwn(DIAGNOSTIC_RESOURCE_UNITS, name),
);

const metricSchema = z
	.strictObject({
		name: z.enum(names),
		unit: z.enum([...new Set(Object.values(DIAGNOSTIC_RESOURCE_UNITS))]),
		value: count,
	})
	.check(z.refine((value) => value.unit === DIAGNOSTIC_RESOURCE_UNITS[value.name]));

export const moduleResourceSchema = z
	.strictObject({
		id: z.enum(DIAGNOSTIC_MODULE_IDS),
		status: z.enum(DIAGNOSTIC_RESOURCE_STATUSES),
		metrics: z.array(metricSchema).check(z.maxLength(names.length)),
	})
	.check(
		z.refine(
			(value) =>
				(value.status === 'available' ? value.metrics.length > 0 : value.metrics.length === 0) &&
				new Set(value.metrics.map((metric) => metric.name)).size === value.metrics.length,
		),
	);

export type ModuleResourceView = z.infer<typeof moduleResourceSchema>;

export const hostDiagnosticSchema = z.strictObject({
	collectedAt: count,
	process: z
		.strictObject({
			uptimeSeconds: count,
			residentBytes: count,
			heapUsedBytes: count,
			runtimeVersion: z.string().check(
				z.minLength(1),
				z.maxLength(64),
				z.refine((value) => {
					const bytes = new TextEncoder().encode(value);
					return !!value.trim() && bytes.length <= 64 && new TextDecoder().decode(bytes) === value;
				}),
			),
			heapTotalBytes: count,
			externalBytes: count,
			arrayBufferBytes: count,
			cpuUserSeconds: amount,
			cpuSystemSeconds: amount,
			gcCount: count,
			gcDurationSeconds: amount,
		})
		.check(z.refine((value) => value.heapUsedBytes <= value.heapTotalBytes)),
	database: z
		.strictObject({ available: z.boolean(), schemaVersion: z.nullable(count) })
		.check(z.refine((value) => value.available === (value.schemaVersion !== null))),
	modules: z.array(moduleResourceSchema).check(
		z.length(DIAGNOSTIC_MODULE_IDS.length),
		z.refine((values) => new Set(values.map((value) => value.id)).size === values.length),
	),
});

export type HostDiagnosticView = z.infer<typeof hostDiagnosticSchema>;
