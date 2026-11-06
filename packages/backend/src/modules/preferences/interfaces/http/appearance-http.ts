import { withAppearanceDeadline } from './appearance-http-deadline.js';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { AppearanceService } from '../../appearance/service/appearance-service.js';
import { APPEARANCE_REQUEST_MAX_BYTES } from '@nexus-terminal/shared/preferences/appearance/values';
import { readAppearanceUpdate } from '@nexus-terminal/shared/preferences/appearance/http-codec';
import { toApplicationAppearance, toWireAppearance } from './appearance-mapper.js';
import {
	authenticate,
	revalidate,
	ready,
	deliver,
	handle,
	readAppearanceInput,
	appearanceHttpErrorHandler,
	sendAppearanceJson,
} from './appearance-http-support.js';

export function createAppearanceRoutes(service: AppearanceService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/appearance';
	return [
		{
			method: 'GET',
			url: path,

			errorHandler: appearanceHttpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					ready(request, reply);
					const saved = await service.get(actor);
					if (saved.changed) {
						await deliver(request, reply, access, actor, () => toWireAppearance(saved.value));
					} else {
						await revalidate(request, reply, access, actor);
						ready(request, reply);
						sendAppearanceJson(reply, toWireAppearance(saved.value));
					}
				}),
		},
		{
			method: 'PUT',
			url: path,
			bodyLimit: APPEARANCE_REQUEST_MAX_BYTES,

			errorHandler: appearanceHttpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const saved = await service.update(actor, (ownerSignal) =>
						readAppearanceInput(ownerSignal, () =>
							withAppearanceDeadline(request, reply, async (deadlineSignal) => {
								const signal = AbortSignal.any([ownerSignal, deadlineSignal]);
								const input = readAppearanceUpdate(request.body);
								await revalidate(request, reply, access, actor);
								ready(request, reply);
								signal.throwIfAborted();
								return toApplicationAppearance(input);
							}),
						),
					);
					await deliver(request, reply, access, actor, () => toWireAppearance(saved));
				}),
		},
	];
}
