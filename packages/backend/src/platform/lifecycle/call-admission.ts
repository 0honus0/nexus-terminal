/** Technical admission for installed capability trees. Does not convert application data. */
export class CallAdmission {
	private accepting = true;
	private readonly pending = new Set<Promise<unknown>>();

	pause(): void {
		this.accepting = false;
	}

	resume(): void {
		if (this.pending.size) {
			throw new Error('Capability calls have not drained');
		}
		this.accepting = true;
	}

	async drain(): Promise<void> {
		await Promise.allSettled([...this.pending]);
	}

	bind<T extends object>(current: () => T, unavailable: () => Error, synchronous: readonly (keyof T)[] = []): T {
		const gate = this;
		const synchronousMethods = new Set<PropertyKey>(synchronous);
		const children = new Map<PropertyKey, object>();
		return new Proxy(current(), {
			get(_target, key) {
				const owner = current();
				const value: unknown = Reflect.get(owner, key);
				if (typeof value === 'function') {
					return (...args: unknown[]): unknown => {
						const invoke = (): unknown => {
							if (!gate.accepting) {
								throw unavailable();
							}
							const active = current();
							const method: unknown = Reflect.get(active, key);
							if (typeof method !== 'function') {
								throw unavailable();
							}
							return Reflect.apply(method, active, args);
						};

						if (synchronousMethods.has(key)) {
							return invoke();
						}
						// Preserve Promise contracts even when admission or an owner fails synchronously.
						let result: Promise<unknown>;
						try {
							result = Promise.resolve(invoke());
						} catch (cause) {
							return Promise.reject(cause);
						}
						gate.pending.add(result);
						void result.then(
							() => gate.pending.delete(result),
							() => gate.pending.delete(result),
						);
						return result;
					};
				}
				if (value !== null && typeof value === 'object') {
					const existing = children.get(key);
					if (existing) {
						return existing;
					}
					const child = gate.bind(() => {
						const latest: unknown = Reflect.get(current(), key);
						if (latest === null || typeof latest !== 'object') {
							throw unavailable();
						}
						return latest;
					}, unavailable);
					children.set(key, child);
					return child;
				}
				return value;
			},
		});
	}
}
