// @ts-ignore - asciidoctor types are incomplete
import Asciidoctor from 'asciidoctor';

// Initialize Asciidoctor
// @ts-ignore - asciidoctor types are incomplete
const asciidoctor = Asciidoctor();

// Render AsciiDoc to HTML
export function renderAsciidoc(content: string): string {
  try {
    return asciidoctor.convert(content, {
      safe: 'safe',
      attributes: {
        'showtitle': true,
        'icons': 'font',
      }
    }) as string;
  } catch (err) {
    console.error('AsciiDoc rendering error:', err);
    return `<pre>${escapeHtml(content)}</pre>`;
  }
}

// Escape HTML for plain text display
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
