import type { HttpRoute, HttpReply } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { HtmlThemeService } from '../../appearance/service/html-theme-service.js';
import {
	readHtmlThemeRepositoryUpdate,
	readRemoteHtmlThemeListQuery,
	readRemoteHtmlThemeContentQuery,
} from '@nexus-terminal/shared/preferences/html-themes/http-codec';
import { HTML_THEME_REQUEST_MAX_BYTES } from '@nexus-terminal/shared/preferences/html-themes/values';
import { authenticate, ready } from './appearance-http-support.js';
import { withAppearanceDeadline } from './appearance-http-deadline.js';
import {
	handleHtmlTheme,
	htmlThemeHttpErrorHandler,
	sendHtmlThemeJson,
	deliverHtmlTheme,
	readHtmlThemeInput,
	sendHtmlThemeText,
	revalidateHtmlTheme,
} from './html-theme-http-support.js';
import { toApplicationHtmlThemeSource, toWireHtmlThemeSource, toWireRemoteHtmlTheme } from './html-theme-mapper.js';

export function createRemoteHtmlThemeRoutes(service: HtmlThemeService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/appearance/html-presets/remote';
	return [
		{
			method: 'GET',
			url: path + '/repository-url',

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					ready(request, reply);
					const source = await service.getSource(actor);
					if (source.changed) {
						await deliverHtmlTheme(request, reply, access, actor, 200, toWireHtmlThemeSource(source));
					} else {
						await revalidateHtmlTheme(request, reply, access, actor);
						ready(request, reply);
						sendHtmlThemeJson(reply, 200, toWireHtmlThemeSource(source));
					}
				}),
		},
		{
			method: 'PUT',
			url: path + '/repository-url',
			bodyLimit: HTML_THEME_REQUEST_MAX_BYTES,

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const source = await service.setSource(actor, (signal) =>
						readHtmlThemeInput(request, reply, access, actor, signal, (input) =>
							toApplicationHtmlThemeSource(readHtmlThemeRepositoryUpdate(input)),
						),
					);
					await deliverHtmlTheme(request, reply, access, actor, 200, toWireHtmlThemeSource(source));
				}),
		},
		{
			method: 'GET',
			url: path + '/list',

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(
					request,
					reply,
					() =>
						withAppearanceDeadline(request, reply, async (signal) => {
							const actor = await authenticate(request, reply, access);
							ready(request, reply);
							const query = readRemoteHtmlThemeListQuery(request.query);
							const rows = await service.listRemote(actor, query.repoUrl, signal);
							await revalidateHtmlTheme(request, reply, access, actor);
							ready(request, reply);
							const body = rows.map(toWireRemoteHtmlTheme);
							sendHtmlThemeJson(reply, 200, body);
						}),
					true,
				),
		},
		{
			method: 'GET',
			url: path + '/content',

			errorHandler: htmlThemeHttpErrorHandler,

			handler: (request, reply) =>
				handleHtmlTheme(
					request,
					reply,
					() =>
						withAppearanceDeadline(request, reply, async (signal) => {
							const actor = await authenticate(request, reply, access);
							ready(request, reply);
							const query = readRemoteHtmlThemeContentQuery(request.query);
							await service.readRemote(actor, query.fileUrl, signal, async (content, active) => {
								await revalidateHtmlTheme(request, reply, access, actor);
								await sendHtmlThemeText(request, reply, content, active);
							});
						}),
					true,
				),
		},
	];
}
