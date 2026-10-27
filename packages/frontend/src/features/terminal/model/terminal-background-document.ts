// Runs before theme scripts in the opaque-origin background document. Keep
// background frame work separate from terminal input/output rendering.
const createBackgroundRuntime = (frameIntervalMs: number) => `<script>(() => {
  const requestFrame = window.requestAnimationFrame.bind(window);
  const cancelFrame = window.cancelAnimationFrame.bind(window);
  const callbacks = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pausedStyle = document.createElement('style');
  document.head.appendChild(pausedStyle);
  let nextId = 0, timer = null, frame = null, deadline = null, lastFrame = 0, generation = 0;
  let visible = true, painted = false;
  let width = -1, height = -1;
  const paused = () => !visible || document.hidden || (reducedMotion.matches && painted);
  const clearSchedule = () => {
    generation++;
    if (timer !== null) window.clearTimeout(timer);
    if (frame !== null) cancelFrame(frame);
    if (deadline !== null) window.clearTimeout(deadline);
    timer = frame = deadline = null;
  };
  const schedule = () => {
    if (paused() || !callbacks.size || timer !== null || frame !== null) return;
    const paint = () => {
      timer = null;
      if (paused()) return;
      const frameGeneration = generation;
      const draw = timestamp => {
        if (frameGeneration !== generation) return;
        clearSchedule();
        if (paused()) return;
        lastFrame = timestamp;
        const ids = [...callbacks.keys()];
        for (const id of ids) {
          const callback = callbacks.get(id);
          if (!callback) continue;
          callbacks.delete(id);
          try { callback(timestamp); }
          catch (error) { window.setTimeout(() => { throw error; }, 0); }
        }
        painted = true;
        if (paused()) clearSchedule();
        else schedule();
      };
      frame = requestFrame(draw);
      // A visible document can retain a stalled native RAF after a long pause.
      // Keep the deadline local to this frame; hidden documents cancel both.
      deadline = window.setTimeout(() => draw(performance.now()), 100);
    };
    // Mobile backgrounds use a capped frame rate; desktop backgrounds keep native RAF timing.
    if (${frameIntervalMs} > 0) timer = window.setTimeout(paint, Math.max(0, ${frameIntervalMs} - (performance.now() - lastFrame)));
    else paint();
  };
  window.requestAnimationFrame = callback => {
    const id = ++nextId;
    callbacks.set(id, callback);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = id => {
    callbacks.delete(id);
    if (!callbacks.size) clearSchedule();
  };
  const sync = () => {
    pausedStyle.textContent = !visible || document.hidden || reducedMotion.matches
      ? '*,*::before,*::after{animation-play-state:paused!important}' : '';
    // A browser may discard a queued native callback while retaining its ID.
    // Re-arm from our callback queue on every explicit lifecycle notification.
    clearSchedule();
    if (!paused()) schedule();
  };
  // Geometry and animation share the same visibility authority. Do not depend
  // on native iframe resize delivery, and never resize a theme's canvas for it.
  const syncGeometry = () => {
    if (!visible || document.hidden) { width = height = -1; return; }
    const nextWidth = document.documentElement.clientWidth;
    const nextHeight = document.documentElement.clientHeight;
    if (nextWidth <= 0 || nextHeight <= 0 || (nextWidth === width && nextHeight === height)) return;
    width = nextWidth; height = nextHeight;
    window.dispatchEvent(new Event('resize'));
  };
  const restore = () => { width = height = -1; painted = false; syncGeometry(); sync(); };
  document.addEventListener('DOMContentLoaded', () => {
    const observer = new ResizeObserver(syncGeometry);
    observer.observe(document.documentElement);
    syncGeometry();
  }, { once: true });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'nexus-background-geometry' || typeof event.data.visible !== 'boolean') return;
    if (event.data.visible && !visible) painted = false;
    visible = event.data.visible;
    syncGeometry();
    sync();
  });
  document.addEventListener('visibilitychange', restore);
  window.addEventListener('pageshow', restore);
  window.addEventListener('pagehide', clearSchedule);
  // Resizing a canvas clears its pixels. Reduced motion still needs one new
  // static frame after resize, rather than permanently freezing an empty canvas.
  window.addEventListener('resize', () => { painted = false; sync(); });
  reducedMotion.addEventListener('change', sync);
  sync();
})();<\/script>`;

interface TerminalBackgroundDocumentOptions {
	html: string;
	imageVisible: boolean;
	isMobile: boolean;
}

export function createTerminalBackgroundDocument(options: TerminalBackgroundDocumentOptions): string {
	const csp = [
		"default-src 'none'",
		"script-src 'unsafe-inline'",
		"style-src 'unsafe-inline'",
		'img-src data: blob:',
		'font-src data:',
		"connect-src 'none'",
		'media-src data: blob:',
	].join('; ');
	const baseStyle = 'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}';
	const imageOverride = options.imageVisible
		? 'html,body{background:transparent!important}body>:not(style):not(script){background-color:transparent!important}'
		: '';
	return [
		`<meta http-equiv="Content-Security-Policy" content="${csp}">`,
		`<style>${baseStyle}${imageOverride}</style>`,
		createBackgroundRuntime(options.isMobile ? 50 : 0),
		options.html,
	].join('');
}
