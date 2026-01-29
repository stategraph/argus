/**
 * Syntax Highlighter using Shiki
 * Provides server-side syntax highlighting for code diffs
 */

import { createHighlighter, type Highlighter } from 'shiki';

let highlighterInstance: Highlighter | null = null;

/**
 * Get or create the Shiki highlighter instance (singleton)
 */
export async function getHighlighterInstance(): Promise<Highlighter> {
  if (!highlighterInstance) {
    highlighterInstance = await createHighlighter({
      themes: ['github-light'],
      langs: [
        'javascript',
        'typescript',
        'python',
        'java',
        'go',
        'rust',
        'c',
        'cpp',
        'csharp',
        'ruby',
        'php',
        'html',
        'css',
        'json',
        'yaml',
        'markdown',
        'shell',
        'sql',
        'bash',
        'dockerfile',
        'xml',
        'ocaml',
      ],
    });
  }
  return highlighterInstance;
}

/**
 * Detect programming language from file extension
 */
export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;

  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'css',
    sass: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'shell',
    bash: 'bash',
    sql: 'sql',
    dockerfile: 'dockerfile',
    xml: 'xml',
    ml: 'ocaml',
    mli: 'ocaml',
  };

  return languageMap[ext] || null;
}

/**
 * Highlight code using Shiki (returns HTML with inline styles)
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
  try {
    const highlighter = await getHighlighterInstance();

    // Check if language is supported
    const loadedLanguages = highlighter.getLoadedLanguages();
    if (!loadedLanguages.includes(lang as any)) {
      // Language not supported, return escaped code
      return escapeHtml(code);
    }

    // Use codeToHtml with inline styles
    const html = highlighter.codeToHtml(code, {
      lang,
      theme: 'github-light',
    });

    // Extract just the code content (remove pre/code wrapper tags)
    // The codeToHtml returns: <pre class="..."><code>...</code></pre>
    // We just want the inner content with spans
    const match = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
    if (match && match[1]) {
      // Remove line breaks that Shiki adds, we handle lines ourselves
      return match[1].replace(/\n/g, '');
    }

    return escapeHtml(code);
  } catch (err) {
    console.error('Syntax highlighting failed:', err);
    return escapeHtml(code);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
