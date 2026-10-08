// Only adapters that reject before dispatching any action may use this error.
export class BrowserActionNotDispatchedError extends Error {
  constructor() {
    super('BROWSER_NODE_STALE');
    this.name = 'BrowserActionNotDispatchedError';
  }
}
