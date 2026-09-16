/** Owner choices, independent of service membership and extraction metadata. */
export const WATCH_PRIORITIES = ['up-next', 'normal', 'someday'] as const;
export type WatchPriority = (typeof WATCH_PRIORITIES)[number];

export interface WatchPreferences {
  watching: boolean;
  priority: WatchPriority;
}

export type WatchPreferencesPatch = Partial<WatchPreferences>;

export function isWatchPriority(value: unknown): value is WatchPriority {
  return WATCH_PRIORITIES.some((priority) => priority === value);
}

export function watchPriorityRank({ watching, priority }: WatchPreferences): number {
  return watching ? 0 : WATCH_PRIORITIES.indexOf(priority) + 1;
}

export function parseWatchPreferencesPatch(
  body: unknown,
): { ok: true; value: WatchPreferencesPatch } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'Watch preferences must be an object.' };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some((key) => key !== 'watching' && key !== 'priority')) {
    return { ok: false, message: 'Supply watching and/or priority, with no other fields.' };
  }
  if ('watching' in record && typeof record['watching'] !== 'boolean') {
    return { ok: false, message: '"watching" must be a boolean.' };
  }
  if ('priority' in record && !isWatchPriority(record['priority'])) {
    return { ok: false, message: '"priority" must be up-next, normal, or someday.' };
  }
  return {
    ok: true,
    value: {
      ...(typeof record['watching'] === 'boolean' ? { watching: record['watching'] } : {}),
      ...(isWatchPriority(record['priority']) ? { priority: record['priority'] } : {}),
    },
  };
}
