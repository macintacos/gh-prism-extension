/** Memoises `load`'s promise, forgetting it on rejection so the next call retries. */
export function retriedOnFailure<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
