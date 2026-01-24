import { marked } from 'marked';
import { nameToEmoji } from 'gemoji';

// Configure marked for safe rendering with GitHub-flavored markdown
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    // Make links open in new tab
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    // Handle checkboxes in task lists
    listitem({ text, task, checked }) {
      if (task) {
        const checkbox = checked
          ? '<input type="checkbox" checked>'
          : '<input type="checkbox">';
        return `<li class="task-list-item">${checkbox} ${text}</li>`;
      }
      return `<li>${text}</li>`;
    },
  },
});

// Convert emoji shortcodes to actual emoji
function convertEmoji(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (match, name) => {
    return nameToEmoji[name] || match;
  });
}

// Render markdown to HTML
export function renderMarkdown(markdown: string | null | undefined): string {
  if (!markdown) return '';

  try {
    // Convert emoji shortcodes (like :thumbsup:) to emoji before markdown processing
    const withEmoji = convertEmoji(markdown);
    return marked(withEmoji) as string;
  } catch (err) {
    console.error('Markdown rendering error:', err);
    return escapeHtml(markdown);
  }
}

// Escape HTML for plain text display
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Truncate text with ellipsis
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
