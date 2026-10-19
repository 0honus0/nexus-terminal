import type { RemoteDesktopProtocol } from '@nexus-terminal/shared/remote/desktop/values';
import type { ConnectionRoute } from '@nexus-terminal/shared/targets/connections/values';

export interface DesktopTargetSnapshot {
	id: number;
	version: number;
	protocol: RemoteDesktopProtocol;
	host: string;
	port: number;
	username: string;
	route: ConnectionRoute;
	rdpRemoteApp: string | null;
	rdpRemoteAppDirectory: string | null;
	rdpRemoteAppArguments: string | null;
}

export interface ResolvedDesktopTarget {
	id: number;
	version: number;
	protocol: RemoteDesktopProtocol;
	host: string;
	port: number;
	username: string;
	password: string | null;
	rdpRemoteApp: string | null;
	rdpRemoteAppDirectory: string | null;
	rdpRemoteAppArguments: string | null;
}
