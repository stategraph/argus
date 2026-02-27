import { marked } from 'marked';
import { nameToEmoji } from 'gemoji';
import { getHighlighterInstance } from './syntax-highlighter.js';

// Configure marked for safe rendering with GitHub-flavored markdown
// NOTE: Async work (syntax highlighting) is done in walkTokens, which runs
// before the synchronous parse step. Renderers must be synchronous.
marked.use({
  gfm: true,
  breaks: true,
});

// Async extension: use walkTokens for async work, keep renderers synchronous
marked.use({
  async: true,
  async walkTokens(token: any) {
    if (token.type === 'code' && token.lang) {
      try {
        const highlighter = await getHighlighterInstance();
        const loadedLanguages = highlighter.getLoadedLanguages();
        if (loadedLanguages.includes(token.lang as any)) {
          token._highlighted = highlighter.codeToHtml(token.text, {
            lang: token.lang,
            theme: 'github-light',
          });
        }
      } catch (err) {
        console.error('Markdown code highlighting failed:', err);
      }
    }
  },
  renderer: {
    link({ href, title, tokens }: any) {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    listitem({ text, task, checked }: any) {
      if (task) {
        const checkbox = checked
          ? '<input type="checkbox" checked>'
          : '<input type="checkbox">';
        return `<li class="task-list-item">${checkbox} ${text}</li>`;
      }
      return `<li>${text}</li>`;
    },
    code({ text, lang, _highlighted }: any) {
      if (_highlighted) return _highlighted;
      if (lang) {
        return `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(text)}</code></pre>`;
      }
      return `<pre><code>${escapeHtml(text)}</code></pre>`;
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
export async function renderMarkdown(markdown: string | null | undefined): Promise<string> {
  if (!markdown) return '';

  try {
    // Convert emoji shortcodes (like :thumbsup:) to emoji before markdown processing
    const withEmoji = convertEmoji(markdown);
    return await marked(withEmoji) as string;
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
