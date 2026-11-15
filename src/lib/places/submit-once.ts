/** Compartilha a mesma criação enquanto a primeira requisição ainda está ativa. */
export function createSubmitOnce<Args extends unknown[], T>(operation: (...args: Args) => Promise<T>): (...args: Args) => Promise<T> {
  let pending: Promise<T> | null = null;
  return (...args: Args) => {
    if (pending) return pending;
    pending = operation(...args).finally(() => { pending = null; });
    return pending;
  };
}
