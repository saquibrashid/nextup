import { z } from 'zod';

// Deliberately separate from matching metadata: this prose is display-only.
export const titlePresentationSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    mediaType: z.enum(['movie', 'tv']),
    overview: z.string().nullable(),
    cast: z.array(z.object({ name: z.string().min(1), character: z.string().nullable() }).strict()),
    directors: z.array(z.string().min(1)),
    creators: z.array(z.string().min(1)),
    fetchedAt: z.string().datetime(),
  })
  .strict();

export type TitlePresentation = z.infer<typeof titlePresentationSchema>;
export interface TitlePresentationResult {
  status: 'available' | 'stale' | 'unavailable' | 'unidentified';
  data: TitlePresentation | null;
}
