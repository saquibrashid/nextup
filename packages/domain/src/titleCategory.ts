export const TITLE_CATEGORIES = ['movie', 'tv', 'comedy-show', 'documentary'] as const;
export type TitleCategory = (typeof TITLE_CATEGORIES)[number];
export const TITLE_CATEGORY_LABELS: Record<TitleCategory, string> = {
  movie: 'Movie',
  tv: 'TV Show',
  'comedy-show': 'Comedy Show',
  documentary: 'Documentary',
};

export function isTitleCategory(value: unknown): value is TitleCategory {
  return TITLE_CATEGORIES.some((category) => category === value);
}

/** Catalogue keywords describe the performance; the Comedy genre alone does not. */
export function isComedyPerformance(keywords: readonly string[]): boolean {
  return keywords.some((keyword) =>
    ['stand-up comedy', 'stand up comedy', 'stand-up special', 'live comedy'].includes(
      keyword.trim().toLowerCase(),
    ),
  );
}

/** TMDB genre 99 (movie and tv); the stored name is the English TMDB name. */
export const DOCUMENTARY_GENRE_NAME = 'Documentary';

export function isDocumentaryGenre(genres: readonly string[] | null | undefined): boolean {
  return (genres ?? []).some((genre) => genre.trim().toLowerCase() === 'documentary');
}

/**
 * Precedence: owner override, then Comedy Show (explicit performance
 * evidence), then Documentary (TMDB genre 99), then the catalogue Movie/TV
 * type. The stored media type itself is never changed.
 */
export function titleCategory(
  mediaType: string | null,
  comedyPerformance: boolean | null | undefined,
  override?: TitleCategory | null,
  genres?: readonly string[] | null,
): TitleCategory | null {
  if (override != null) return override;
  if (comedyPerformance) return 'comedy-show';
  if (isDocumentaryGenre(genres)) return 'documentary';
  return isTitleCategory(mediaType) && (mediaType === 'movie' || mediaType === 'tv')
    ? mediaType
    : null;
}

export function parseCategoryOverride(
  body: unknown,
): { categoryOverride: TitleCategory | null } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'categoryOverride')) return null;
  const value = record['categoryOverride'];
  return value === null || isTitleCategory(value) ? { categoryOverride: value } : null;
}
