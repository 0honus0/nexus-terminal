/** Text websocket protocol; data bytes encoded as canonical base64. */
export type RemoteClientEvent =
	| { type: 'input'; data: string }
	| { type: 'resize'; columns: number; rows: number }
	| { type: 'consumed'; bytes: number }
	| { type: 'close' };

export type RemoteServerEvent =
	| { type: 'ready'; sessionId: string }
	| { type: 'data'; data: string; stream: 'stdout' | 'stderr' }
	| { type: 'drain' }
	| { type: 'blocked' }
	| { type: 'closed' }
	| {
			type: 'error';
			code: 'invalid_input' | 'unauthenticated' | 'not_found' | 'transport_overflow' | 'remote_unavailable';
	  };
