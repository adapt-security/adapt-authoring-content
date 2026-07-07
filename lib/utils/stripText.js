/**
 * Strips HTML tags and collapses whitespace to a single-line plain string. No
 * length cap — summary text cells carry the full value (the UI clamps for display).
 * @param {*} value Raw field value (may contain HTML)
 * @return {String} Plain text
 * @memberof content
 */
export default function stripText (value) {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}
