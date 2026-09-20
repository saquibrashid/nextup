import { useRef, useState, type RefObject } from 'react';
import { parseCandidatePatch, type ReviewCandidate, type ReviewResponse } from '@nextup/domain';
import type { ApiClient, CandidatePatchBody } from './apiClient';
import { useCaptureLifetime } from './useCaptureLifetime';

type IntentBase = {
  id: string;
  label: string;
  baseline: string;
  state: 'unsaved' | 'unknown' | 'conflict';
};
export type ReviewIntent = IntentBase &
  (
    | {
        kind: 'candidate';
        body: CandidatePatchBody;
        identity: string | null;
        bulkSection?: 'additions' | 'unmatched';
      }
    | { kind: 'removal'; ticked: boolean }
  );

export function reviewCandidates(review: ReviewResponse): ReviewCandidate[] {
  return [
    ...review.sections.additions.items,
    ...review.sections.unmatched.items,
    ...review.sections.alreadyOnYourList.items,
    ...review.sections.probablyNotTitles.items,
    ...review.sections.unreadableTiles.items,
  ];
}

export function intentLabel(intent: ReviewIntent): string {
  if (intent.kind === 'removal')
    return intent.ticked ? 'Remove from this service' : 'Keep on this service';
  if ('reclassifyAsTitle' in intent.body) return 'Review as a title';
  if (intent.body.disposition === 'corrected')
    return `Match to ${intent.body.correctedName ?? 'the selected title'}`;
  return { confirmed: 'Keep', discarded: 'Discard', pending: 'Reopen decision' }[
    intent.body.disposition
  ];
}

function fingerprint(review: ReviewResponse, intent: Pick<ReviewIntent, 'kind' | 'id'>): string {
  if (intent.kind === 'removal') {
    const item = review.sections.removals.items.find((row) => row.listingId === intent.id);
    return item === undefined ? 'missing' : JSON.stringify(item.ticked);
  }
  const item = reviewCandidates(review).find((row) => row.candidateId === intent.id);
  return item === undefined
    ? 'missing'
    : JSON.stringify([item.disposition, item.resolvedWorkIdentity, item.verdict]);
}

function isSatisfied(review: ReviewResponse, intent: ReviewIntent): boolean {
  if (intent.kind === 'removal')
    return (
      review.sections.removals.items.find((row) => row.listingId === intent.id)?.ticked ===
      intent.ticked
    );
  const item = reviewCandidates(review).find((row) => row.candidateId === intent.id);
  if (item === undefined) return false;
  if ('reclassifyAsTitle' in intent.body) return item.verdict === 'title-candidate';
  if (intent.body.disposition === 'corrected') {
    return (
      item.disposition === 'corrected' &&
      item.resolvedWorkIdentity === `tmdb:${intent.body.mediaType}:${intent.body.tmdbId}`
    );
  }
  return (
    item.disposition === intent.body.disposition && item.resolvedWorkIdentity === intent.identity
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function patchBody(value: unknown): value is CandidatePatchBody {
  return parseCandidatePatch(value).ok;
}
function parseIntents(raw: string | null): ReviewIntent[] {
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Unrecognized local decisions.');
  return parsed.map((item: unknown): ReviewIntent => {
    if (
      !record(item) ||
      typeof item['id'] !== 'string' ||
      typeof item['label'] !== 'string' ||
      typeof item['baseline'] !== 'string' ||
      !['unsaved', 'unknown', 'conflict'].includes(String(item['state']))
    ) {
      throw new Error('Unrecognized local decision.');
    }
    const base: IntentBase = {
      id: item['id'],
      label: item['label'],
      baseline: item['baseline'],
      state:
        item['state'] === 'conflict'
          ? 'conflict'
          : item['state'] === 'unknown'
            ? 'unknown'
            : 'unsaved',
    };
    if (item['kind'] === 'removal' && typeof item['ticked'] === 'boolean')
      return { ...base, kind: 'removal', ticked: item['ticked'] };
    if (
      item['kind'] === 'candidate' &&
      patchBody(item['body']) &&
      (typeof item['identity'] === 'string' || item['identity'] === null)
    )
      return {
        ...base,
        kind: 'candidate',
        body: item['body'],
        identity: item['identity'],
        ...(item['bulkSection'] === 'additions' || item['bulkSection'] === 'unmatched'
          ? { bulkSection: item['bulkSection'] }
          : {}),
      };
    throw new Error('Unrecognized local decision.');
  });
}

export function useReviewDecisions({
  batchId,
  client,
  online,
  review,
  writing,
  closing,
  refresh,
  setSaving,
  setError,
}: {
  batchId: string;
  client: ApiClient;
  online: boolean;
  review: ReviewResponse | null;
  writing: RefObject<boolean>;
  closing: RefObject<boolean>;
  refresh: () => Promise<ReviewResponse>;
  setSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
}) {
  const key = `nextup.review.intents.${batchId}`;
  const [cache] = useState(() => {
    try {
      return { items: parseIntents(window.sessionStorage.getItem(key)), error: false };
    } catch {
      return { items: [], error: true };
    }
  });
  const [intents, setIntents] = useState<ReviewIntent[]>(cache.items);
  const [showIntents, setShowIntents] = useState(cache.items.length > 0);
  const current = useRef(intents);
  const [storageFailed, setStorageFailed] = useState(cache.error);
  const isActive = useCaptureLifetime();
  function update(next: ReviewIntent[]) {
    current.current = next;
    setIntents(next);
    if (next.length === 0) setShowIntents(false);
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      setStorageFailed(true);
    }
  }
  function remove(intent: ReviewIntent) {
    update(current.current.filter((item) => item.kind !== intent.kind || item.id !== intent.id));
  }
  function replace(intent: ReviewIntent) {
    update([
      ...current.current.filter((item) => item.kind !== intent.kind || item.id !== intent.id),
      intent,
    ]);
  }
  async function save(selected = current.current, overwrite = false): Promise<void> {
    if (!online || writing.current || closing.current)
      throw new Error('Reconnect or wait for the current action.');
    writing.current = true;
    setSaving(true);
    setError(null);
    try {
      const handled = new Set<string>();
      const ordered = [...selected].sort(
        (a, b) =>
          Number(a.kind === 'candidate' && a.bulkSection !== undefined) -
          Number(b.kind === 'candidate' && b.bulkSection !== undefined),
      );
      for (const intent of ordered) {
        if (intent.kind === 'candidate' && intent.bulkSection !== undefined) {
          const section = intent.bulkSection;
          if (handled.has(section)) continue;
          handled.add(section);
          const group = selected.filter(
            (item) => item.kind === 'candidate' && item.bulkSection === section,
          );
          const latest = await refresh();
          if (!isActive()) return;
          if (group.every((item) => isSatisfied(latest, item))) {
            for (const item of group) remove(item);
            continue;
          }
          const pending = latest.sections[section].items.filter(
            (item) => item.disposition === 'pending',
          );
          if (
            pending.length !== group.length ||
            group.some(
              (item) =>
                fingerprint(latest, item) !== item.baseline ||
                !pending.some((row) => row.candidateId === item.id),
            )
          ) {
            for (const item of group) replace({ ...item, state: 'conflict' });
            setShowIntents(true);
            continue;
          }
          for (const item of group) replace({ ...item, state: 'unknown' });
          await client.confirmAllCandidates(batchId, section);
          if (!isActive()) return;
          const verified = await refresh();
          if (!isActive()) return;
          if (!group.every((item) => isSatisfied(verified, item)))
            throw new Error('Bulk confirmation needs a saved-state check.');
          for (const item of group) remove(item);
          continue;
        }
        const latest = await refresh();
        if (!isActive()) return;
        if (isSatisfied(latest, intent)) {
          remove(intent);
          continue;
        }
        const actual = fingerprint(latest, intent);
        const identityChanged =
          intent.kind === 'candidate' &&
          reviewCandidates(latest).find((row) => row.candidateId === intent.id)
            ?.resolvedWorkIdentity !== intent.identity;
        if (actual === 'missing' || identityChanged || (!overwrite && actual !== intent.baseline)) {
          replace({ ...intent, state: 'conflict' });
          setShowIntents(true);
          if (actual === 'missing' || identityChanged) {
            setError(
              'This item changed identity or is no longer present. Use the saved decision, then review its current card.',
            );
          }
          continue;
        }
        replace({ ...intent, state: 'unknown' });
        if (intent.kind === 'candidate')
          await client.patchCandidate(batchId, intent.id, intent.body);
        else await client.setBatchRemoval(batchId, intent.id, intent.ticked);
        if (!isActive()) return;
        const verified = await refresh();
        if (!isActive()) return;
        if (!isSatisfied(verified, intent))
          throw new Error('The saved decision differs from your choice.');
        remove(intent);
      }
    } catch (error) {
      if (isActive()) setShowIntents(true);
      if (isActive())
        setError(
          'Some choices are not verified. Check the unsaved choices before applying; nothing is automatically retried.',
        );
      throw error;
    } finally {
      writing.current = false;
      if (isActive()) setSaving(false);
    }
  }
  async function candidate(id: string, body: CandidatePatchBody): Promise<void> {
    if (writing.current || closing.current) throw new Error('Wait for the current action.');
    const item =
      review === null ? undefined : reviewCandidates(review).find((row) => row.candidateId === id);
    if (review === null || item === undefined)
      throw new Error('Reload this review before deciding.');
    const previous = current.current.find((entry) => entry.kind === 'candidate' && entry.id === id);
    const intent: ReviewIntent = {
      kind: 'candidate',
      id,
      body,
      identity: item.resolvedWorkIdentity,
      label: item.match?.name ?? item.inferredTitle ?? item.rawText,
      baseline: previous?.baseline ?? fingerprint(review, { kind: 'candidate', id }),
      state: 'unsaved',
    };
    replace(intent);
    if (!online) setShowIntents(true);
    if (online) await save([intent]);
  }
  async function removal(id: string, ticked: boolean): Promise<void> {
    if (review === null || writing.current || closing.current)
      throw new Error('Wait for the review to be available.');
    const row = review.sections.removals.items.find((item) => item.listingId === id);
    if (row === undefined) throw new Error('That removal is no longer proposed.');
    const previous = current.current.find((item) => item.kind === 'removal' && item.id === id);
    const intent: ReviewIntent = {
      kind: 'removal',
      id,
      ticked,
      label: row.name,
      baseline: previous?.baseline ?? fingerprint(review, { kind: 'removal', id }),
      state: 'unsaved',
    };
    replace(intent);
    if (!online) setShowIntents(true);
    if (online) await save([intent]);
  }
  async function confirmAll(section: 'additions' | 'unmatched') {
    if (review === null || writing.current || closing.current)
      throw new Error('Wait for the review to be available.');
    const selected = review.sections[section].items.filter(
      (item) =>
        item.disposition === 'pending' &&
        !current.current.some(
          (intent) => intent.kind === 'candidate' && intent.id === item.candidateId,
        ),
    );
    const next: ReviewIntent[] = selected.map((item) => ({
      kind: 'candidate',
      id: item.candidateId,
      label: item.match?.name ?? item.rawText,
      identity: item.resolvedWorkIdentity,
      body: { disposition: 'confirmed' },
      baseline: fingerprint(review, { kind: 'candidate', id: item.candidateId }),
      state: 'unsaved',
      bulkSection: section,
    }));
    update([...current.current, ...next]);
    if (!online) setShowIntents(true);
    if (online && next.length > 0) await save(next);
  }
  return {
    intents,
    showIntents,
    storageFailed,
    save,
    candidate,
    removal,
    confirmAll,
    clear: () => update([]),
    useSaved: remove,
    useMine: (intent: ReviewIntent) =>
      save(
        [
          intent.kind === 'candidate'
            ? {
                kind: 'candidate',
                id: intent.id,
                label: intent.label,
                identity: intent.identity,
                baseline: intent.baseline,
                state: intent.state,
                body: intent.body,
              }
            : intent,
        ],
        true,
      ),
  };
}
