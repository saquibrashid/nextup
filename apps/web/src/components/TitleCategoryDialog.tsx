import { useId, useState } from 'react';
import { TITLE_CATEGORIES, TITLE_CATEGORY_LABELS, type TitleCategory } from '@nextup/domain';
import { ApiError, type ApiClient } from '../lib/apiClient';
import type { TitleListItem } from './TitleRow';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { Input } from './ui/Input';

export function TitleCategoryDialog({
  item,
  save,
  offline,
  onClose,
  onSaved,
}: {
  item: TitleListItem;
  save: ApiClient['updateTitleCategory'];
  offline: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const heading = useId();
  const [category, setCategory] = useState<TitleCategory | null>(item.categoryOverride ?? null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function submit() {
    if (offline || pending) return;
    setPending(true);
    setFailure(null);
    try {
      await save(item.titleId, { categoryOverride: category });
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error.message
          : 'Could not save the category. Your title is unchanged.',
      );
      setPending(false);
      return;
    }
    onSaved();
  }
  return (
    <Dialog
      variant="overlay"
      aria-labelledby={heading}
      onDismiss={() => {
        if (!pending) onClose();
      }}
    >
      <div className="watch-preferences">
        <h2 id={heading}>Title category</h2>
        <p>{item.name}</p>
        <Field legend="Category">
          <label>
            <Input
              type="radio"
              name={heading}
              checked={category === null}
              disabled={pending}
              onChange={() => setCategory(null)}
            />
            Automatic
            {item.automaticCategory ? ` (${TITLE_CATEGORY_LABELS[item.automaticCategory]})` : ''}
          </label>
          {TITLE_CATEGORIES.map((value) => (
            <label key={value}>
              <Input
                type="radio"
                name={heading}
                checked={category === value}
                disabled={pending}
                onChange={() => setCategory(value)}
              />
              {TITLE_CATEGORY_LABELS[value]}
            </label>
          ))}
        </Field>
        <p>
          Comedy Show means stand-up specials and live comedy performances, not every comedy movie
          or series. Your override stays with this title if you remove and re-add it.
        </p>
        {item.categoryPending && (
          <p role="status">
            Catalogue classification is not available yet. You can choose a category yourself.
          </p>
        )}
        {failure && <p role="alert">{failure}</p>}
        {offline && <p role="status">Reconnect to save the category.</p>}
        <div className="watch-preferences__actions">
          <Button
            variant="primary"
            disabled={pending || offline}
            onClick={() => {
              void submit();
            }}
          >
            {pending ? 'Saving...' : 'Save category'}
          </Button>
          <Button disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
