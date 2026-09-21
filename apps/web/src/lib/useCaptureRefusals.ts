import { useCallback, useRef, useState } from 'react';
import { ulid, type CaptureSelectionRefusal } from '@nextup/domain';

function read(key: string): { reports: readonly CaptureSelectionRefusal[]; error: string | null } {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return { reports: [], error: null };
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('Invalid saved input issues.');
    const seen = new Set<string>();
    const reports = value.map((item: unknown): CaptureSelectionRefusal => {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('token' in item) ||
        typeof item.token !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(item.token) ||
        seen.has(item.token) ||
        !('name' in item) ||
        typeof item.name !== 'string' ||
        item.name.length > 255 ||
        !('message' in item) ||
        typeof item.message !== 'string' ||
        item.message.length > 2000
      ) {
        throw new Error('Invalid saved input issue.');
      }
      seen.add(item.token);
      return { token: item.token, name: item.name, message: item.message };
    });
    return { reports, error: null };
  } catch {
    return {
      reports: [],
      error:
        'Pending input issues could not be read on this device. Discard this capture and start again rather than assuming its input is complete.',
    };
  }
}

export function useCaptureRefusals(key: string) {
  const [state, setState] = useState(() => read(key));
  const current = useRef(state);
  const unreadable = useRef(state.error);
  const persist = useCallback(
    (reports: readonly CaptureSelectionRefusal[]) => {
      let error = unreadable.current;
      if (unreadable.current === null) {
        try {
          if (reports.length === 0) sessionStorage.removeItem(key);
          else sessionStorage.setItem(key, JSON.stringify(reports));
        } catch {
          error =
            'Pending input issues could not be saved on this device. Keep this page open; discard this capture if the problem persists.';
        }
      }
      current.current = { reports, error };
      setState(current.current);
    },
    [key],
  );
  const record = useCallback(
    (files: readonly { name: string; reason: string }[]) => {
      persist([
        ...current.current.reports,
        ...files.map((file) => ({
          token: ulid(),
          name: file.name.slice(0, 255),
          message: file.reason.slice(0, 2000),
        })),
      ]);
    },
    [persist],
  );
  const saved = useCallback(
    (reports: readonly CaptureSelectionRefusal[]) => {
      const tokens = new Set(reports.map((report) => report.token));
      persist(current.current.reports.filter((report) => !tokens.has(report.token)));
    },
    [persist],
  );
  const clear = useCallback(() => {
    unreadable.current = null;
    persist([]);
  }, [persist]);
  return { ...state, record, saved, clear };
}
