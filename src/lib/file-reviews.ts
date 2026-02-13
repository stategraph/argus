import { query } from '../db/index.js';

/**
 * Get list of file paths that a user has marked as reviewed for a specific PR,
 * persisting across revisions for files whose blob SHA hasn't changed.
 */
export function getReviewedFiles(
  userId: number,
  owner: string,
  repo: string,
  prNumber: number,
  currentFileShas: Map<string, string>
): string[] {
  const { rows } = query<{ file_path: string; file_sha: string }>(
    `SELECT file_path, file_sha FROM file_reviews
     WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ?`,
    [userId, owner, repo, prNumber]
  );
  return rows
    .filter(r => r.file_sha && currentFileShas.get(r.file_path) === r.file_sha)
    .map(r => r.file_path);
}

/**
 * Idempotently mark a file as reviewed. No-op if already reviewed with the same SHA.
 */
export function markFileReviewed(
  userId: number,
  owner: string,
  repo: string,
  prNumber: number,
  filePath: string,
  headSha: string,
  fileSha: string
): void {
  const { rows } = query<{ id: number }>(
    `SELECT id FROM file_reviews
     WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ? AND file_path = ? AND file_sha = ?`,
    [userId, owner, repo, prNumber, filePath, fileSha]
  );

  if (rows.length > 0) return; // already reviewed with this SHA

  query(
    `DELETE FROM file_reviews
     WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ? AND file_path = ?`,
    [userId, owner, repo, prNumber, filePath]
  );
  query(
    `INSERT INTO file_reviews (user_id, owner, repo, pr_number, file_path, head_sha, file_sha)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, owner, repo, prNumber, filePath, headSha, fileSha]
  );
}

/**
 * Idempotently mark a file as unreviewed. No-op if not currently reviewed.
 */
export function markFileUnreviewed(
  userId: number,
  owner: string,
  repo: string,
  prNumber: number,
  filePath: string
): void {
  query(
    `DELETE FROM file_reviews
     WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ? AND file_path = ?`,
    [userId, owner, repo, prNumber, filePath]
  );
}

/**
 * Toggle file review status (mark as reviewed or un-review).
 * Returns true if file is now reviewed, false if un-reviewed.
 */
export function toggleFileReview(
  userId: number,
  owner: string,
  repo: string,
  prNumber: number,
  filePath: string,
  headSha: string,
  fileSha: string
): boolean {
  // Check if a review exists for this file with this blob SHA
  const { rows } = query<{ id: number }>(
    `SELECT id FROM file_reviews
     WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ? AND file_path = ? AND file_sha = ?`,
    [userId, owner, repo, prNumber, filePath, fileSha]
  );

  if (rows.length > 0) {
    // Delete (un-review)
    query(
      `DELETE FROM file_reviews WHERE id = ?`,
      [rows[0].id]
    );
    return false;
  } else {
    // Delete any old review for this file (different sha), then insert
    query(
      `DELETE FROM file_reviews
       WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ? AND file_path = ?`,
      [userId, owner, repo, prNumber, filePath]
    );
    query(
      `INSERT INTO file_reviews (user_id, owner, repo, pr_number, file_path, head_sha, file_sha)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, owner, repo, prNumber, filePath, headSha, fileSha]
    );
    return true;
  }
}
