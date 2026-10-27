export class WebSocketConnectionFailure extends Error {
	constructor(options?: ErrorOptions) {
		super('WebSocket connection unavailable', options);
		this.name = 'WebSocketConnectionFailure';
	}
}
