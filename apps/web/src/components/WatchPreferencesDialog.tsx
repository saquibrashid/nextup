import { useId, useState } from 'react';
import { WATCH_STATUSES, preferencesForStatus, watchStatus } from '@nextup/domain';
import { WATCH_PREFERENCES_FAILED, WATCH_STATUS_LABELS } from '../copy';
import {
  ApiError,
  type WatchPreferencesRequest,
  type WatchPreferencesResult,
} from '../lib/apiClient';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { Input } from './ui/Input';
import type { TitleListItem } from './TitleRow';

interface Props {
  item: TitleListItem;
  save: (titleId: string, body: WatchPreferencesRequest) => Promise<WatchPreferencesResult>;
  onClose: () => void;
  onSaved: () => void;
  offline: boolean;
}

export function WatchPreferencesDialog({ item, save, onClose, onSaved, offline }: Props) {
  const headingId = useId();
  const [status, setStatus] = useState(watchStatus(item));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function submit() {
    if (pending || offline) return;
    setPending(true);
    setFailure(null);
    try {
      await save(item.titleId, preferencesForStatus(status, item.priority));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : WATCH_PREFERENCES_FAILED);
      setPending(false);
      return;
    }
    onSaved();
  }

  return (
    <Dialog
      variant="overlay"
      aria-labelledby={headingId}
      onDismiss={() => {
        if (!pending) onClose();
      }}
    >
      <div className="watch-preferences">
        <h2 id={headingId}>Watch status</h2>
        <p>{item.name}</p>
        <Field legend="Status">
          {WATCH_STATUSES.map((value) => (
            <label key={value}>
              <Input
                type="radio"
                name={headingId}
                value={value}
                checked={status === value}
                disabled={pending}
                onChange={() => setStatus(value)}
              />
              {WATCH_STATUS_LABELS[value]}
            </label>
          ))}
        </Field>
        <p>
          Watch priority sorts Watching first, then Up next, Normal and Someday. Choosing another
          status stops Watching. Your choice stays with this title if you remove and re-add it.
        </p>
        {failure !== null && <p role="alert">{failure}</p>}
        {offline && <p role="status">Reconnect to save your preferences.</p>}
        <div className="watch-preferences__actions">
          <Button
            variant="primary"
            disabled={pending || offline}
            onClick={() => {
              void submit();
            }}
          >
            {pending ? 'Saving…' : 'Save status'}
          </Button>
          <Button disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
