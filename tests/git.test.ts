import { describe, it, expect } from 'vitest';
import { getRepoPath, buildAuthUrl, sanitizeError } from '../src/lib/git.js';

describe('git module', () => {
  describe('getRepoPath', () => {
    it('should construct correct repo path', () => {
      const path = getRepoPath('owner', 'repo');
      expect(path).toContain('owner');
      expect(path).toContain('repo.git');
      expect(path).toMatch(/argus-git-cache/);
    });

    it('should handle different owner/repo combinations', () => {
      const path1 = getRepoPath('facebook', 'react');
      const path2 = getRepoPath('microsoft', 'typescript');
      expect(path1).toContain('facebook/react.git');
      expect(path2).toContain('microsoft/typescript.git');
    });
  });

  describe('buildAuthUrl', () => {
    it('should inject token into URL', () => {
      const url = buildAuthUrl('owner', 'repo', 'ghp_test123');
      expect(url).toBe('https://oauth2:ghp_test123@github.com/owner/repo.git');
    });

    it('should handle special characters in owner/repo', () => {
      const url = buildAuthUrl('my-org', 'my-repo', 'token');
      expect(url).toBe('https://oauth2:token@github.com/my-org/my-repo.git');
    });
  });

  describe('sanitizeError', () => {
    it('should remove token from error message', () => {
      const error = 'Failed to clone https://oauth2:ghp_secret123@github.com/owner/repo.git';
      const sanitized = sanitizeError(error, 'ghp_secret123');
      expect(sanitized).not.toContain('ghp_secret123');
      expect(sanitized).toContain('***TOKEN***');
    });

    it('should handle multiple occurrences of token', () => {
      const error = 'Token ghp_test in URL: ghp_test@github.com';
      const sanitized = sanitizeError(error, 'ghp_test');
      expect(sanitized).toBe('Token ***TOKEN*** in URL: ***TOKEN***@github.com');
    });

    it('should return original message if no token', () => {
      const error = 'Some error message';
      const sanitized = sanitizeError(error, '');
      expect(sanitized).toBe(error);
    });

    it('should handle messages without token', () => {
      const error = 'Network timeout';
      const sanitized = sanitizeError(error, 'ghp_test123');
      expect(sanitized).toBe(error);
    });
  });
});
