import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Input } from './ui/Input';
import { CloseIcon, SearchIcon } from './icons';
import {
  LIST_SEARCH_PLACEHOLDER,
  LIST_SEARCH_SHORTCUT_APPLE,
  LIST_SEARCH_SHORTCUT_OTHER,
} from '../copy';

/** Ctrl+K / Cmd+K, never while a modal owns the keyboard (#370). */
function isSearchShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k' &&
    document.querySelector('[aria-modal]') === null
  );
}

function appleKeyboard(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function ListSearch(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [expanded, setExpanded] = useState(q !== '');
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const focusInput = useRef(false);

  useEffect(() => {
    if (q !== '') setExpanded(true);
  }, [q]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || !isSearchShortcut(event)) return;
      event.preventDefault();
      focusInput.current = true;
      setExpanded(true);
      input.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (expanded && focusInput.current) {
      input.current?.focus();
      focusInput.current = false;
    }
  }, [expanded, q]);

  function close(): void {
    focusInput.current = false;
    if (input.current) input.current.value = q;
    setExpanded(false);
    trigger.current?.focus();
    if (document.activeElement !== trigger.current) input.current?.focus();
  }

  function applySearch(value: string): void {
    const next = new URLSearchParams(params);
    const trimmed = value.trim();
    focusInput.current = trimmed !== q;
    if (!focusInput.current) input.current?.focus();
    if (trimmed) next.set('q', trimmed);
    else next.delete('q');
    next.delete('cursor');
    setParams(next);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    if (typeof value === 'string') {
      applySearch(value);
    }
  }

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        data-testid="list-search-trigger"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          if (expanded) close();
          else {
            focusInput.current = true;
            setExpanded(true);
          }
        }}
      >
        <SearchIcon />
        {q !== '' ? 'Search active' : 'Search'}
      </Button>
      <form
        hidden={!expanded}
        id={panelId}
        role="search"
        aria-label="Search your library"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <Field label="Search your library">
          {(props) => (
            <span className="list-search__control">
              <Button type="submit" variant="ghost" aria-label="Search">
                <SearchIcon />
              </Button>
              <Input
                {...props}
                ref={input}
                key={q}
                type="search"
                name="q"
                defaultValue={q}
                maxLength={500}
                placeholder={LIST_SEARCH_PLACEHOLDER}
                aria-keyshortcuts="Control+K Meta+K"
              />
              <span
                className="list-search__shortcut"
                aria-hidden="true"
                data-testid="list-search-shortcut"
              >
                {(appleKeyboard() ? LIST_SEARCH_SHORTCUT_APPLE : LIST_SEARCH_SHORTCUT_OTHER).map(
                  (key) => (
                    <kbd key={key}>{key}</kbd>
                  ),
                )}
              </span>
            </span>
          )}
        </Field>
        {params.has('q') && (
          <Button
            variant="ghost"
            onClick={() => {
              applySearch('');
            }}
          >
            Clear search
          </Button>
        )}
        <Button variant="ghost" aria-label="Close search" onClick={close}>
          <CloseIcon />
        </Button>
      </form>
    </>
  );
}
