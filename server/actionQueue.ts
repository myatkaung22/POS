type Task<T> = () => Promise<T>;

const exclusive = new Map<string, Promise<unknown>>();
let printTail: Promise<unknown> = Promise.resolve();

/** Share one in-flight job (second Print bill does not print again). */
export function coalesceExclusive<T>(key: string, task: Task<T>): Promise<{ value: T; coalesced: boolean }> {
  const existing = exclusive.get(key) as Promise<{ value: T; coalesced: boolean }> | undefined;
  if (existing) {
    return existing.then(({ value }) => ({ value, coalesced: true }));
  }
  const job = task().then((value) => ({ value, coalesced: false }));
  exclusive.set(key, job);
  const done = job.finally(() => {
    if (exclusive.get(key) === job) exclusive.delete(key);
  });
  exclusive.set(key, done);
  return done;
}

/** Run one-after-another per key (pay / send kitchen wait, then run). */
export function runSerial<T>(key: string, task: Task<T>): Promise<T> {
  const prev = exclusive.get(key) || Promise.resolve();
  const job = prev.then(task, task);
  exclusive.set(
    key,
    job.then(
      () => undefined,
      () => undefined
    )
  );
  return job;
}

/** One hardware print at a time so USB/Ethernet jobs cannot overlap. */
export function enqueuePrint<T>(task: Task<T>): Promise<T> {
  const job = printTail.then(task, task);
  printTail = job.then(
    () => undefined,
    () => undefined
  );
  return job;
}
