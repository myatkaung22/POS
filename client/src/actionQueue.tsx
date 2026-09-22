import { useEffect, useState } from "react";
import { toast } from "./components/Toast";

const DEBOUNCE_MS = 700;
const inflight = new Set<string>();
const lastStart = new Map<string, number>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function isActionBusy(key: string) {
  if (inflight.has(key)) return true;
  const started = lastStart.get(key);
  return Boolean(started && Date.now() - started < DEBOUNCE_MS);
}

export function useActionQueue() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return {
    busy: (key?: string) => (key ? isActionBusy(key) : inflight.size > 0),
    run: runAction,
  };
}

/** Ignore a second click on the same button until it finishes (and a short debounce). Does not queue a second print. */
export async function runAction(key: string, _label: string, task: () => Promise<void>) {
  if (isActionBusy(key)) return false;
  lastStart.set(key, Date.now());
  inflight.add(key);
  notify();
  try {
    await task();
  } catch (err) {
    toast(err instanceof Error ? err.message : "Action failed", "err");
  } finally {
    inflight.delete(key);
    notify();
    const remain = DEBOUNCE_MS - (Date.now() - (lastStart.get(key) || 0));
    if (remain > 0) setTimeout(notify, remain);
  }
  return true;
}
