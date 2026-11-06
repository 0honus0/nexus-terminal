import type { HttpReply } from '../../../../platform/http/http-types.js';

export function serializeAccessCookie(
	reply: HttpReply,
	name: string,
	value: string,
	options: { secure: boolean; maxAge?: number },
): string {
	// Serialize directly onto the reply header: failed credential delivery must
	// be able to remove it without an onSend queue reintroducing the credential.
	return reply.server.serializeCookie(name, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: options.secure,
		maxAge: options.maxAge,
	});
}
