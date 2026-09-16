import { useId, useState } from 'react';
import { WATCH_PRIORITIES, type WatchPriority } from '@nextup/domain';
import { WATCH_PREFERENCES_FAILED, WATCH_PRIORITY_LABELS } from '../copy';
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
  const [watching, setWatching] = useState(item.watching ?? false);
  const [priority, setPriority] = useState<WatchPriority>(item.priority ?? 'normal');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function submit() {
    if (pending || offline) return;
    setPending(true);
    setFailure(null);
    try {
      await save(item.titleId, { watching, priority });
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : WATCH_PREFERENCES_FAILED);
      setPending(false);
      return;
    }
    onSaved();
  }

  return (
    <Dialog
      aria-labelledby={headingId}
      onDismiss={() => {
        if (!pending) onClose();
      }}
    >
      <div className="watch-preferences">
        <h2 id={headingId}>Watch preferences</h2>
        <p>{item.name}</p>
        <Field legend="Watching">
          <label>
            <Input
              type="checkbox"
              checked={watching}
              disabled={pending}
              onChange={(event) => setWatching(event.target.checked)}
            />
            Currently watching
          </label>
        </Field>
        <Field legend="Priority">
          {WATCH_PRIORITIES.map((value) => (
            <label key={value}>
              <Input
                type="radio"
                name={headingId}
                value={value}
                checked={priority === value}
                disabled={pending}
                onChange={() => setPriority(value)}
              />
              {WATCH_PRIORITY_LABELS[value]}
            </label>
          ))}
        </Field>
        <p>
          Watch priority sorts Watching first, then Up next, Normal and Someday. Your choices stay
          with this title if you remove and re-add it.
        </p>
        {failure !== null && <p role="alert">{failure}</p>}
        {offline && <p role="status">Reconnect to save your preferences.</p>}
        <Button
          variant="primary"
          disabled={pending || offline}
          onClick={() => {
            void submit();
          }}
        >
          {pending ? 'Saving…' : 'Save preferences'}
        </Button>
        <Button disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
