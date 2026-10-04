/** An operation has drained all side effects and can prove its failed outcome. */
export class KnownMutationFailure extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KnownMutationFailure';
  }
}
