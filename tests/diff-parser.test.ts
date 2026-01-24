import { describe, it, expect } from 'vitest';
import {
  parseDiff,
  parsePatch,
  truncateFile,
  getLineCount,
  DiffFile,
} from '../src/lib/diff-parser.js';

describe('diff-parser', () => {
  describe('parseDiff', () => {
    it('should parse a simple unified diff', () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].oldPath).toBe('file.txt');
      expect(result.files[0].newPath).toBe('file.txt');
      expect(result.files[0].status).toBe('modified');
      expect(result.files[0].hunks).toHaveLength(1);
      expect(result.files[0].additions).toBe(1);
      expect(result.files[0].deletions).toBe(0);
    });

    it('should parse a diff with multiple files', () => {
      const diff = `diff --git a/file1.txt b/file1.txt
index 1234567..abcdefg 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,2 +1,3 @@
 line 1
+added
 line 2
diff --git a/file2.txt b/file2.txt
index 1234567..abcdefg 100644
--- a/file2.txt
+++ b/file2.txt
@@ -1,2 +1,2 @@
 unchanged
-removed
+added
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(2);
      expect(result.files[0].newPath).toBe('file1.txt');
      expect(result.files[0].additions).toBe(1);
      expect(result.files[0].deletions).toBe(0);
      expect(result.files[1].newPath).toBe('file2.txt');
      expect(result.files[1].additions).toBe(1);
      expect(result.files[1].deletions).toBe(1);
    });

    it('should parse a new file', () => {
      const diff = `diff --git a/newfile.txt b/newfile.txt
new file mode 100644
index 0000000..abcdefg
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe('added');
      expect(result.files[0].newPath).toBe('newfile.txt');
      expect(result.files[0].additions).toBe(3);
      expect(result.files[0].deletions).toBe(0);
    });

    it('should parse a deleted file', () => {
      const diff = `diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
index abcdefg..0000000
--- a/deleted.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line 1
-line 2
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe('deleted');
      expect(result.files[0].oldPath).toBe('deleted.txt');
      expect(result.files[0].additions).toBe(0);
      expect(result.files[0].deletions).toBe(2);
    });

    it('should parse a renamed file', () => {
      const diff = `diff --git a/old.txt b/new.txt
similarity index 90%
rename from old.txt
rename to new.txt
index 1234567..abcdefg 100644
--- a/old.txt
+++ b/new.txt
@@ -1,3 +1,3 @@
 line 1
-old content
+new content
 line 3
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe('renamed');
    });

    it('should handle binary files', () => {
      const diff = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/image.png differ
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].isBinary).toBe(true);
      expect(result.files[0].hunks).toHaveLength(0);
    });

    it('should parse multiple hunks in a file', () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line 1
+added at top
 line 2
 line 3
@@ -10,3 +11,4 @@
 line 10
+added at bottom
 line 11
 line 12
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].hunks).toHaveLength(2);
      expect(result.files[0].hunks[0].oldStart).toBe(1);
      expect(result.files[0].hunks[0].newStart).toBe(1);
      expect(result.files[0].hunks[1].oldStart).toBe(10);
      expect(result.files[0].hunks[1].newStart).toBe(11);
    });

    it('should correctly track line numbers', () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt
@@ -1,5 +1,6 @@
 context line 1
-deleted line
+added line 1
+added line 2
 context line 2
 context line 3
 context line 4
`;

      const result = parseDiff(diff);
      const hunk = result.files[0].hunks[0];

      // Context line 1: old=1, new=1
      expect(hunk.lines[0].type).toBe('context');
      expect(hunk.lines[0].oldLineNum).toBe(1);
      expect(hunk.lines[0].newLineNum).toBe(1);

      // Deleted line: old=2, new=null
      expect(hunk.lines[1].type).toBe('del');
      expect(hunk.lines[1].oldLineNum).toBe(2);
      expect(hunk.lines[1].newLineNum).toBeNull();

      // Added line 1: old=null, new=2
      expect(hunk.lines[2].type).toBe('add');
      expect(hunk.lines[2].oldLineNum).toBeNull();
      expect(hunk.lines[2].newLineNum).toBe(2);

      // Added line 2: old=null, new=3
      expect(hunk.lines[3].type).toBe('add');
      expect(hunk.lines[3].oldLineNum).toBeNull();
      expect(hunk.lines[3].newLineNum).toBe(3);

      // Context line 2: old=3, new=4
      expect(hunk.lines[4].type).toBe('context');
      expect(hunk.lines[4].oldLineNum).toBe(3);
      expect(hunk.lines[4].newLineNum).toBe(4);
    });

    it('should assign position numbers for comment anchoring', () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3
`;

      const result = parseDiff(diff);
      const lines = result.files[0].hunks[0].lines;

      // Positions should be 1-indexed, starting after hunk header
      expect(lines[0].position).toBe(1);
      expect(lines[1].position).toBe(2);
      expect(lines[2].position).toBe(3);
      expect(lines[3].position).toBe(4);
    });
  });

  describe('parsePatch', () => {
    it('should parse a GitHub API patch string', () => {
      const patch = `@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

      const result = parsePatch(patch, 'test.txt', 'modified');

      expect(result.oldPath).toBe('test.txt');
      expect(result.newPath).toBe('test.txt');
      expect(result.hunks).toHaveLength(1);
      expect(result.additions).toBe(1);
      expect(result.deletions).toBe(0);
    });

    it('should handle patch with multiple hunks', () => {
      const patch = `@@ -1,3 +1,4 @@
 line 1
+added
 line 2
 line 3
@@ -10,3 +11,4 @@
 line 10
+another added
 line 11
 line 12`;

      const result = parsePatch(patch, 'test.txt', 'modified');

      expect(result.hunks).toHaveLength(2);
      expect(result.additions).toBe(2);
    });
  });

  describe('getLineCount', () => {
    it('should count lines including hunk headers', () => {
      const file: DiffFile = {
        oldPath: 'test.txt',
        newPath: 'test.txt',
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,3 +1,4 @@',
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 4,
            lines: [
              { type: 'context', content: 'line 1', oldLineNum: 1, newLineNum: 1 },
              { type: 'add', content: 'new', oldLineNum: null, newLineNum: 2 },
              { type: 'context', content: 'line 2', oldLineNum: 2, newLineNum: 3 },
            ],
          },
        ],
        additions: 1,
        deletions: 0,
        isBinary: false,
      };

      // 3 lines + 1 hunk header = 4
      expect(getLineCount(file)).toBe(4);
    });

    it('should handle multiple hunks', () => {
      const file: DiffFile = {
        oldPath: 'test.txt',
        newPath: 'test.txt',
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,2 +1,2 @@',
            oldStart: 1,
            oldCount: 2,
            newStart: 1,
            newCount: 2,
            lines: [
              { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
              { type: 'context', content: 'b', oldLineNum: 2, newLineNum: 2 },
            ],
          },
          {
            header: '@@ -10,2 +10,2 @@',
            oldStart: 10,
            oldCount: 2,
            newStart: 10,
            newCount: 2,
            lines: [
              { type: 'context', content: 'x', oldLineNum: 10, newLineNum: 10 },
              { type: 'context', content: 'y', oldLineNum: 11, newLineNum: 11 },
            ],
          },
        ],
        additions: 0,
        deletions: 0,
        isBinary: false,
      };

      // 2 hunks * (2 lines + 1 header) = 6
      expect(getLineCount(file)).toBe(6);
    });
  });

  describe('truncateFile', () => {
    it('should not truncate if under limit', () => {
      const file: DiffFile = {
        oldPath: 'test.txt',
        newPath: 'test.txt',
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,3 +1,4 @@',
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 4,
            lines: [
              { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
              { type: 'add', content: 'b', oldLineNum: null, newLineNum: 2 },
            ],
          },
        ],
        additions: 1,
        deletions: 0,
        isBinary: false,
      };

      const { truncatedFile, wasTruncated } = truncateFile(file, 10);

      expect(wasTruncated).toBe(false);
      expect(truncatedFile.hunks).toHaveLength(1);
      expect(truncatedFile.hunks[0].lines).toHaveLength(2);
    });

    it('should truncate if over limit', () => {
      const lines = [];
      for (let i = 0; i < 100; i++) {
        lines.push({
          type: 'context' as const,
          content: `line ${i}`,
          oldLineNum: i,
          newLineNum: i,
        });
      }

      const file: DiffFile = {
        oldPath: 'test.txt',
        newPath: 'test.txt',
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,100 +1,100 @@',
            oldStart: 1,
            oldCount: 100,
            newStart: 1,
            newCount: 100,
            lines,
          },
        ],
        additions: 0,
        deletions: 0,
        isBinary: false,
      };

      const { truncatedFile, wasTruncated, totalLines } = truncateFile(file, 20);

      expect(wasTruncated).toBe(true);
      expect(totalLines).toBe(101); // 100 lines + 1 header
      // Should have 19 lines (20 - 1 for hunk header)
      expect(truncatedFile.hunks[0].lines.length).toBeLessThanOrEqual(19);
    });

    it('should report correct total lines', () => {
      const file: DiffFile = {
        oldPath: 'test.txt',
        newPath: 'test.txt',
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,5 +1,5 @@',
            oldStart: 1,
            oldCount: 5,
            newStart: 1,
            newCount: 5,
            lines: [
              { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
              { type: 'context', content: 'b', oldLineNum: 2, newLineNum: 2 },
              { type: 'context', content: 'c', oldLineNum: 3, newLineNum: 3 },
              { type: 'context', content: 'd', oldLineNum: 4, newLineNum: 4 },
              { type: 'context', content: 'e', oldLineNum: 5, newLineNum: 5 },
            ],
          },
        ],
        additions: 0,
        deletions: 0,
        isBinary: false,
      };

      const { totalLines } = truncateFile(file, 100);
      expect(totalLines).toBe(6); // 5 lines + 1 header
    });
  });
});
