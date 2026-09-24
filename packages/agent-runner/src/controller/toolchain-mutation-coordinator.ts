export class ToolchainMutationCoordinator {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(work: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => gate);
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
