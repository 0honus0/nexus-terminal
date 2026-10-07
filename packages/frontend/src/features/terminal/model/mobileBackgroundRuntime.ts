// Runs before theme scripts in the opaque-origin background document. Keep
// background frame work separate from terminal input/output rendering.
const createBackgroundRuntime = (frameIntervalMs: number) => `<script>(() => {
  const requestFrame = window.requestAnimationFrame.bind(window);
  const cancelFrame = window.cancelAnimationFrame.bind(window);
  const callbacks = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pausedStyle = document.createElement('style');
  document.head.appendChild(pausedStyle);
  let nextId = 0, timer = null, frame = null, lastFrame = 0;
  let visible = true, painted = false;
  const paused = () => !visible || document.hidden || (reducedMotion.matches && painted);
  const clearSchedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (frame !== null) cancelFrame(frame);
    timer = frame = null;
  };
  const schedule = () => {
    if (paused() || !callbacks.size || timer !== null || frame !== null) return;
    const paint = () => {
      timer = null;
      if (paused()) return;
      frame = requestFrame(timestamp => {
        frame = null;
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
        schedule();
      });
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
    if (paused()) clearSchedule();
    else { lastFrame = 0; schedule(); }
  };
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'nexus-background-geometry') return;
    visible = Boolean(event.data.visible);
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);
  sync();
})();<\/script>`;

export const mobileBackgroundRuntime = createBackgroundRuntime(50);
export const desktopBackgroundRuntime = createBackgroundRuntime(0);
