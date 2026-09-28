/**
 * Text normalisation and tokenisation for deduplication.
 *
 * **Pure.** No I/O, no clock, no randomness, no configuration. Every function here is a total
 * function of its arguments, which is what lets `cluster.test.ts` assert exact similarity
 * values rather than ranges. If you are tempted to read an environment variable in this file,
 * the thing you want belongs in `cluster.ts` instead.
 */

/**
 * Words that carry no discriminating signal in a news headline.
 *
 * Deliberately small. An aggressive stoplist is the classic way to destroy the signal you
 * actually need: drop "us" and you lose "US", drop "may" and you lose the month and the
 * surname. Everything here is a function word that appears in roughly every headline, so its
 * IDF weight would be near zero anyway — removing it is an optimisation, not the mechanism.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had", "has",
  "have", "he", "her", "his", "in", "into", "is", "it", "its", "of", "on", "or", "our", "out",
  "over", "said", "says", "she", "that", "the", "their", "them", "they", "this", "to", "was",
  "were", "will", "with",
]);

/**
 * Publisher attribution that feeds append to titles — " - Reuters", " | BBC News", " — AP".
 *
 * Stripped before comparison because it is the one piece of the title guaranteed to *differ*
 * between two reports of the same story. Leaving it in would penalise exactly the pairs we
 * are trying to find.
 */
const PUBLISHER_SUFFIX = /\s+[-–—|]\s+[^-–—|]{2,40}$/u;

export function stripPublisherSuffix(title: string): string {
  const stripped = title.replace(PUBLISHER_SUFFIX, "");
  // Never strip the whole title: a headline that is itself short and hyphenated would
  // otherwise normalise to the empty string and match everything.
  return stripped.trim().length >= 12 ? stripped : title;
}

/**
 * Lowercase, strip diacritics, reduce everything that is not a letter or digit to a space.
 *
 * NFKD then removing the combining range folds "Erdoğan" and "Erdogan" together, which
 * publishers genuinely disagree about.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/**
 * Plural folding, and nothing else. Not Porter — deliberately.
 *
 * The job is to make "rates" and "rate" the same token. Anything more aggressive costs more
 * than it earns: an earlier version of this function also stripped `-ing`, which folded
 * "moving" to "mov", and stripped `-es` unconditionally, which folded "rates" to "rat" while
 * leaving "rate" alone — so the two forms it was supposed to unify ended up *further* apart,
 * and "rat" collided with the animal. Both bugs were found by measuring real feed text
 * (`pnpm --filter web calibrate`), not by reading the code.
 *
 * The `-es` rule is therefore restricted to the contexts where `es` is genuinely the plural
 * marker — after s, x, z, ch, sh — and everything else falls through to plain `-s`.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh)es$/u.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * The comparison vocabulary of one document: stemmed, stopword-free, deduplicated.
 *
 * A **set**, not a bag. Repetition within one article says something about that article's
 * style, not about whether it describes the same event as another article.
 */
export function contentTokens(input: string): Set<string> {
  const out = new Set<string>();
  for (const token of tokenize(input)) {
    if (STOPWORDS.has(token)) continue;
    // Single characters survive tokenisation of things like "U.S." and carry no signal.
    if (token.length < 2) continue;
    out.add(stem(token));
  }
  return out;
}

/**
 * The vocabulary a story is compared on: **the headline, and nothing else.**
 *
 * This is the opposite of what the design started with, and the change was forced by
 * measurement (`pnpm --filter web calibrate`, 228 articles from 70 publishers). Adding the RSS
 * summary makes discrimination *worse*, consistently and in both directions:
 *
 * | Pair                                   | title | title+summary | truth     |
 * |----------------------------------------|-------|---------------|-----------|
 * | ECB raises rates — AP vs NYT           | 0.438 | 0.420         | same      |
 * | Fed raises rates — ABC News vs ABC13   | 0.424 | 0.382         | same      |
 * | Najaf flights — Reuters vs Al Jazeera  | 0.357 | 0.211         | same      |
 * | Taiwan CB holds vs ECB hikes           | 0.370 | **0.411**     | different |
 *
 * True pairs move *down* when the summary is included and the false pair moves *up* — the
 * ranking actually inverts on the last two rows. The reason is that summaries are mostly
 * shared boilerplate: standfirsts, publisher furniture, stock phrasing about central banks and
 * inflation. That vocabulary is common to the whole finance corpus, so it adds tokens that two
 * unrelated finance stories share while diluting the rare entity names that distinguish them.
 *
 * A headline is written to be discriminating in twelve words. That is exactly the signal we
 * want, and it is the one field every source supplies — Google News and GDELT items often
 * carry no usable summary at all, so a measure that depended on one would score inconsistently
 * across sources.
 */
export function comparableTokens(title: string): Set<string> {
  return contentTokens(stripPublisherSuffix(title));
}
