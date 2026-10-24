// #467/#470 — a title the data supplies in ALL CAPS reads as shouting on a card
// and breaks mid-word at 280 px, so a multi-word all-caps name is shown in
// title case. Display only: the stored name, links and accessible names that
// quote the work are untouched, and a mixed-case name is never altered.

const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'vs',
]);

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseWord(word: string, first: boolean): string {
  // Initialisms (no vowel, or dotted) stay as they are: WWE, DC, U.S.
  if (!/[AEIOU]/.test(word) || word.includes('.')) return word;
  if (!first && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
  return word.split('-').map(capitalise).join('-');
}

export function displayTitle(name: string): string {
  const shouting = name === name.toUpperCase() && name !== name.toLowerCase();
  if (!shouting) return name;
  const words = name.split(/(\s+)/);
  if (words.filter((word) => word.trim() !== '').length < 2) return name;
  let seen = 0;
  return words
    .map((part) => {
      if (part.trim() === '') return part;
      const rendered = titleCaseWord(part, seen === 0);
      seen += 1;
      return rendered;
    })
    .join('');
}
