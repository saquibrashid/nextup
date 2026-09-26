import {
  titlePresentationSchema,
  type TitlePresentation,
  type TitlePresentationResult,
} from '@nextup/domain';
import { TmdbClient } from '../clients/tmdbClient.js';
import { updateTitlePresentation, type OwnerId } from '../repository/ownerData.js';
import { isMetadataStale } from './tmdbRefresh.js';

interface PresentationRow {
  id: string;
  matchState: string;
  tmdbId: number | null;
  tmdbMediaType: string | null;
  tmdbPresentation: string | null;
}

interface PresentationDeps {
  client?: Pick<TmdbClient, 'getPresentation'>;
  now?: () => Date;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export async function readTitlePresentation(
  ownerId: OwnerId,
  row: PresentationRow,
  deps: PresentationDeps = {},
): Promise<TitlePresentationResult> {
  if (
    row.matchState !== 'matched' ||
    row.tmdbId === null ||
    (row.tmdbMediaType !== 'movie' && row.tmdbMediaType !== 'tv')
  ) {
    return { status: 'unidentified', data: null };
  }
  const log =
    deps.log ??
    ((event, fields): void => {
      console.warn(event, fields);
    });
  const now = deps.now?.() ?? new Date();
  let cached: TitlePresentation | null = null;
  if (row.tmdbPresentation !== null) {
    try {
      const parsed = titlePresentationSchema.parse(JSON.parse(row.tmdbPresentation));
      if (parsed.tmdbId === row.tmdbId && parsed.mediaType === row.tmdbMediaType) cached = parsed;
    } catch {
      log('tmdb.presentation_invalid_cache', { titleId: row.id });
    }
  }
  // #391 — a copy cached before the trailer and extra details existed has no
  // `trailer` key at all (`null` means "TMDB has none"). It is refetched once,
  // on access, so the new details appear on the next view.
  const current = cached !== null && cached.trailer !== undefined;
  if (cached !== null && current && !isMetadataStale(new Date(cached.fetchedAt), now)) {
    return { status: 'available', data: cached };
  }
  try {
    const client = deps.client ?? new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' });
    const data = titlePresentationSchema.parse({
      ...(await client.getPresentation(row.tmdbMediaType, row.tmdbId)),
      fetchedAt: now.toISOString(),
    });
    const result = await updateTitlePresentation(ownerId, row.id, data);
    if (result.count !== 1) {
      log('tmdb.presentation_identity_changed', { titleId: row.id });
      return { status: 'unavailable', data: null };
    }
    return { status: 'available', data };
  } catch {
    // Never log provider prose, URLs or caught errors which could contain a key.
    log('tmdb.presentation_refresh_failed', { titleId: row.id });
    return { status: cached === null ? 'unavailable' : 'stale', data: cached };
  }
}
