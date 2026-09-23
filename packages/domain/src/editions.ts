import { z } from 'zod';
import { normaliseTitleText } from './identity.js';

export const editionLabelSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    kind: z.enum(['directors-cut', 'extended', 'uncut', 'theatrical', 'special-edition']),
  })
  .strict();

export type EditionLabel = z.infer<typeof editionLabelSchema>;

const KINDS: Readonly<Record<string, EditionLabel['kind']>> = {
  'director s cut': 'directors-cut',
  'directors cut': 'directors-cut',
  'extended cut': 'extended',
  'extended edition': 'extended',
  'extended version': 'extended',
  uncut: 'uncut',
  'theatrical cut': 'theatrical',
  'theatrical version': 'theatrical',
  'special edition': 'special-edition',
};

export const EDITION_KIND_LABELS: Readonly<Record<EditionLabel['kind'], string>> = {
  'directors-cut': "Director's cut",
  extended: 'Extended edition',
  uncut: 'Uncut',
  theatrical: 'Theatrical cut',
  'special-edition': 'Special edition',
};

export function catalogueEdition(title: unknown, type: unknown): EditionLabel | null {
  if (typeof type !== 'string') return null;
  const kind = KINDS[normaliseTitleText(type)];
  const result = editionLabelSchema.safeParse({ name: title, kind });
  return result.success ? result.data : null;
}

/** Only catalogue-typed editions with matching source text, never a guess from a base title. */
export function editionForText(
  text: string,
  baseName: string,
  editions: readonly EditionLabel[],
): EditionLabel | undefined {
  const evidence = normaliseTitleText(text);
  const base = normaliseTitleText(baseName);
  if (evidence === '' || evidence === base || ` ${base} `.includes(` ${evidence} `)) {
    return undefined;
  }
  return editions.find((edition) => {
    const name = normaliseTitleText(edition.name);
    return name === evidence || (evidence.split(' ').length >= 2 && name.endsWith(` ${evidence}`));
  });
}

export function mergeEditionLabels(
  existing: readonly EditionLabel[],
  incoming: readonly EditionLabel[],
): EditionLabel[] {
  const result: EditionLabel[] = [];
  const seen = new Set<string>();
  for (const label of [...existing, ...incoming]) {
    const key = `${label.kind}:${normaliseTitleText(label.name)}`;
    if (!seen.has(key)) {
      result.push(label);
      seen.add(key);
    }
  }
  return result;
}

export function parseEditionLabels(raw: string | null | undefined): EditionLabel[] {
  return raw == null ? [] : z.array(editionLabelSchema).parse(JSON.parse(raw));
}

export function parseEditionLabel(raw: string | null | undefined): EditionLabel | undefined {
  return raw == null ? undefined : editionLabelSchema.parse(JSON.parse(raw));
}

export function editionLabelText(edition: EditionLabel): string {
  return `${edition.name} — ${EDITION_KIND_LABELS[edition.kind]}`;
}

export function releaseYearText(year: number | null, hasEdition: boolean): string | null {
  if (year === null) return null;
  return hasEdition ? `Original film: ${year}` : String(year);
}
