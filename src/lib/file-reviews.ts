import { query } from '../db/index.js';

/**
 * Get list of file paths that a user has marked as reviewed for a specific PR revision
 */
export function getReviewedFiles(
  userId: number,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string
): string[] {
  const { rows } = query<{ file_path: string }>(
    `SELECT file_path FROM file_reviews
     WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ? AND head_sha = ?`,
    [userId, owner, repo, prNumber, headSha]
  );
  return rows.map(r => r.file_path);
}

/**
 * Toggle file review status (mark as reviewed or un-review)
 * Returns true if file is now reviewed, false if un-reviewed
 */
export function toggleFileReview(
  userId: number,
  owner: string,
  repo: string,
  prNumber: number,
  filePath: string,
  headSha: string
): boolean {
  // Check if exists
  const { rows } = query<{ id: number }>(
    `SELECT id FROM file_reviews
     WHERE user_id = ? AND owner = ? AND repo = ? AND pr_number = ? AND file_path = ? AND head_sha = ?`,
    [userId, owner, repo, prNumber, filePath, headSha]
  );

  if (rows.length > 0) {
    // Delete (un-review)
    query(
      `DELETE FROM file_reviews WHERE id = ?`,
      [rows[0].id]
    );
    return false;
  } else {
    // Insert (mark reviewed)
    query(
      `INSERT INTO file_reviews (user_id, owner, repo, pr_number, file_path, head_sha)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, owner, repo, prNumber, filePath, headSha]
    );
    return true;
  }
}
