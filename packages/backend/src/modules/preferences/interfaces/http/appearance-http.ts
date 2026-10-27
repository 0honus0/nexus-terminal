import { withAppearanceDeadline } from './appearance-http-deadline.js';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { AppearanceService } from '../../appearance/service/appearance-service.js';
import { APPEARANCE_REQUEST_MAX_BYTES } from '@nexus-terminal/shared/preferences/appearance/values';
import { readAppearanceUpdate } from '@nexus-terminal/shared/preferences/appearance/http-codec';
import { toApplicationAppearance, toWireAppearance } from './appearance-mapper.js';
import { authenticate, revalidate, ready, deliver, handle, readAppearanceInput } from './appearance-http-support.js';

export function createAppearanceRoutes(service: AppearanceService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/appearance';
	return [
		{
			method: 'GET',
			path,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					ready(context);
					const saved = await service.get(actor);
					if (saved.changed) {
						await deliver(context, access, actor, () => toWireAppearance(saved.value));
					} else {
						await revalidate(context, access, actor);
						ready(context);
						context.send(200, toWireAppearance(saved.value));
					}
				}),
		},
		{
			method: 'PUT',
			path,
			maxBodyBytes: APPEARANCE_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const saved = await service.update(actor, (ownerSignal) =>
						readAppearanceInput(ownerSignal, () =>
							withAppearanceDeadline(context, async (deadlineSignal) => {
								const signal = AbortSignal.any([ownerSignal, deadlineSignal]);
								const input = readAppearanceUpdate(await context.json(signal));
								await revalidate(context, access, actor);
								ready(context);
								signal.throwIfAborted();
								return toApplicationAppearance(input);
							}),
						),
					);
					await deliver(context, access, actor, () => toWireAppearance(saved));
				}),
		},
	];
}
