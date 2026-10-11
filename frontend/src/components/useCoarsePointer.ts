import { useSyncExternalStore } from 'react';

let coarseMql: MediaQueryList | null = null;
function coarseQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  return (coarseMql ??= window.matchMedia('(pointer: coarse)'));
}

/** True on touch-first devices (phones / tablets). */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    cb => {
      const mq = coarseQuery();
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    () => coarseQuery()?.matches ?? false,
    () => false,
  );
}
