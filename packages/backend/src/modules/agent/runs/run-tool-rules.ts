import type { ToolOperation, ToolSettlement } from './model/run-tool-types.js';

/** A durable dispatch cannot be reported as a confirmed local cancellation. */
export function maySettleTool(current: ToolOperation, settlement: ToolSettlement): boolean {
	if (current.state === 'inspected') {
		return settlement.state === 'failed' || settlement.state === 'cancelled';
	}
	return current.state === 'dispatched' && settlement.state !== 'cancelled';
}
