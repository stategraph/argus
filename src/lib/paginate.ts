/**
 * Reading a capped prefix of a paginated GitHub list.
 *
 * A list route that fetches exactly one page can never show more than that page holds,
 * however many items the resource has — and because GitHub's lists are ordered newest
 * first, what it silently drops is always the oldest. That is invisible from the page:
 * a truncated list looks the same as a complete one. This helper reads pages until a cap
 * is reached and reports whether anything was left behind, so the page can say so.
 */

/** The part of an Octokit response this reads. */
export interface PageLike<T> {
  data: T[];
  headers: { link?: string };
}

export interface CappedPages<T> {
  items: T[];
  /** True when the resource holds items past the cap. */
  truncated: boolean;
}

/**
 * Collect at most `max` items from a page iterator.
 *
 * Whether more remain is the Link header's answer, not an inference from a full last
 * page: a page holding exactly `per_page` items can still be the final one.
 *
 * @param pages Page iterator, e.g. `octokit.paginate.iterator(octokit.pulls.list, {...})`.
 * @param max   Largest number of items to return. Below 1 is treated as 1.
 */
export async function collectCapped<T>(
  pages: AsyncIterable<PageLike<T>>,
  max: number
): Promise<CappedPages<T>> {
  const cap = Math.max(1, Math.floor(max));
  const items: T[] = [];
  let truncated = false;

  for await (const page of pages) {
    items.push(...page.data);
    if (items.length >= cap) {
      const link = page.headers.link;
      truncated = typeof link === 'string' && link.includes('rel="next"');
      break;
    }
  }

  // A page can carry the cap past its boundary. The overflow is itself proof of more.
  if (items.length > cap) {
    items.length = cap;
    truncated = true;
  }

  return { items, truncated };
}
