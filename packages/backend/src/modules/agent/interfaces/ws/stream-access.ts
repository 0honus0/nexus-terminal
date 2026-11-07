import type { AgentStreamAuthorization } from '@nexus-terminal/shared/agent/runs/events';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { ThreadAccess } from '../../scope/model/thread-types.js';
import type { AgentStreamSourceContext } from './agent-stream-sources.js';

export interface StreamAccess {
	actor: ThreadAccess;
	close(): void;
}

/** Plugin subscriptions preserve and observe the original UI grant independently of the page session. */
export async function createStreamAccess(
	plugins: Pick<PluginService, 'frontendAccess' | 'watchFrontendGrant'>,
	context: AgentStreamSourceContext,
	appId: string,
	authorization: AgentStreamAuthorization,
): Promise<StreamAccess> {
	if (authorization.kind === 'session') {
		return {
			actor: {
				kind: 'session',
				userId: context.identity.userId,
				token: context.identity.token,
				appId,
				appVersion: authorization.appVersion,
				assertCurrent: context.assertCurrent,
			},

			close() {},
		};
	}
	const permission = await plugins.frontendAccess(context.identity, appId, authorization.grant);
	const unsubscribe = plugins.watchFrontendGrant(context.identity, appId, authorization.grant, context.revoked);
	try {
		context.assertCurrent();
		permission.assertCurrent();
		return {
			actor: {
				kind: 'plugin',
				userId: permission.userId,
				token: permission.token,
				appId: permission.appId,
				revision: permission.revision,
				expiresAt: permission.expiresAt,

				assertCurrent() {
					context.assertCurrent();
					permission.assertCurrent();
				},
			},
			close: unsubscribe,
		};
	} catch (cause) {
		unsubscribe();
		throw cause;
	}
}
