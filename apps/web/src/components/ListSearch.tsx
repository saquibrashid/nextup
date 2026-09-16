import { type FormEvent, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Input } from './ui/Input';

export function ListSearch(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';

  function applySearch(value: string): void {
    const next = new URLSearchParams(params);
    const trimmed = value.trim();
    if (trimmed) next.set('q', trimmed);
    else next.delete('q');
    next.delete('cursor');
    setParams(next);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    if (typeof value === 'string') applySearch(value);
  }

  return (
    <form role="search" aria-label="Search your list" onSubmit={submit}>
      <Field label="Search your list">
        {(props) => (
          <Input
            {...props}
            key={q}
            type="search"
            name="q"
            defaultValue={q}
            maxLength={500}
            placeholder="Find something to watch"
          />
        )}
      </Field>
      <Button type="submit">Search</Button>
      {params.has('q') && (
        <Button variant="ghost" onClick={() => applySearch('')}>
          Clear search
        </Button>
      )}
    </form>
  );
}
