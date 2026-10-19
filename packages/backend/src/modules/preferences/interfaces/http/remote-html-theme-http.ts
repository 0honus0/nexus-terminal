import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { HtmlThemeService } from '../../appearance/service/html-theme-service.js';
import {
	readHtmlThemeRepositoryUpdate,
	readRemoteHtmlThemeListQuery,
	readRemoteHtmlThemeContentQuery,
} from '@nexus-terminal/shared/preferences/html-themes/http-codec';
import {
	HTML_THEME_REQUEST_MAX_BYTES,
	HTML_THEME_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/html-themes/values';
import { HtmlThemeFailure } from '../../html-theme-failure.js';
import { authenticate, ready } from './appearance-http-support.js';
import { withAppearanceDeadline } from './appearance-http-deadline.js';
import {
	handleHtmlTheme,
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
			path: path + '/repository-url',

			handle: (context) =>
				handleHtmlTheme(context, async () => {
					const actor = await authenticate(context, access);
					ready(context);
					const source = await service.getSource(actor);
					if (source.changed) {
						await deliverHtmlTheme(context, access, actor, 200, toWireHtmlThemeSource(source));
					} else {
						await revalidateHtmlTheme(context, access, actor);
						ready(context);
						context.send(200, toWireHtmlThemeSource(source));
					}
				}),
		},
		{
			method: 'PUT',
			path: path + '/repository-url',
			maxBodyBytes: HTML_THEME_REQUEST_MAX_BYTES,

			handle: (context) =>
				handleHtmlTheme(context, async () => {
					const actor = await authenticate(context, access);
					const source = await service.setSource(actor, (signal) =>
						readHtmlThemeInput(context, access, actor, signal, (input) =>
							toApplicationHtmlThemeSource(readHtmlThemeRepositoryUpdate(input)),
						),
					);
					await deliverHtmlTheme(context, access, actor, 200, toWireHtmlThemeSource(source));
				}),
		},
		{
			method: 'GET',
			path: path + '/list',

			handle: (context) =>
				handleHtmlTheme(
					context,
					() =>
						withAppearanceDeadline(context, async (signal) => {
							const actor = await authenticate(context, access);
							ready(context);
							const query = readRemoteHtmlThemeListQuery(context.query);
							const rows = await service.listRemote(actor, query.repoUrl, signal);
							await revalidateHtmlTheme(context, access, actor);
							ready(context);
							const body = rows.map(toWireRemoteHtmlTheme);
							if (Buffer.byteLength(JSON.stringify(body)) > HTML_THEME_RESPONSE_MAX_BYTES) {
								throw new HtmlThemeFailure('limit_exceeded');
							}
							context.send(200, body);
						}),
					true,
				),
		},
		{
			method: 'GET',
			path: path + '/content',

			handle: (context) =>
				handleHtmlTheme(
					context,
					() =>
						withAppearanceDeadline(context, async (signal) => {
							const actor = await authenticate(context, access);
							ready(context);
							const query = readRemoteHtmlThemeContentQuery(context.query);
							await service.readRemote(actor, query.fileUrl, signal, async (content, active) => {
								await revalidateHtmlTheme(context, access, actor);
								await sendHtmlThemeText(context, content, active);
							});
						}),
					true,
				),
		},
	];
}
