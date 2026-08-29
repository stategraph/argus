import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository pull-request list caps how many it shows. The cap drops the least
 * recently updated pull requests, so a silent truncation reads as "the old ones are gone".
 * These render the page and check that a capped list says it is capped.
 */

const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'templates',
  'pulls.ejs'
);

const pull = (number: number) => ({
  number,
  title: `Pull request ${number}`,
  state: 'open',
  draft: false,
  user: { login: 'author', avatarUrl: '' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  headRef: `topic-${number}`,
  baseRef: 'main',
  sameRepo: true,
  approved: false,
  otherApprovers: [] as string[],
});

function render(over: Record<string, unknown>) {
  const data = {
    title: 'Pull Requests - orbitz/argus - Argus',
    user: { login: 'reviewer', avatar_url: '' },
    owner: 'orbitz',
    repo: 'argus',
    state: 'open',
    stacks: [],
    standalone: [pull(1)],
    shown: 1,
    truncated: false,
    maxListed: 300,
    ...over,
  };
  const html = ejs.render(readFileSync(TEMPLATE, 'utf8'), data, { filename: TEMPLATE });
  return new JSDOM(html).window.document;
}

describe('the repository pull-request list', () => {
  it('says nothing about a cap when the list is complete', () => {
    expect(render({}).querySelector('.pulls-truncated')).toBeNull();
  });

  it('says the list is capped, and how many it shows', () => {
    const doc = render({
      truncated: true,
      shown: 300,
      standalone: Array.from({ length: 3 }, (_, i) => pull(i + 1)),
    });
    const note = doc.querySelector('.pulls-truncated');
    expect(note).not.toBeNull();
    const text = note!.textContent!.replace(/\s+/g, ' ').trim();
    expect(text).toContain('300');
    expect(text).toContain('There are more');
    expect(note!.querySelector('code')!.textContent).toBe('MAX_PULLS_LISTED');
  });

  it('still lists the pull requests it did get', () => {
    const doc = render({
      truncated: true,
      shown: 2,
      standalone: [pull(1), pull(2)],
    });
    const links = [...doc.querySelectorAll('a[href^="/pr/orbitz/argus/"]')];
    expect(links).toHaveLength(2);
  });

  it('shows the empty state when the repository has no pull requests', () => {
    const doc = render({ standalone: [], shown: 0 });
    expect(doc.querySelector('.empty-state')).not.toBeNull();
    expect(doc.querySelector('.pulls-truncated')).toBeNull();
  });
});
