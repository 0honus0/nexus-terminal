import type { RemoteStatusSample } from '@nexus-terminal/shared/remote/monitoring/model';
import type { StatusSample } from './status-types';

export function toStatusSample(value: RemoteStatusSample): StatusSample {
	return {
		cpuPercent: value.cpuPercent,
		memPercent: value.memPercent,
		memUsed: value.memUsed,
		memTotal: value.memTotal,
		swapPercent: value.swapPercent,
		swapUsed: value.swapUsed,
		swapTotal: value.swapTotal,
		diskPercent: value.diskPercent,
		diskUsed: value.diskUsed,
		diskTotal: value.diskTotal,
		cpuModel: value.cpuModel,
		netRxRate: value.netRxRate,
		netTxRate: value.netTxRate,
		netInterface: value.netInterface,
		osName: value.osName,
		loadAvg: value.loadAvg?.map((item) => item),
		timestamp: value.timestamp,
	};
}
