import { createContext } from 'react';

/**
 * The signed-in owner's display name from `GET /api/me`, provided by
 * `OwnerGate` once the identity is proven. `null` when the platform supplied
 * none — the phone header then shows no avatar rather than an invented one.
 */
export const OwnerNameContext = createContext<string | null>(null);

/** The avatar's initial: the first letter of the display name, upper-cased. */
export function ownerInitial(displayName: string | null): string | null {
  const first = displayName?.trim().charAt(0);
  return first ? first.toLocaleUpperCase() : null;
}
