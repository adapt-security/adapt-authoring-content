/**
 * Formats a friendly ID string from content type, sequence number and optional language
 * @param {String} _type Content type (e.g. 'course', 'block', 'component')
 * @param {Number} count Current sequence number
 * @param {String} [_language] Language code (only used for courses)
 * @return {String}
 */
export default function formatFriendlyId (_type, count, _language) {
  if (!_type) throw new Error('formatFriendlyId requires a _type')
  if (_type === 'course') return `course-${count}${_language ? `-${_language}` : ''}`
  if (_type === 'config') return 'config'
  return `${_type[0]}-${count}`
}
