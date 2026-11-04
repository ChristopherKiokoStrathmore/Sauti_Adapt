/**
 * Turn the model's Markdown-ish output into a small, escaped HTML subset
 * (headings, bold, italic, lists, paragraphs). Input is escaped first, so the
 * only tags in the result are the ones produced here.
 */
export function formatAISummary(text: string): string {
  if (!text) return '';

  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  formatted = formatted
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>');

  formatted = formatted
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>');

  formatted = formatted
    .replace(/\*([^*\s][^*]*?[^*\s])\*/g, '<em>$1</em>')
    .replace(/_([^_\s][^_]*?[^_\s])_/g, '<em>$1</em>');

  // Bullet markers: *, - or •. (Nutshell's gaze copy wrote [\*-•], a range that
  // matched every letter, so any "I think…" line became a bullet.)
  formatted = formatted.replace(/^[*\-•] (.+)$/gm, '<li>$1</li>');
  formatted = formatted.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  formatted = formatted.replace(/(<li>.*?<\/li>\n?)+/g, (match) => '<ul>' + match.replace(/\n/g, '') + '</ul>');

  formatted = formatted.replace(/\n\n+/g, '</p><p>');
  formatted = formatted.replace(/\n/g, '<br>');

  if (!formatted.startsWith('<h') && !formatted.startsWith('<ul') && !formatted.startsWith('<p>')) {
    formatted = '<p>' + formatted;
  }
  if (!/<\/(p|ul|h2|h3|h4)>$/.test(formatted)) {
    formatted = formatted + '</p>';
  }

  formatted = formatted
    .replace(/<p><\/p>/g, '')
    .replace(/<p>\s*<\/p>/g, '');

  formatted = formatted
    .replace(/<p>(<h\d>)/g, '$1')
    .replace(/(<\/h\d>)<\/p>/g, '$1')
    .replace(/<p>(<ul>)/g, '$1')
    .replace(/(<\/ul>)<\/p>/g, '$1');

  return formatted;
}

export function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
