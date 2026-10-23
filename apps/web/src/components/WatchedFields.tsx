/**
 * The shared inputs and read-outs of the finished-watching feature
 * (US-074, `A66`): the 1–5 star control, the optional date, and the plain-text
 * forms of both. Kept in one place so the dialog, the edit dialog and the
 * history page cannot disagree about what "unknown" or "not rated" looks like.
 *
 * ⚠ A RATING IS NEVER SHOWN AS GLYPHS ALONE. "★ 4/5" is text a screen reader
 * reads as written and a greyscale view still carries; a row of filled and
 * hollow stars is neither.
 */

import type { JSX } from 'react';

import {
  FINISHED_DATE_LABEL,
  FINISHED_DATE_UNKNOWN_LABEL,
  FINISHED_NOT_RATED,
  FINISHED_RATING_LEGEND,
  WATCHED_DATE_UNKNOWN,
} from '../copy';
import { Field } from './ui/Field';
import { Input } from './ui/Input';

const STARS = [1, 2, 3, 4, 5] as const;

/** Today as `YYYY-MM-DD` in the owner's own calendar. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** `2026-03-04` → `4 Mar 2026`; `null` is the stated absence, never a blank. */
export function watchedDateText(date: string | null): string {
  if (date === null) return WATCHED_DATE_UNKNOWN;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

export function ratingText(rating: number | null): string {
  return rating === null ? FINISHED_NOT_RATED : `★ ${String(rating)}/5`;
}

export interface StarRatingProps {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly name: string;
  readonly disabled?: boolean;
}

export function StarRating({
  value,
  onChange,
  name,
  disabled = false,
}: StarRatingProps): JSX.Element {
  return (
    <Field legend={FINISHED_RATING_LEGEND} testId="star-rating">
      <div className="star-rating">
        {STARS.map((star) => (
          <label key={star}>
            <Input
              type="radio"
              name={name}
              value={String(star)}
              aria-label={`${String(star)} ${star === 1 ? 'star' : 'stars'}`}
              checked={value === star}
              disabled={disabled}
              onChange={() => {
                onChange(star);
              }}
            />
            <span aria-hidden="true">{`${String(star)} ★`}</span>
          </label>
        ))}
        <label>
          <Input
            type="radio"
            name={name}
            value=""
            checked={value === null}
            disabled={disabled}
            onChange={() => {
              onChange(null);
            }}
          />
          {FINISHED_NOT_RATED}
        </label>
      </div>
    </Field>
  );
}

export interface WatchedDateFieldProps {
  readonly date: string;
  readonly unknown: boolean;
  readonly onChange: (next: { date: string; unknown: boolean }) => void;
  readonly disabled?: boolean;
}

export function WatchedDateField({
  date,
  unknown,
  onChange,
  disabled = false,
}: WatchedDateFieldProps): JSX.Element {
  return (
    <div className="watched-date">
      <Field label={FINISHED_DATE_LABEL}>
        {(control) => (
          <Input
            {...control}
            type="date"
            value={date}
            max={todayIso()}
            disabled={disabled || unknown}
            onChange={(event) => {
              onChange({ date: event.target.value, unknown: false });
            }}
          />
        )}
      </Field>
      <label className="watched-date__unknown">
        <Input
          type="checkbox"
          checked={unknown}
          disabled={disabled}
          onChange={(event) => {
            onChange({ date, unknown: event.target.checked });
          }}
        />
        {FINISHED_DATE_UNKNOWN_LABEL}
      </label>
    </div>
  );
}
