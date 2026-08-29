import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The list filter runs in the browser over the list the server already rendered, so these
 * load the real pulls.ejs output and the real pulls.js into a DOM. Rendering the template
 * rather than hand-writing the markup is deliberate: the filter reads `data-number` and
 * `data-title` off the rows, and a test with its own markup would not notice the template
 * dropping them.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, '..', 'src', 'templates', 'pulls.ejs');
const PULLS_JS = readFileSync(join(__dirname, '..', 'public', 'js', 'pulls.js'), 'utf8');

const DEBOUNCE_MS = 100;

const pull = (number: number, title: string) => ({
  number,
  title,
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

const stackOf = (base: string, pulls: ReturnType<typeof pull>[]) => ({
  base,
  nodes: pulls.map((pr, i) => ({
    pr,
    cells: ['node'],
    isRoot: i === 0,
    isTip: i === pulls.length - 1,
  })),
});

/**
 * A hand-driven clock. vi's fake timers replace Node's globals, but the script runs
 * inside the JSDOM window and calls that window's setTimeout, so the debounce is only
 * controllable by replacing it here.
 */
function installClock(win: any) {
  let seq = 0;
  let now = 0;
  const pending = new Map<number, { fn: () => void; at: number }>();

  win.setTimeout = (fn: () => void, ms: number) => {
    const id = ++seq;
    pending.set(id, { fn, at: now + (ms || 0) });
    return id;
  };
  win.clearTimeout = (id: number) => {
    pending.delete(id);
  };

  return {
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

function load(options: { stacks?: unknown[]; standalone?: ReturnType<typeof pull>[] } = {}) {
  const data = {
    title: 'Pull Requests - orbitz/argus - Argus',
    user: { login: 'reviewer', avatar_url: '' },
    owner: 'orbitz',
    repo: 'argus',
    state: 'open',
    stacks: options.stacks ?? [],
    standalone: options.standalone ?? [],
    shown: (options.standalone ?? []).length,
    truncated: false,
    maxListed: 300,
  };

  const html = ejs.render(readFileSync(TEMPLATE, 'utf8'), data, { filename: TEMPLATE });
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/repos/orbitz/argus/pulls',
    runScripts: 'outside-only',
  });
  const win = dom.window as any;
  const clock = installClock(win);

  const errors: unknown[] = [];
  win.addEventListener('error', (e: any) => errors.push(e.error ?? e.message));
  win.eval(PULLS_JS);

  const doc = win.document;
  const input = doc.getElementById('pulls-search-input') as HTMLInputElement;

  /** Type a query and let the debounce elapse. */
  function search(text: string) {
    input.value = text;
    input.dispatchEvent(new win.Event('input'));
    clock.advance(DEBOUNCE_MS);
  }

  /** The numbers of the pull requests currently on screen, in document order. */
  function visible(): number[] {
    return [...doc.querySelectorAll('.js-pull-entry')]
      .filter((el: any) => !el.hidden)
      .map((el: any) => Number(el.getAttribute('data-number')));
  }

  return { win, doc, input, clock, errors, search, visible };
}

const SAMPLE = [
  pull(42, 'FIX Stop the login crash'),
  pull(43, 'ADD Issues view to PR'),
  pull(144, 'FIX Login redirect loop'),
  pull(7, 'Tidy the readme'),
];

describe('pulls.js list filter', () => {
  it('loads without throwing and reveals the search box', () => {
    const { doc, errors } = load({ standalone: SAMPLE });
    expect(errors).toEqual([]);
    expect((doc.getElementById('pulls-search') as any).hidden).toBe(false);
  });

  it('shows every pull request before anything is typed', () => {
    const { visible, doc } = load({ standalone: SAMPLE });
    expect(visible()).toEqual([42, 43, 144, 7]);
    expect(doc.getElementById('pulls-search-count')!.textContent).toBe('');
  });

  describe('matching', () => {
    it('matches a word in the title', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      search('login');
      expect(visible()).toEqual([42, 144]);
    });

    it('ignores letter case', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      search('LOGIN');
      expect(visible()).toEqual([42, 144]);
    });

    it('matches a partly typed word', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      search('log');
      expect(visible()).toEqual([42, 144]);
    });

    it('matches the pull request number', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      search('42');
      expect(visible()).toEqual([42]);
    });

    it('matches a number written with a leading hash', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      search('#43');
      expect(visible()).toEqual([43]);
    });

    it('requires every term, not any of them', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      // Both titles hold "fix"; only one of them also holds "redirect".
      search('fix login');
      expect(visible()).toEqual([42, 144]);
      search('fix redirect');
      expect(visible()).toEqual([144]);
    });

    it('searches each term across both the number and the title', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      // "144" matches only by number, "login" only by title. Both must hold.
      search('144 login');
      expect(visible()).toEqual([144]);
      search('144 readme');
      expect(visible()).toEqual([]);
    });

    it('treats runs of whitespace as one separator', () => {
      const { search, visible } = load({ standalone: SAMPLE });
      search('   fix    redirect  ');
      expect(visible()).toEqual([144]);
    });

    it('shows everything again when the query is emptied', () => {
      const { search, visible, doc } = load({ standalone: SAMPLE });
      search('login');
      expect(visible()).toEqual([42, 144]);
      search('');
      expect(visible()).toEqual([42, 43, 144, 7]);
      expect((doc.querySelector('.pulls-page') as any).classList.contains('is-searching')).toBe(false);
    });
  });

  describe('the 100ms delay', () => {
    it('does not filter before the delay has passed', () => {
      const { input, win, clock, visible } = load({ standalone: SAMPLE });
      input.value = 'login';
      input.dispatchEvent(new win.Event('input'));
      clock.advance(DEBOUNCE_MS - 1);
      expect(visible()).toEqual([42, 43, 144, 7]);
      clock.advance(1);
      expect(visible()).toEqual([42, 144]);
    });

    it('filters once for a burst of typing, using the last value', () => {
      const { input, win, clock, visible } = load({ standalone: SAMPLE });
      for (const text of ['l', 'lo', 'log', 'logi', 'login']) {
        input.value = text;
        input.dispatchEvent(new win.Event('input'));
        clock.advance(20); // never long enough to fire
      }
      expect(visible()).toEqual([42, 43, 144, 7]);
      clock.advance(DEBOUNCE_MS);
      expect(visible()).toEqual([42, 144]);
    });

    it('clears at once on Escape, without waiting', () => {
      const { input, win, search, visible } = load({ standalone: SAMPLE });
      search('login');
      expect(visible()).toEqual([42, 144]);
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
      expect(input.value).toBe('');
      expect(visible()).toEqual([42, 43, 144, 7]);
    });
  });

  describe('when nothing matches', () => {
    it('says so', () => {
      const { search, visible, doc } = load({ standalone: SAMPLE });
      search('nothing here');
      expect(visible()).toEqual([]);
      expect((doc.getElementById('pulls-no-matches') as any).hidden).toBe(false);
    });

    it('takes the message away again once something matches', () => {
      const { search, doc } = load({ standalone: SAMPLE });
      search('nothing here');
      search('login');
      expect((doc.getElementById('pulls-no-matches') as any).hidden).toBe(true);
    });
  });

  describe('titles that carry markup or punctuation', () => {
    it('matches a title holding a quote or an apostrophe', () => {
      // The template escapes the attribute, so the value the filter reads back has to be
      // the original text, not the escaped spelling of it.
      const { search, visible } = load({
        standalone: [pull(1, `FIX The "login" page won't load`), pull(2, 'Something else')],
      });
      search("won't");
      expect(visible()).toEqual([1]);
      search('"login"');
      expect(visible()).toEqual([1]);
    });

    it('does not let a title inject markup into the page', () => {
      const { doc, search, visible } = load({
        standalone: [pull(1, '<img src=x onerror=boom> tricky')],
      });
      expect(doc.querySelector('.pulls-list img')).toBeNull();
      search('tricky');
      expect(visible()).toEqual([1]);
    });
  });

  it('counts what it shows against the whole list', () => {
    const { search, doc } = load({ standalone: SAMPLE });
    search('login');
    expect(doc.getElementById('pulls-search-count')!.textContent).toBe('2 of 4');
  });

  describe('stacks', () => {
    const stacks = [
      stackOf('main', [pull(10, 'FIX Login step one'), pull(11, 'FIX Login step two')]),
      stackOf('main', [pull(20, 'ADD Unrelated work')]),
    ];

    it('filters the entries inside a stack', () => {
      const { search, visible } = load({ stacks, standalone: [pull(30, 'Login elsewhere')] });
      search('login two');
      expect(visible()).toEqual([11]);
    });

    it('hides a stack in which nothing matches', () => {
      const { search, doc } = load({ stacks });
      search('login');
      const hidden = [...doc.querySelectorAll('.stack')].map((el: any) => el.hidden);
      expect(hidden).toEqual([false, true]);
    });

    it('hides a section heading over an empty section', () => {
      const { search, doc } = load({ stacks, standalone: [pull(30, 'Unrelated standalone')] });
      search('login');
      const headings = [...doc.querySelectorAll('[data-section-heading]')] as any[];
      // "Stacks" keeps a match; "Other pull requests" does not.
      expect(headings.map((h) => h.hidden)).toEqual([false, true]);
    });

    it('stops drawing the stack rail while a query is active', () => {
      const { search, doc } = load({ stacks });
      const page = doc.querySelector('.pulls-page') as any;
      expect(page.classList.contains('is-searching')).toBe(false);
      search('login');
      expect(page.classList.contains('is-searching')).toBe(true);
    });
  });
});
