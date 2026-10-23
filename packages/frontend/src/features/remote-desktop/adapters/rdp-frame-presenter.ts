type Damage = { left: number; top: number; right: number; bottom: number };

// Optional presentation memory, not a connection/display limit. Larger canvases keep direct SDK rendering.
const MAX_PIXEL_BYTES = 32 * 1024 * 1024;
const MAX_DAMAGE_REGIONS = 32;

function area(rect: Damage): number {
	return (rect.right - rect.left) * (rect.bottom - rect.top);
}

function union(left: Damage, right: Damage): Damage {
	return {
		left: Math.min(left.left, right.left),
		top: Math.min(left.top, right.top),
		right: Math.max(left.right, right.right),
		bottom: Math.max(left.bottom, right.bottom),
	};
}

/** Coalesces decoded pixels only. The SDK still consumes every RDP message and owns its framebuffer. */
export function attachRdpFramePresenter(canvas: HTMLCanvasElement, onFailure: (cause: unknown) => void): () => void {
	const target = canvas.getContext('2d');
	if (!target) return () => undefined;
	const context = target;
	const descriptor = Object.getOwnPropertyDescriptor(context, 'putImageData');
	const present = context.putImageData.bind(context);
	let pixels: ImageData | null = null;
	let damage: Damage[] = [];
	let frame: number | null = null;
	let width = 0;
	let height = 0;
	let direct = false;
	let disposed = false;

	function cancelFrame(): void {
		if (frame !== null) cancelAnimationFrame(frame);
		frame = null;
	}

	function reset(): void {
		cancelFrame();
		pixels = null;
		damage = [];
		width = 0;
		height = 0;
		direct = false;
	}

	function observeDimension(property: 'width' | 'height'): () => void {
		const own = Object.getOwnPropertyDescriptor(canvas, property);
		const native = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
		const set = native?.set;
		if (!set || !native.get) return () => undefined;

		const setDimension = (value: number) => {
			set.call(canvas, value);
			// Even assigning the same size clears a Canvas. Old pending pixels must not paint it again.
			reset();
		};

		Object.defineProperty(canvas, property, { configurable: true, get: native.get, set: setDimension });
		return () => {
			if (Object.getOwnPropertyDescriptor(canvas, property)?.set !== setDimension) return;
			if (own) Object.defineProperty(canvas, property, own);
			else Reflect.deleteProperty(canvas, property);
		};
	}

	const restoreWidth = observeDimension('width');
	const restoreHeight = observeDimension('height');

	function flush(): void {
		cancelFrame();
		const source = pixels;
		const regions = damage;
		damage = [];
		if (disposed || !source || canvas.width !== width || canvas.height !== height) return;
		for (const rect of regions) {
			present(source, 0, 0, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
		}
	}

	function addDamage(rect: Damage): void {
		let current = rect;
		for (let index = 0; index < damage.length;) {
			const other = damage[index];
			if (!other) break;
			const combined = union(current, other);
			const nearby =
				current.left <= other.right + 16 &&
				other.left <= current.right + 16 &&
				current.top <= other.bottom + 16 &&
				other.top <= current.bottom + 16;
			if (nearby && area(combined) <= (area(current) + area(other)) * 1.3) {
				damage.splice(index, 1);
				current = combined;
				index = 0;
			} else {
				index++;
			}
		}
		damage.push(current);
		if (damage.length > MAX_DAMAGE_REGIONS) damage = [damage.reduce(union)];
	}

	function prepare(): void {
		if (width === canvas.width && height === canvas.height) return;
		cancelFrame();
		pixels = null;
		damage = [];
		width = canvas.width;
		height = canvas.height;
		direct = width === 0 || height === 0 || width * height * 4 > MAX_PIXEL_BYTES;
		if (direct) return;
		try {
			pixels = context.createImageData(width, height);
		} catch (cause) {
			if (!(cause instanceof RangeError)) throw cause;
			// A presentation optimization must not turn allocation pressure into a failed desktop.
			direct = true;
		}
	}

	function queuePixels(
		image: ImageData,
		dx: number,
		dy: number,
		dirtyX = 0,
		dirtyY = 0,
		dirtyWidth = image.width,
		dirtyHeight = image.height,
	): void {
		if (disposed) return;
		prepare();
		const source = pixels;
		if (
			direct ||
			!source ||
			!(image.data instanceof Uint8ClampedArray) ||
			![dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight].every(Number.isSafeInteger) ||
			image.data.byteLength !== image.width * image.height * 4
		) {
			flush();
			// Preserve native validation and ordering for any SDK drawing outside the supported pixel path.
			direct = true;
			pixels = null;
			present(image, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight);
			return;
		}
		const left = Math.max(0, Math.min(dirtyX, dirtyX + dirtyWidth), -dx);
		const top = Math.max(0, Math.min(dirtyY, dirtyY + dirtyHeight), -dy);
		const right = Math.min(image.width, Math.max(dirtyX, dirtyX + dirtyWidth), width - dx);
		const bottom = Math.min(image.height, Math.max(dirtyY, dirtyY + dirtyHeight), height - dy);
		if (right <= left || bottom <= top) return;
		if (dx === 0 && left === 0 && right === width && image.width === width) {
			// Full-width stripes are contiguous; avoid creating a view and making a JS call for every row.
			source.data.set(image.data.subarray(top * width * 4, bottom * width * 4), (dy + top) * width * 4);
		} else {
			for (let row = top; row < bottom; row++) {
				const start = (row * image.width + left) * 4;
				const end = (row * image.width + right) * 4;
				source.data.set(image.data.subarray(start, end), ((dy + row) * width + dx + left) * 4);
			}
		}
		addDamage({ left: dx + left, top: dy + top, right: dx + right, bottom: dy + bottom });
		if (frame === null) {
			frame = requestAnimationFrame(() => {
				try {
					flush();
				} catch (cause) {
					onFailure(cause);
				}
			});
		}
	}

	// Only this adapter-owned context is wrapped. Other canvases and global browser prototypes are untouched.
	context.putImageData = queuePixels;
	return () => {
		if (disposed) return;
		disposed = true;
		cancelFrame();
		pixels = null;
		damage = [];
		restoreWidth();
		restoreHeight();
		if (context.putImageData === queuePixels) {
			if (descriptor) Object.defineProperty(context, 'putImageData', descriptor);
			else Reflect.deleteProperty(context, 'putImageData');
		}
	};
}
