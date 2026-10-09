import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AgentCsrfResponseDto } from '@nexus-terminal/protocol/agent-common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../../../shared/logging/logger';
import { agentData, agentError, agentRequestId } from './agent-http';

export interface AgentSecurityOptions {
	nodeEnv: string;
	publicOrigin?: string;
	csrfSecret: string;
}

export const agentUserId = (request: Request): number => {
	const value = request.session.userId;
	if (!value) throw new Error('AUTH_REQUIRED');
	return value;
};

export const requireAgentAuthenticated: RequestHandler = (request, response, next): void => {
	agentRequestId(request, response);
	if (request.session.userId && request.session.username && request.session.requiresTwoFactor !== true) {
		next();
		return;
	}
	agentError(request, response, 401, 'AUTH_REQUIRED', 'Authentication is required.');
};

const loopbackOrigin = (origin: string): boolean => {
	try {
		const hostname = new URL(origin).hostname.toLowerCase();
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
	} catch {
		return false;
	}
};

const requestOrigin = (request: Request): string | undefined => {
	const host = request.header('host')?.trim();
	if (!host) return undefined;
	try {
		return new URL(`${request.protocol}://${host}`).origin;
	} catch {
		return undefined;
	}
};

const tokenMatches = (expected: string, supplied: string | undefined): boolean => {
	if (!supplied) return false;
	const left = Buffer.from(expected);
	const right = Buffer.from(supplied);
	return left.length === right.length && timingSafeEqual(left, right);
};

const agentCsrfToken = (request: Request, secret: string): string =>
	createHmac('sha256', secret).update('nexus-agent-csrf-v1\0').update(request.sessionID).digest('hex');

const rejectAgentMutation = (
	request: Request,
	response: Response,
	options: AgentSecurityOptions,
	reason: string,
	message: string,
): void => {
	logger.error(
		{
			errorCode: 'CSRF_REJECTED',
			reason,
			method: request.method,
			path: request.path,
			origin: request.header('origin'),
			requestOrigin: requestOrigin(request),
			configuredPublicOrigin: options.publicOrigin,
			secFetchSite: request.header('sec-fetch-site'),
			csrfHeaderPresent: Boolean(request.header('x-nexus-csrf')),
		},
		'Agent mutation security rejected request',
	);
	agentError(request, response, 403, 'CSRF_REJECTED', message);
};

export const createAgentMutationSecurity =
	(options: AgentSecurityOptions): RequestHandler =>
	(request: Request, response: Response, next: NextFunction): void => {
		if (request.header('sec-fetch-site') === 'cross-site') {
			rejectAgentMutation(
				request,
				response,
				options,
				'cross-site-request',
				'Cross-site Agent mutation is not allowed.',
			);
			return;
		}

		const origin = request.header('origin');
		if (origin) {
			const allowed =
				origin === requestOrigin(request) ||
				(options.publicOrigin
					? origin === options.publicOrigin
					: options.nodeEnv !== 'production' && loopbackOrigin(origin));
			if (!allowed) {
				rejectAgentMutation(
					request,
					response,
					options,
					'origin-mismatch',
					'Agent mutation origin is not allowed.',
				);
				return;
			}
		}

		if (!tokenMatches(agentCsrfToken(request, options.csrfSecret), request.header('x-nexus-csrf'))) {
			rejectAgentMutation(
				request,
				response,
				options,
				'invalid-csrf-token',
				'A valid Agent CSRF token is required.',
			);
			return;
		}
		next();
	};

export const issueAgentCsrf = (request: Request, response: Response, secret: string): void => {
	response.setHeader('Cache-Control', 'no-store');
	const payload: AgentCsrfResponseDto = { token: agentCsrfToken(request, secret) };
	agentData(request, response, payload);
};
