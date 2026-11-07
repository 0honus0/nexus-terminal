/** Local keys are unique within one plugin invocation, rather than across every tool in a Run. */
export function pluginCallOwner(runId: string, instanceId: string, operationId: string | null): string {
	return JSON.stringify([runId, instanceId, operationId]);
}
