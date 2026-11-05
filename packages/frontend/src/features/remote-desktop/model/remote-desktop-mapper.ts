import type {
	RemoteDesktopDisplayRequest,
	RemoteDesktopSessionResponse,
	RdpCertificateView,
	RemoteDesktopSessionRequest,
} from '@nexus-terminal/shared/remote/desktop/http';
import type {
	RemoteDesktopDisplay,
	RemoteDesktopSession,
	RemoteDesktopCertificate,
	RemoteDesktopCertificateApproval,
} from './remote-desktop-types';

export function toSession(value: RemoteDesktopSessionResponse): RemoteDesktopSession {
	return {
		ticket: value.ticket,
		protocol: value.protocol,
		host: value.host,
		port: value.port,
		username: value.username,
		password: value.password,
	};
}

export function toDisplayRequest(value: RemoteDesktopDisplay): RemoteDesktopDisplayRequest {
	return { width: value.width, height: value.height, dpi: value.dpi };
}

export function toCertificate(source: RdpCertificateView): RemoteDesktopCertificate {
	return {
		connectionId: source.connectionId,
		host: source.host,
		port: source.port,
		fingerprint: source.fingerprint,
		previousFingerprint: source.previousFingerprint,
		subject: source.subject,
		issuer: source.issuer,
		validFrom: source.validFrom,
		validTo: source.validTo,
		reason: source.reason,
	};
}

export function toCertificateRequest(source: RemoteDesktopCertificateApproval | null): RemoteDesktopSessionRequest {
	return {
		certificate:
			source === null
				? null
				: {
						host: source.host,
						port: source.port,
						fingerprint: source.fingerprint,
						previousFingerprint: source.previousFingerprint,
						remember: source.remember,
					},
	};
}
