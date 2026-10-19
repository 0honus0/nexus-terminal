import type { HttpRoute } from '../../../../platform/http/http-types.js';
import {
	HTML_THEME_REQUEST_MAX_BYTES,
	HTML_THEME_RESPONSE_MAX_BYTES,
	HTML_THEME_NAME_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/html-themes/values';
import {
	readHtmlThemeName,
	readHtmlThemeCreate,
	readHtmlThemeUpdate,
	readHtmlThemeDelete,
} from '@nexus-terminal/shared/preferences/html-themes/http-codec';
import type { AccessPublicApi } from '../../../access/public.js';
import type { HtmlThemeService } from '../../appearance/service/html-theme-service.js';
import { HtmlThemeFailure } from '../../html-theme-failure.js';
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
			path,

			handle: (context) =>
				handleHtmlTheme(context, async () => {
					const actor = await authenticate(context, access);
					ready(context);
					const rows = await service.list(actor);
					await revalidateHtmlTheme(context, access, actor);
					ready(context);
					const body = rows.map(toWireHtmlTheme);
					if (Buffer.byteLength(JSON.stringify(body)) > HTML_THEME_RESPONSE_MAX_BYTES) {
						throw new HtmlThemeFailure('limit_exceeded');
					}
					context.send(200, body);
				}),
		},
		{
			method: 'GET',
			path: path + '/:themeName',
			maxPathParameterBytes: HTML_THEME_NAME_MAX_BYTES,
			pathParameterAlphabet: 'segment',

			handle: (context) =>
				handleHtmlTheme(context, async () => {
					const actor = await authenticate(context, access);
					ready(context);
					await withAppearanceDeadline(context, (deadlineSignal) =>
						service.readLocal(
							actor,
							readHtmlThemeName(context.params.themeName),
							async (content, ownerSignal) => {
								const signal = AbortSignal.any([deadlineSignal, ownerSignal]);
								await revalidateHtmlTheme(context, access, actor);
								await sendHtmlThemeText(context, content, signal);
							},
						),
					);
				}),
		},
		{
			method: 'POST',
			path,
			maxBodyBytes: HTML_THEME_REQUEST_MAX_BYTES,

			handle: (context) =>
				handleHtmlTheme(context, async () => {
					const actor = await authenticate(context, access);
					const row = await service.create(actor, (signal) =>
						readHtmlThemeInput(context, access, actor, signal, (input) =>
							toApplicationHtmlTheme(readHtmlThemeCreate(input)),
						),
					);
					await deliverHtmlTheme(context, access, actor, 201, toWireHtmlTheme(row));
				}),
		},
		{
			method: 'PUT',
			path: path + '/:themeName',
			maxPathParameterBytes: HTML_THEME_NAME_MAX_BYTES,
			pathParameterAlphabet: 'segment',
			maxBodyBytes: HTML_THEME_REQUEST_MAX_BYTES,

			handle: (context) =>
				handleHtmlTheme(context, async () => {
					const actor = await authenticate(context, access);
					const name = readHtmlThemeName(context.params.themeName);
					const row = await service.update(actor, (signal) =>
						readHtmlThemeInput(context, access, actor, signal, (input) =>
							toApplicationHtmlThemeChange(name, readHtmlThemeUpdate(input)),
						),
					);
					await deliverHtmlTheme(context, access, actor, 200, toWireHtmlTheme(row));
				}),
		},
		{
			method: 'DELETE',
			path: path + '/:themeName',
			maxPathParameterBytes: HTML_THEME_NAME_MAX_BYTES,
			pathParameterAlphabet: 'segment',

			handle: (context) =>
				handleHtmlTheme(context, async () => {
					const actor = await authenticate(context, access);
					const name = readHtmlThemeName(context.params.themeName);
					await service.delete(actor, (signal) =>
						readHtmlThemeInput(context, access, actor, signal, (input) =>
							toApplicationHtmlThemeVersion(name, readHtmlThemeDelete(input)),
						),
					);
					await deliverHtmlTheme(context, access, actor, 200, { deleted: true });
				}),
		},
	];
}
