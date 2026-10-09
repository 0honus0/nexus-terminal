import type { CreateConnectionInput } from './connection.types';
import type { ProxyInput } from '../proxies/proxy.types';

export interface ConnectionImportCommitPort {
	create(connection: CreateConnectionInput, proxy?: ProxyInput | null): Promise<void>;
}
