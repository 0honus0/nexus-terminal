import proxyaddr from 'proxy-addr';

/** Numeric hop trust requires deployment to prevent shorter untrusted paths. */
export const compileProxyTrust = (value: string): ((address: string, index: number) => boolean) => {
	if (/^\d+$/.test(value)) {
		const hops = Number(value);
		if (!Number.isSafeInteger(hops)) throw new Error('TRUST_PROXY_INVALID');
		return (_address, index) => index < hops;
	}
	return proxyaddr.compile(value.split(',').map((address) => address.trim()));
};
