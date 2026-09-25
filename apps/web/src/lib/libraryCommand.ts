import { createContext, type RefObject } from 'react';

/**
 * TASK-255 — the phone tab bar's Search and Filters tabs act ON the library.
 *
 * ⚠ A REQUEST, NOT STATE THE LIBRARY MIRRORS. The tab bar lives in the shell,
 * the search field and the filters sheet live in the page; the shell records
 * one pending request (with a sequence number, so tapping the same tab twice
 * is two requests) and the page's control consumes it. The URL stays the only
 * source of truth for what is filtered or searched.
 */
export type LibraryCommandKind = 'search' | 'filters';

export interface LibraryCommand {
  readonly kind: LibraryCommandKind;
  readonly seq: number;
}

export interface LibraryCommandChannel {
  readonly command: LibraryCommand | null;
  readonly consume: (seq: number) => void;
  /** The tabs that asked, so focus can go back to them when the control closes. */
  readonly tabs: Readonly<Record<LibraryCommandKind, RefObject<HTMLButtonElement | null>>>;
}

export const LibraryCommandContext = createContext<LibraryCommandChannel>({
  command: null,
  consume: () => undefined,
  tabs: { search: { current: null }, filters: { current: null } },
});
