import type { LocalStatusPort } from '../../../../platform/system/local-status-port.js';
import type { LocalSystemStatus } from './status-types.js';

export class SystemStatusModel {
	constructor(private readonly port: LocalStatusPort) {}

	async collect(): Promise<LocalSystemStatus> {
		const value = await this.port.collect();
		return {
			cpuPercent: value.cpuPercent,
			memPercent: value.memPercent,
			memUsed: value.memUsed,
			memTotal: value.memTotal,
			diskPercent: value.diskPercent,
			diskUsed: value.diskUsed,
			diskTotal: value.diskTotal,
			cpuModel: value.cpuModel,
			osName: value.osName,
			uptimeSeconds: value.uptimeSeconds,
		};
	}
}
