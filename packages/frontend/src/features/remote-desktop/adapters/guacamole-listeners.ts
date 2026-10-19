/** Guacamole does not expose listener disposal. Scope its native subscriptions to this peer. */
export function scopedElement(element: HTMLElement, cleanups: Array<() => void>): HTMLElement {
	return new Proxy(element, {
		get(target, key) {
			if (key === 'addEventListener') {
				return (
					type: string,
					listener: EventListenerOrEventListenerObject,
					options?: boolean | AddEventListenerOptions,
				) => {
					target.addEventListener(type, listener, options);
					cleanups.push(() => target.removeEventListener(type, listener, options));
				};
			}
			if (key === 'removeEventListener') return target.removeEventListener.bind(target);
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}
