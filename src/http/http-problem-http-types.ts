import { z } from 'zod';

export const HttpProblemCodeSchema = z.enum([
	'HTTP_INVALID_REQUEST',
	'HTTP_ORIGIN_DENIED',
	'HTTP_NOT_FOUND',
	'HTTP_PAYLOAD_TOO_LARGE',
	'HTTP_UNSUPPORTED_MEDIA_TYPE',
	'HTTP_INTERNAL_ERROR',
	'HTTP_ROUTE_CLOSED',
]);

export type HttpProblemCode = z.infer<typeof HttpProblemCodeSchema>;

export const HttpProblemSchema = z.object({
	type: z.literal('about:blank'),
	status: z.number().int().min(400).max(599),
	code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
});

export type HttpProblem = z.infer<typeof HttpProblemSchema>;
