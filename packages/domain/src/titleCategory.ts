export const TITLE_CATEGORIES = ['movie', 'tv', 'comedy-show'] as const;
export type TitleCategory = (typeof TITLE_CATEGORIES)[number];
export const TITLE_CATEGORY_LABELS: Record<TitleCategory, string> = {
  movie: 'Movie',
  tv: 'TV Show',
  'comedy-show': 'Comedy Show',
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

export function titleCategory(
  mediaType: string | null,
  comedyPerformance: boolean | null | undefined,
  override?: TitleCategory | null,
): TitleCategory | null {
  return (
    override ?? (comedyPerformance ? 'comedy-show' : isTitleCategory(mediaType) ? mediaType : null)
  );
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
