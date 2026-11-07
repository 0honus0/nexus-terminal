/** Protocol I/O is callable only within the Host control that issued its opaque grant. */
export type AgentPluginServiceTransportFacts =
	{ kind: 'none' } | { kind: 'http'; grant: string } | { kind: 'remoteProcess'; grant: string; cwd: string };

export interface AgentPluginTransportSession {
	sessionId: string;
	transport: AgentPluginServiceTransportFacts;
}

export interface AgentPluginServiceTransportHeader {
	name: string;
	value: string;
}

export type AgentPluginServiceTransportRequest =
	| { method: 'transport.http.open'; params: { grant: string } }
	| {
			method: 'transport.http.request';
			params: {
				leaseId: string;
				method: 'GET' | 'POST' | 'DELETE';
				headers: AgentPluginServiceTransportHeader[];
				bodyUtf8: string | null;
			};
	  }
	| { method: 'transport.http.read'; params: { requestId: string } }
	| { method: 'transport.http.cancel'; params: { requestId: string } }
	| { method: 'transport.http.close'; params: { leaseId: string } }
	| { method: 'transport.stdio.open'; params: { grant: string } }
	| { method: 'transport.stdio.read'; params: { channelId: string; stream: 'stdout' | 'stderr' } }
	| {
			method: 'transport.stdio.write';
			params: { channelId: string; bytesBase64: string; permissionGrant: string | null };
	  }
	| { method: 'transport.stdio.end'; params: { channelId: string } }
	| { method: 'transport.stdio.cancel'; params: { channelId: string } }
	| { method: 'transport.stdio.close'; params: { channelId: string } }
	| { method: 'transport.stdio.outcome'; params: { channelId: string } }
	| {
			method: 'transport.permission.request';
			params: {
				channelId: string;
				sessionId: string;
				toolCallId: string;
				requestId: string;
				title: string;
				kind: string | null;
				inputJson: string;
			};
	  };

export type AgentPluginServiceProcessOutcome =
	| { kind: 'completed' | 'nonzero'; exitCode: number }
	| {
			kind: 'unknown';
			reason: 'disconnect' | 'timeout' | 'cancelled' | 'channel_error' | 'remote_signal';
			signal: string | null;
	  };

export type AgentPluginServiceTransportResult =
	| { method: 'transport.http.open'; value: { leaseId: string } }
	| {
			method: 'transport.http.request';
			value: {
				requestId: string;
				status: number;
				statusText: string;
				headers: AgentPluginServiceTransportHeader[];
				hasBody: boolean;
			};
	  }
	| { method: 'transport.http.read' | 'transport.stdio.read'; value: { bytesBase64: string; eof: boolean } }
	| { method: 'transport.stdio.open'; value: { channelId: string } }
	| { method: 'transport.stdio.outcome'; value: AgentPluginServiceProcessOutcome }
	| {
			method: 'transport.permission.request';
			value: { decision: 'allow_once' | 'reject_once'; grant: string };
	  }
	| {
			method:
				| 'transport.http.cancel'
				| 'transport.http.close'
				| 'transport.stdio.write'
				| 'transport.stdio.end'
				| 'transport.stdio.cancel'
				| 'transport.stdio.close';
			value: null;
	  };
