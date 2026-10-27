import type { TransferTask } from './transfer-types';

export function formatTransferBytes(bytes: number): string {
	const value = Math.max(0, bytes);
	if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
	if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
	if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${Math.round(value)} B`;
}

export function isIndeterminateArchiveProgress(task: TransferTask): boolean {
	return (
		(task.kind === 'compress' || task.kind === 'decompress') &&
		task.totalFiles === null &&
		task.progress < 100 &&
		['queued', 'preparing', 'running', 'paused', 'cancelling'].includes(task.status)
	);
}
