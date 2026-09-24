import { useId, useState } from 'react';
import { SERVICE_LABELS } from '@nextup/domain';
import { resumeAction, type UploadCheckpointState } from '../lib/useUploadCheckpoint';
import { useSlowRequest } from '../lib/useSlowRequest';
import { useOutcomeFocus } from '../lib/useOutcomeFocus';
import { OFFLINE_DISABLED_REASON } from '../copy';
import { SlowResponseNotice } from './SlowResponseNotice';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface UploadCheckpointProps {
  state: UploadCheckpointState;
  online: boolean;
  busy: boolean;
  heldCount: number;
  message: string | null;
  error: string | null;
  onRetry: () => void;
  onResume: () => Promise<void>;
  onDiscard: () => Promise<void>;
}

export function UploadCheckpoint({
  state,
  online,
  busy,
  heldCount,
  message,
  error,
  onRetry,
  onResume,
  onDiscard,
}: UploadCheckpointProps) {
  const [confirm, setConfirm] = useState<'discard' | 'leave' | null>(null);
  const heading = useId();
  const focus = useOutcomeFocus<HTMLHeadingElement>(
    state.kind === 'open' || state.kind === 'failed',
  );
  const phase = useSlowRequest(state.kind === 'checking' && online);
  const batch = state.kind === 'open' ? state.batch : null;
  const action = batch === null ? null : resumeAction(batch.status);
  const disabled = busy || !online;

  return (
    <section className="upload-checkpoint" data-testid="upload-checkpoint">
      <p className="upload-checkpoint__eyebrow">Capture / Unfinished work</p>
      <h1 ref={focus} tabIndex={-1}>
        {batch === null ? 'Before you upload' : 'Continue your unfinished import'}
      </h1>
      {message !== null && (
        <p role="status" data-testid="open-batch-message">
          {message}
        </p>
      )}
      {!online ? (
        <p role="status">{OFFLINE_DISABLED_REASON}</p>
      ) : (
        <>
          {state.kind === 'checking' && <p role="status">Checking for unfinished uploads...</p>}
          <SlowResponseNotice phase={phase} onRetry={onRetry} />
        </>
      )}
      {state.kind === 'failed' && (
        <div role="alert">
          <p>Could not check for unfinished uploads. No new import was started.</p>
          <p>{state.message}</p>
          <Button variant="secondary" disabled={disabled} onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {batch !== null && action !== null && (
        <>
          <p className="upload-checkpoint__state">{action.state}</p>
          <dl className="upload-checkpoint__facts">
            <div>
              <dt>Service</dt>
              <dd>{SERVICE_LABELS[batch.service] ?? 'Discovery'}</dd>
            </div>
            <div>
              <dt>Update mode</dt>
              <dd>{batch.mode === 'full-update' ? 'Full update' : 'Add only'}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>
                {new Date(batch.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
              </dd>
            </div>
          </dl>
          <p>
            Finish this import before starting another, even for a different service. Your library
            has not been changed by this unfinished import.
          </p>
          {!action.discardable && (
            <p>
              Reading is in progress. You can leave and return; discard becomes available after
              reading stops.
            </p>
          )}
          <div className="upload-checkpoint__actions">
            <Button
              variant="primary"
              disabled={disabled}
              data-testid="open-batch-go"
              onClick={() => {
                if (heldCount > 0) setConfirm('leave');
                else void onResume();
              }}
            >
              {action.label}
            </Button>
            {action.discardable && (
              <Button
                variant="secondary"
                disabled={disabled}
                data-testid="open-batch-discard"
                onClick={() => setConfirm('discard')}
              >
                Discard this import...
              </Button>
            )}
            <Button variant="secondary" disabled={disabled} onClick={onRetry}>
              Refresh status
            </Button>
          </div>
        </>
      )}
      {heldCount > 0 && (
        <p role="status">
          {heldCount} {heldCount === 1 ? 'screenshot is' : 'screenshots are'} held on this device.
          Nothing has been attached to the saved upload. Leaving or reloading clears this selection.
        </p>
      )}
      {error !== null && <p role="alert">{error}</p>}
      {busy && <p role="status">Checking and saving your request...</p>}
      {confirm !== null && (
        <Dialog
          variant="overlay"
          aria-labelledby={heading}
          onDismiss={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <h2 id={heading}>
            {confirm === 'discard'
              ? 'Discard this unfinished import?'
              : 'Leave these new screenshots?'}
          </h2>
          <p>
            {confirm === 'discard'
              ? 'This discards the saved import and its review decisions, not titles in your library. Any new screenshots selected here stay on this device. Nothing starts automatically.'
              : 'The new screenshots selected on this page are not saved. Continuing to the older upload clears this selection; it does not attach them to that upload.'}
          </p>
          {error !== null && <p role="alert">{error}</p>}
          <div className="upload-checkpoint__actions">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Stay here
            </Button>
            <Button
              variant={confirm === 'discard' ? 'danger' : 'primary'}
              disabled={disabled}
              onClick={() => {
                const request = confirm === 'discard' ? onDiscard() : onResume();
                void request.finally(() => setConfirm(null));
              }}
            >
              {confirm === 'discard' ? 'Discard saved import' : 'Leave and continue'}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
