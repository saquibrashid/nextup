import { useCallback, useEffect, useRef } from 'react';

/** A confirmed leave stops subsequent writes, without pretending to cancel the current request. */
export function useCaptureLifetime() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return useCallback(() => active.current, []);
}
