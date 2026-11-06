import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { HTML_THEME_REQUEST_MAX_BYTES } from '@nexus-terminal/shared/preferences/html-themes/values';
import {
	readHtmlThemeName,
	readHtmlThemeCreate,
	readHtmlThemeUpdate,
	readHtmlThemeDelete,
} from '@nexus-terminal/shared/preferences/html-themes/http-codec';
import type { AccessPublicApi } from '../../../access/public.js';
import type { HtmlThemeService } from '../../appearance/service/html-theme-service.js';
import { withAppearanceDeadline } from './appearance-http-deadline.js';
import { authenticate, ready } from './appearance-http-support.js';
import {
	toApplicationHtmlTheme,
	toApplicationHtmlThemeChange,
	toApplicationHtmlThemeVersion,
	toWireHtmlTheme,
} from './html-theme-mapper.js';
import {
	handleHtmlTheme,
	htmlThemeHttpErrorHandler,
	sendHtmlThemeJson,
	deliverHtmlTheme,
	readHtmlThemeInput,
	sendHtmlThemeText,
	revalidateHtmlTheme,
} from './html-theme-http-support.js';

export function createHtmlThemeRoutes(service: HtmlThemeService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/appearance/html-presets/local';
	return [
		{
			method: 'GET',
			url: path,

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					ready(request, reply);
					const rows = await service.list(actor);
					await revalidateHtmlTheme(request, reply, access, actor);
					ready(request, reply);
					const body = rows.map(toWireHtmlTheme);
					sendHtmlThemeJson(reply, 200, body);
				}),
		},
		{
			method: 'GET',
			url: path + '/:themeName',

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					ready(request, reply);
					await withAppearanceDeadline(request, reply, (deadlineSignal) =>
						service.readLocal(
							actor,
							readHtmlThemeName(request.params.themeName),
							async (content, ownerSignal) => {
								const signal = AbortSignal.any([deadlineSignal, ownerSignal]);
								await revalidateHtmlTheme(request, reply, access, actor);
								await sendHtmlThemeText(request, reply, content, signal);
							},
						),
					);
				}),
		},
		{
			method: 'POST',
			url: path,
			bodyLimit: HTML_THEME_REQUEST_MAX_BYTES,

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const row = await service.create(actor, (signal) =>
						readHtmlThemeInput(request, reply, access, actor, signal, (input) =>
							toApplicationHtmlTheme(readHtmlThemeCreate(input)),
						),
					);
					await deliverHtmlTheme(request, reply, access, actor, 201, toWireHtmlTheme(row));
				}),
		},
		{
			method: 'PUT',
			url: path + '/:themeName',

			bodyLimit: HTML_THEME_REQUEST_MAX_BYTES,

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const name = readHtmlThemeName(request.params.themeName);
					const row = await service.update(actor, (signal) =>
						readHtmlThemeInput(request, reply, access, actor, signal, (input) =>
							toApplicationHtmlThemeChange(name, readHtmlThemeUpdate(input)),
						),
					);
					await deliverHtmlTheme(request, reply, access, actor, 200, toWireHtmlTheme(row));
				}),
		},
		{
			method: 'DELETE',
			url: path + '/:themeName',

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const name = readHtmlThemeName(request.params.themeName);
					await service.delete(actor, (signal) =>
						readHtmlThemeInput(request, reply, access, actor, signal, (input) =>
							toApplicationHtmlThemeVersion(name, readHtmlThemeDelete(input)),
						),
					);
					await deliverHtmlTheme(request, reply, access, actor, 200, { deleted: true });
				}),
		},
	];
}
