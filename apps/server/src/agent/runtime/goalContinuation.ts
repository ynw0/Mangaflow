/** Continue one goal in the same Agent session without an arbitrary turn cap. */
export async function continueGoalUntilFinished(options: {
  isComplete: () => boolean;
  isStopped: () => boolean;
  continueOnce: () => Promise<void>;
}): Promise<void> {
  // The caller must provide awaited model work: avoid spinning when the model is idle.
  while (!options.isComplete() && !options.isStopped()) {
    await options.continueOnce();
  }
}
