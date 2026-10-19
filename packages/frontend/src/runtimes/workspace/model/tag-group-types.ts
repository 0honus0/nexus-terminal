import type { TagSummary } from '@/features/tags/public';
import type { ConnectionSummary } from '@/features/connections/public';

export interface TagGroupInput {
	visible: boolean;
	tag: TagSummary | null;
	connections: readonly ConnectionSummary[];
}
