import { z } from 'zod';

/**
 * #391 — a YouTube video id. Pinned to YouTube's id alphabet because the SPA
 * builds a `youtube.com` URL from it: anything else could smuggle a path or a
 * query into the link.
 */
export const YOUTUBE_VIDEO_KEY = /^[A-Za-z0-9_-]{6,20}$/;

export const titleTrailerSchema = z
  .object({
    key: z.string().regex(YOUTUBE_VIDEO_KEY),
    name: z.string().min(1),
    kind: z.enum(['Trailer', 'Teaser']),
    publishedAt: z.string().datetime().nullable(),
  })
  .strict();

export type TitleTrailer = z.infer<typeof titleTrailerSchema>;

// Deliberately separate from matching metadata: this prose is display-only.
//
// ⚠ #391's fields are OPTIONAL so a copy cached before them still parses. A
// cached copy WITHOUT `trailer` predates #391 and is refetched on access
// (`readTitlePresentation`), so the extra details arrive on the next view
// rather than after the 183-day refresh.
export const titlePresentationSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    mediaType: z.enum(['movie', 'tv']),
    overview: z.string().nullable(),
    cast: z.array(z.object({ name: z.string().min(1), character: z.string().nullable() }).strict()),
    directors: z.array(z.string().min(1)),
    creators: z.array(z.string().min(1)),
    tagline: z.string().min(1).nullable().optional(),
    writers: z.array(z.string().min(1)).optional(),
    /** Movie release or series first-air date, `YYYY-MM-DD`. */
    releaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    /** TMDB's production status: `Released`, `Returning Series`, `Ended`… */
    status: z.string().min(1).nullable().optional(),
    /** The US rating (`PG-13`, `TV-MA`), or `null` when none is published. */
    certification: z.string().min(1).nullable().optional(),
    seasons: z.number().int().nonnegative().nullable().optional(),
    episodes: z.number().int().nonnegative().nullable().optional(),
    /** The most current official YouTube trailer, or `null` for none. */
    trailer: titleTrailerSchema.nullable().optional(),
    fetchedAt: z.string().datetime(),
  })
  .strict();

export type TitlePresentation = z.infer<typeof titlePresentationSchema>;

interface TmdbVideo {
  key: string;
  name: string;
  kind: 'Trailer' | 'Teaser';
  official: boolean;
  publishedAt: string | null;
}

/**
 * #391 — the most current trailer from TMDB's `videos.results`, or `null`.
 *
 * YouTube only (the link is built for it); a Trailer before a Teaser, an
 * official video before a fan upload, then the latest `published_at`. A
 * malformed entry is skipped, never thrown — a bad video must not cost the
 * owner the synopsis and cast beside it.
 */
export function pickTrailer(results: unknown): TitleTrailer | null {
  if (!Array.isArray(results)) return null;
  const videos: TmdbVideo[] = results.flatMap((entry: unknown): TmdbVideo[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const video = entry as Record<string, unknown>;
    const { key, name, type, site, official } = video;
    const published = video['published_at'];
    if (site !== 'YouTube' || (type !== 'Trailer' && type !== 'Teaser')) return [];
    if (typeof key !== 'string' || !YOUTUBE_VIDEO_KEY.test(key)) return [];
    const at = typeof published === 'string' ? new Date(published) : null;
    return [
      {
        key,
        name: typeof name === 'string' && name.trim() !== '' ? name.trim() : type,
        kind: type,
        official: official === true,
        publishedAt: at === null || Number.isNaN(at.getTime()) ? null : at.toISOString(),
      },
    ];
  });
  const rank = (video: TmdbVideo): [number, number, string] => [
    video.kind === 'Trailer' ? 0 : 1,
    video.official ? 0 : 1,
    video.publishedAt ?? '',
  ];
  videos.sort((a, b) => {
    const [kindA, officialA, atA] = rank(a);
    const [kindB, officialB, atB] = rank(b);
    return kindA - kindB || officialA - officialB || (atB > atA ? 1 : atB < atA ? -1 : 0);
  });
  const best = videos[0];
  if (best === undefined) return null;
  return { key: best.key, name: best.name, kind: best.kind, publishedAt: best.publishedAt };
}

/** #391 — the watch URL for a trailer key. The only place it is built. */
export function trailerUrl(trailer: Pick<TitleTrailer, 'key'>): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`;
}
export interface TitlePresentationResult {
  status: 'available' | 'stale' | 'unavailable' | 'unidentified';
  data: TitlePresentation | null;
}
