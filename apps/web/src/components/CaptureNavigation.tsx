import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useBlocker } from 'react-router-dom';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface Protection {
  owner: string;
  busy: boolean;
}

interface CaptureNavigation {
  update: (owner: string, dirty: boolean, busy: boolean) => void;
  release: (owner: string) => void;
}

const Context = createContext<CaptureNavigation | null>(null);

/** Hosted captures share one router blocker; isolated presentation components need no router. */
export function CaptureNavigationProvider({ children }: { children: ReactNode }) {
  const protection = useRef<Protection | null>(null);
  const [busy, setBusy] = useState(false);
  const title = useId();
  const release = useCallback((owner: string) => {
    if (protection.current?.owner === owner) protection.current = null;
  }, []);
  const update = useCallback((owner: string, dirty: boolean, working: boolean) => {
    if (dirty || working) protection.current = { owner, busy: working };
    else if (protection.current?.owner === owner) protection.current = null;
    setBusy(working);
  }, []);
  const context = useMemo(() => ({ update, release }), [update, release]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      protection.current !== null &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (protection.current === null) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return (
    <Context.Provider value={context}>
      {children}
      {blocker.state === 'blocked' && (
        <Dialog variant="overlay" aria-labelledby={title} onDismiss={() => blocker.reset()}>
          <h2 id={title}>Leave this capture?</h2>
          <p>
            Your local screenshots are not safely saved. Leaving clears this selection. Saved
            screenshots stay in the import.
          </p>
          {busy && (
            <p>
              A request is still in progress and may finish after you leave. Check the saved import
              before retrying.
            </p>
          )}
          <div className="upload-checkpoint__actions">
            <Button variant="secondary" onClick={() => blocker.reset()}>
              Stay here
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                protection.current = null;
                blocker.proceed();
              }}
            >
              Leave capture
            </Button>
          </div>
        </Dialog>
      )}
    </Context.Provider>
  );
}

export function useCaptureNavigation(dirty: boolean, busy: boolean) {
  const navigation = useContext(Context);
  const owner = useId();
  useEffect(() => {
    navigation?.update(owner, dirty, busy);
    return () => navigation?.release(owner);
  }, [navigation, owner, dirty, busy]);
  return useCallback(() => navigation?.release(owner), [navigation, owner]);
}
