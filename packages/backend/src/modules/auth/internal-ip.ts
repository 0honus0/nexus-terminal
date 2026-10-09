import ipaddr from 'ipaddr.js';

/** LAN/loopback bypass is separate from authority to supply proxy headers. */
export const isInternalIp = (source: string | undefined): boolean => {
	if (source === 'localhost') return true;
	if (!source) return false;
	try {
		return ['loopback', 'private', 'linkLocal', 'uniqueLocal'].includes(ipaddr.process(source).range());
	} catch {
		return false;
	}
};
