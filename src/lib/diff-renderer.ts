import { DiffFile, DiffLine } from './diff-parser.js';

// Escape HTML characters
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Render a single diff line
function renderLine(
  line: DiffLine,
  fileIndex: number,
  path: string,
  headSha: string,
  owner: string,
  repo: string,
  prNumber: number
): string {
  const lineClass = line.type === 'add' ? 'diff-line-add' :
                    line.type === 'del' ? 'diff-line-del' :
                    'diff-line-context';

  const oldNum = line.oldLineNum !== null ? line.oldLineNum : '';
  const newNum = line.newLineNum !== null ? line.newLineNum : '';
  const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

  // For commenting, use the new line number for additions/context, old for deletions
  const commentLine = line.type === 'del' ? line.oldLineNum : line.newLineNum;
  const commentSide = line.type === 'del' ? 'LEFT' : 'RIGHT';

  // Unique ID for this line's comment form (for CSS :target)
  const lineId = `f${fileIndex}-L${commentSide}${commentLine}`;
  const formId = `comment-${lineId}`;

  // Comment button - links to the form anchor for no-JS support
  const commentBtn = commentLine ? `
    <a href="#${formId}" class="line-comment-btn" title="Add comment" aria-label="Add comment on line ${commentLine}">+</a>
  ` : '';

  return `
    <tr class="diff-line ${lineClass}" id="${lineId}"
        data-path="${escapeHtml(path)}"
        data-line="${commentLine || ''}"
        data-side="${commentSide}"
        data-sha="${headSha}">
      <td class="diff-line-num diff-line-num-old">${oldNum}</td>
      <td class="diff-line-num diff-line-num-new">${newNum}</td>
      <td class="diff-line-action">${commentBtn}</td>
      <td class="diff-line-content"><span class="diff-line-prefix">${prefix}</span>${escapeHtml(line.content)}</td>
    </tr>
    ${commentLine ? renderInlineCommentFormRow(formId, path, commentLine, commentSide, headSha, owner, repo, prNumber) : ''}`;
}

// Render inline comment form row (hidden by default, shown via CSS :target)
function renderInlineCommentFormRow(
  formId: string,
  path: string,
  line: number,
  side: string,
  headSha: string,
  owner: string,
  repo: string,
  prNumber: number
): string {
  return `
    <tr class="inline-comment-form-row" id="${formId}">
      <td colspan="4">
        <form class="inline-comment-form" method="POST" action="/pr/${owner}/${repo}/${prNumber}/inline-comment">
          <input type="hidden" name="path" value="${escapeHtml(path)}">
          <input type="hidden" name="line" value="${line}">
          <input type="hidden" name="side" value="${side}">
          <input type="hidden" name="commit_id" value="${headSha}">
          <div class="comment-form-header">
            <span class="comment-form-file">${escapeHtml(path)}:${line}</span>
            <a href="#f${path.replace(/[^a-zA-Z0-9]/g, '-')}-close" class="comment-form-close">&times;</a>
          </div>
          <textarea name="body" placeholder="Leave a comment..." rows="3" required class="comment-textarea"></textarea>
          <div class="comment-form-actions">
            <a href="#" class="btn btn-secondary btn-small">Cancel</a>
            <button type="submit" class="btn btn-primary btn-small">Comment</button>
          </div>
        </form>
      </td>
    </tr>`;
}

// Render a hunk header
function renderHunkHeader(header: string): string {
  // Extract the @@ part and any function context
  const match = header.match(/^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)(.*)$/);
  const range = match ? match[1] : header;
  const context = match ? match[2] : '';

  return `
    <tr class="diff-hunk-header">
      <td class="diff-line-num"></td>
      <td class="diff-line-num"></td>
      <td class="diff-line-action"></td>
      <td class="diff-hunk-content">
        <span class="diff-hunk-range">${escapeHtml(range)}</span>
        ${context ? `<span class="diff-hunk-context">${escapeHtml(context)}</span>` : ''}
      </td>
    </tr>`;
}

// Render a file diff
export function renderFile(
  file: DiffFile,
  index: number,
  headSha: string,
  truncated: boolean,
  totalLines: number,
  owner: string,
  repo: string,
  prNumber: number
): string {
  const path = file.newPath || file.oldPath;
  const filename = path.split('/').pop() || path;
  const directory = path.substring(0, path.length - filename.length);

  // File stats
  const statsHtml = file.isBinary
    ? '<span class="file-stat binary">Binary</span>'
    : `<span class="file-stat additions">+${file.additions}</span>
       <span class="file-stat deletions">-${file.deletions}</span>`;

  // Status badge
  const statusBadges: Record<string, { class: string; text: string }> = {
    added: { class: 'badge-added', text: 'A' },
    deleted: { class: 'badge-deleted', text: 'D' },
    modified: { class: 'badge-modified', text: 'M' },
    renamed: { class: 'badge-renamed', text: 'R' },
  };
  const badge = statusBadges[file.status] || statusBadges.modified;

  // Truncation notice
  const truncatedHtml = truncated
    ? `<div class="truncated-notice">
        Large diff truncated. Showing partial diff (${totalLines} total lines).
        <button class="load-full-diff" data-path="${escapeHtml(path)}" type="button">
          Load full diff
        </button>
      </div>`
    : '';

  // Binary file
  if (file.isBinary) {
    return `
      <details class="diff-file" data-file-index="${index}" data-path="${escapeHtml(path)}">
        <summary class="file-header" id="file-${index}">
          <span class="file-header-info">
            <span class="status-badge ${badge.class}">${badge.text}</span>
            <span class="file-path">
              <span class="file-directory">${escapeHtml(directory)}</span>
              <span class="file-name">${escapeHtml(filename)}</span>
            </span>
          </span>
          <span class="file-stats">${statsHtml}</span>
        </summary>
        <div class="diff-content">
          <div class="diff-binary-notice">Binary file not shown</div>
        </div>
      </details>`;
  }

  // Empty file
  if (file.hunks.length === 0) {
    return `
      <details class="diff-file" data-file-index="${index}" data-path="${escapeHtml(path)}">
        <summary class="file-header" id="file-${index}">
          <span class="file-header-info">
            <span class="status-badge ${badge.class}">${badge.text}</span>
            <span class="file-path">
              <span class="file-directory">${escapeHtml(directory)}</span>
              <span class="file-name">${escapeHtml(filename)}</span>
            </span>
          </span>
          <span class="file-stats">${statsHtml}</span>
        </summary>
        <div class="diff-content">
          <div class="diff-empty-notice">No changes</div>
        </div>
      </details>`;
  }

  // Render diff table
  let tableRows = '';
  for (const hunk of file.hunks) {
    tableRows += renderHunkHeader(hunk.header);
    for (const line of hunk.lines) {
      tableRows += renderLine(line, index, path, headSha, owner, repo, prNumber);
    }
  }

  return `
    <details class="diff-file" data-file-index="${index}" data-path="${escapeHtml(path)}" data-sha="${headSha}">
      <summary class="file-header" id="file-${index}">
        <span class="file-header-info">
          <span class="status-badge ${badge.class}">${badge.text}</span>
          <span class="file-path">
            <span class="file-directory">${escapeHtml(directory)}</span>
            <span class="file-name">${escapeHtml(filename)}</span>
          </span>
        </span>
        <span class="file-stats">${statsHtml}</span>
      </summary>
      ${truncatedHtml}
      <div class="diff-content">
        <table class="diff-table">
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    </details>`;
}

// Render file sidebar item
export function renderFileSidebarItem(file: DiffFile, index: number): string {
  const path = file.newPath || file.oldPath;
  const filename = path.split('/').pop() || path;
  const directory = path.substring(0, path.length - filename.length);

  const statsHtml = file.isBinary
    ? '<span class="sidebar-stat binary">bin</span>'
    : `<span class="sidebar-stat additions">+${file.additions}</span>
       <span class="sidebar-stat deletions">-${file.deletions}</span>`;

  return `
    <a href="#file-${index}" class="file-sidebar-item status-${file.status}" data-file-index="${index}">
      <span class="sidebar-file-path" title="${escapeHtml(path)}">
        ${directory ? `<span class="sidebar-dir">${escapeHtml(directory)}</span>` : ''}
        <span class="sidebar-name">${escapeHtml(filename)}</span>
      </span>
      <span class="sidebar-stats">${statsHtml}</span>
    </a>`;
}

// Inline comment form template (for JS-enhanced experience)
export function renderInlineCommentForm(): string {
  return `
    <template id="inline-comment-form-template">
      <tr class="inline-comment-form-row inline-comment-form-js">
        <td colspan="4">
          <form class="inline-comment-form" method="POST">
            <input type="hidden" name="path" value="">
            <input type="hidden" name="line" value="">
            <input type="hidden" name="side" value="">
            <input type="hidden" name="commit_id" value="">
            <textarea name="body" placeholder="Leave a comment..." rows="3" required class="comment-textarea"></textarea>
            <div class="comment-form-actions">
              <button type="button" class="btn btn-secondary btn-small cancel-inline-comment">Cancel</button>
              <button type="submit" class="btn btn-primary btn-small">Comment</button>
            </div>
          </form>
        </td>
      </tr>
    </template>`;
}

// Comment thread renderer
export function renderCommentThread(
  comments: Array<{
    id: number;
    user: { login: string; avatar_url: string };
    body: string;
    created_at: string;
    path: string;
    line: number | null;
    side: string;
  }>,
  owner: string,
  repo: string,
  prNumber: number
): string {
  const rendered = comments
    .map((comment) => {
      const date = new Date(comment.created_at);
      const timeAgo = formatTimeAgo(date);
      return `
        <div class="comment" data-comment-id="${comment.id}">
          <div class="comment-header">
            <img src="${escapeHtml(comment.user.avatar_url)}" alt="${escapeHtml(comment.user.login)}" class="comment-avatar">
            <span class="comment-author">${escapeHtml(comment.user.login)}</span>
            <span class="comment-time" title="${date.toISOString()}">${timeAgo}</span>
          </div>
          <div class="comment-body">${escapeHtml(comment.body)}</div>
        </div>`;
    })
    .join('');

  const replyForm = `
    <form class="reply-form" method="POST" action="/pr/${owner}/${repo}/${prNumber}/reply">
      <input type="hidden" name="comment_id" value="${comments[0]?.id || ''}">
      <textarea name="body" placeholder="Reply..." rows="2" class="comment-textarea"></textarea>
      <div class="comment-form-actions">
        <button type="submit" class="btn btn-small">Reply</button>
      </div>
    </form>`;

  return `
    <tr class="comment-thread-row">
      <td colspan="4">
        <div class="comment-thread">${rendered}${replyForm}</div>
      </td>
    </tr>`;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Render a simple diff hunk (for conversation tab)
export function renderSimpleHunk(hunk: import('./diff-parser.js').DiffHunk): string {
  const rows = hunk.lines.map(line => {
    const lineClass = line.type === 'add' ? 'diff-line-add' :
                      line.type === 'del' ? 'diff-line-del' :
                      'diff-line-context';
    const oldNum = line.oldLineNum !== null ? line.oldLineNum : '';
    const newNum = line.newLineNum !== null ? line.newLineNum : '';
    const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

    return `
      <tr class="diff-line ${lineClass}">
        <td class="diff-line-num diff-line-num-old">${oldNum}</td>
        <td class="diff-line-num diff-line-num-new">${newNum}</td>
        <td class="diff-line-content"><span class="diff-line-prefix">${prefix}</span>${escapeHtml(line.content)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="diff-hunk-simple">
      <table class="diff-table">
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}
