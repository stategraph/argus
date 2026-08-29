import { describe, it, expect } from 'vitest';
import { parseIssueRefs, collectCommitIssueRefs } from '../src/lib/issue-refs.js';

const OWNER = 'orbitz';
const REPO = 'argus';

/** The `owner/repo#number` identity of each reference, in order. */
const keys = (refs: { key: string }[]) => refs.map((r) => r.key);

describe('parseIssueRefs', () => {
  describe('the bare #123 form', () => {
    it('reads the reference against the PR\'s own repository', () => {
      expect(parseIssueRefs('FIX Stop the crash #42', OWNER, REPO)).toEqual([
        { owner: OWNER, repo: REPO, number: 42, key: 'orbitz/argus#42' },
      ]);
    });

    it('reads a reference at the very start of the text', () => {
      expect(keys(parseIssueRefs('#7 is done', OWNER, REPO))).toEqual(['orbitz/argus#7']);
    });

    it('reads a reference inside punctuation', () => {
      expect(keys(parseIssueRefs('Closes (#8), and #9.', OWNER, REPO))).toEqual([
        'orbitz/argus#8',
        'orbitz/argus#9',
      ]);
    });

    it('reads a reference on a later line of the message body', () => {
      expect(keys(parseIssueRefs('Subject\n\nCloses #11\n', OWNER, REPO))).toEqual([
        'orbitz/argus#11',
      ]);
    });
  });

  describe('the owner/repo#123 form', () => {
    it('directs the reference at the named repository', () => {
      expect(parseIssueRefs('Closes terrateam/terrat#100', OWNER, REPO)).toEqual([
        { owner: 'terrateam', repo: 'terrat', number: 100, key: 'terrateam/terrat#100' },
      ]);
    });

    it('accepts dots, underscores and hyphens in a repository name', () => {
      expect(keys(parseIssueRefs('See my-org/my_repo.js#3', OWNER, REPO))).toEqual([
        'my-org/my_repo.js#3',
      ]);
    });

    it('keeps the two forms apart in one message', () => {
      expect(keys(parseIssueRefs('Closes #1 and other/repo#2', OWNER, REPO))).toEqual([
        'orbitz/argus#1',
        'other/repo#2',
      ]);
    });
  });

  describe('text that is not a reference', () => {
    it('ignores a markdown heading', () => {
      expect(parseIssueRefs('# Heading\n## 2 Also a heading', OWNER, REPO)).toEqual([]);
    });

    it('ignores a hash inside a word', () => {
      expect(parseIssueRefs('release#12 and C#7', OWNER, REPO)).toEqual([]);
    });

    it('ignores a URL fragment', () => {
      expect(
        parseIssueRefs('https://github.com/orbitz/argus/blob/main/a.ts#42', OWNER, REPO)
      ).toEqual([]);
    });

    it('ignores a repository path in a URL', () => {
      expect(parseIssueRefs('https://github.com/orbitz/argus#3', OWNER, REPO)).toEqual([]);
    });

    it('ignores #0, which is not a valid issue number', () => {
      expect(parseIssueRefs('Item #0', OWNER, REPO)).toEqual([]);
    });

    it('ignores digits followed by letters', () => {
      expect(parseIssueRefs('Commit #12abc', OWNER, REPO)).toEqual([]);
    });

    it('returns nothing for empty or absent text', () => {
      expect(parseIssueRefs('', OWNER, REPO)).toEqual([]);
      expect(parseIssueRefs(null, OWNER, REPO)).toEqual([]);
      expect(parseIssueRefs(undefined, OWNER, REPO)).toEqual([]);
    });
  });

  describe('duplicates', () => {
    it('reports a repeated reference once', () => {
      expect(keys(parseIssueRefs('Closes #5. See also #5.', OWNER, REPO))).toEqual([
        'orbitz/argus#5',
      ]);
    });

    it('treats a difference in letter case as the same reference', () => {
      expect(keys(parseIssueRefs('Orbitz/Argus#5 and orbitz/argus#5', OWNER, REPO))).toEqual([
        'orbitz/argus#5',
      ]);
    });

    it('treats a qualified reference to the PR\'s own repository as its bare form', () => {
      expect(keys(parseIssueRefs('#5 and orbitz/argus#5', OWNER, REPO))).toEqual([
        'orbitz/argus#5',
      ]);
    });
  });

  it('does not carry its position from one call to the next', () => {
    // The pattern is a module-level global regex. Without a lastIndex reset the second
    // call starts where the first one stopped and finds nothing.
    expect(keys(parseIssueRefs('Closes #1', OWNER, REPO))).toEqual(['orbitz/argus#1']);
    expect(keys(parseIssueRefs('Closes #1', OWNER, REPO))).toEqual(['orbitz/argus#1']);
  });
});

describe('collectCommitIssueRefs', () => {
  const commit = (sha: string, message: string) => ({ sha, commit: { message } });

  it('collects across commits in commit order', () => {
    const refs = collectCommitIssueRefs(
      [commit('a', 'FIX first #3'), commit('b', 'ADD second #1\n\nCloses other/repo#9')],
      OWNER,
      REPO,
      42
    );
    expect(keys(refs)).toEqual(['orbitz/argus#3', 'orbitz/argus#1', 'other/repo#9']);
  });

  it('reports an issue named by two commits once', () => {
    const refs = collectCommitIssueRefs(
      [commit('a', 'Part one of #3'), commit('b', 'Part two of #3')],
      OWNER,
      REPO,
      42
    );
    expect(keys(refs)).toEqual(['orbitz/argus#3']);
  });

  it('drops a reference to the pull request itself', () => {
    const refs = collectCommitIssueRefs(
      [commit('a', 'Address review on #42, closes #7')],
      OWNER,
      REPO,
      42
    );
    expect(keys(refs)).toEqual(['orbitz/argus#7']);
  });

  it('keeps another repository\'s issue that shares the PR number', () => {
    const refs = collectCommitIssueRefs([commit('a', 'Closes other/repo#42')], OWNER, REPO, 42);
    expect(keys(refs)).toEqual(['other/repo#42']);
  });

  it('returns nothing when no commit names an issue', () => {
    expect(collectCommitIssueRefs([commit('a', 'FIX a typo')], OWNER, REPO, 42)).toEqual([]);
    expect(collectCommitIssueRefs([], OWNER, REPO, 42)).toEqual([]);
  });
});
