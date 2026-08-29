import { describe, it, expect } from 'vitest';
import { collectCapped, type PageLike } from '../src/lib/paginate.js';

const NEXT = { link: '<https://api.github.com/x?page=2>; rel="next"' };
const LAST = {};

/** A page iterator that records how many pages the caller actually asked for. */
function pager<T>(pages: PageLike<T>[]) {
  const read: number[] = [];
  const iterable = {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < pages.length; i++) {
        read.push(i + 1);
        yield pages[i];
      }
    },
  };
  return { iterable, read };
}

const numbers = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + i);

describe('collectCapped', () => {
  it('returns every item when the resource is smaller than the cap', async () => {
    const { iterable } = pager([{ data: numbers(1, 3), headers: LAST }]);
    const result = await collectCapped(iterable, 300);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
  });

  it('joins several pages together', async () => {
    const { iterable } = pager([
      { data: numbers(1, 100), headers: NEXT },
      { data: numbers(101, 100), headers: NEXT },
      { data: numbers(201, 50), headers: LAST },
    ]);
    const result = await collectCapped(iterable, 300);
    expect(result.items).toHaveLength(250);
    expect(result.items[0]).toBe(1);
    expect(result.items[249]).toBe(250);
    expect(result.truncated).toBe(false);
  });

  it('stops reading pages once the cap is full', async () => {
    const { iterable, read } = pager([
      { data: numbers(1, 100), headers: NEXT },
      { data: numbers(101, 100), headers: NEXT },
      { data: numbers(201, 100), headers: NEXT },
      { data: numbers(301, 100), headers: NEXT },
    ]);
    const result = await collectCapped(iterable, 300);
    expect(result.items).toHaveLength(300);
    // The fourth page is never requested.
    expect(read).toEqual([1, 2, 3]);
  });

  it('reports truncation when the cap lands exactly on a page boundary', async () => {
    // The count alone cannot tell: only the Link header knows a page 4 exists.
    const { iterable } = pager([
      { data: numbers(1, 100), headers: NEXT },
      { data: numbers(101, 100), headers: NEXT },
      { data: numbers(201, 100), headers: NEXT },
    ]);
    expect((await collectCapped(iterable, 300)).truncated).toBe(true);
  });

  it('reports no truncation when a full last page happens to fill the cap', async () => {
    const { iterable } = pager([
      { data: numbers(1, 100), headers: NEXT },
      { data: numbers(101, 100), headers: NEXT },
      { data: numbers(201, 100), headers: LAST },
    ]);
    const result = await collectCapped(iterable, 300);
    expect(result.items).toHaveLength(300);
    expect(result.truncated).toBe(false);
  });

  it('trims a page that carries the cap past its boundary, and calls that truncated', async () => {
    const { iterable } = pager([
      { data: numbers(1, 100), headers: NEXT },
      { data: numbers(101, 100), headers: LAST },
    ]);
    const result = await collectCapped(iterable, 150);
    expect(result.items).toHaveLength(150);
    expect(result.items[149]).toBe(150);
    // The 50 items dropped from this page are themselves proof that more exist.
    expect(result.truncated).toBe(true);
  });

  it('returns nothing for a resource with no items', async () => {
    const { iterable } = pager<number>([{ data: [], headers: LAST }]);
    const result = await collectCapped(iterable, 300);
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('reads at least one item however low the cap is set', async () => {
    const { iterable } = pager([{ data: numbers(1, 100), headers: NEXT }]);
    const result = await collectCapped(iterable, 0);
    expect(result.items).toEqual([1]);
    expect(result.truncated).toBe(true);
  });
});
