import { createHash } from 'crypto'
/**
 * Builds a weak ETag for the content tree response. Combines the course's
 * `updatedAt` with a hash of the projected field list, so the cache
 * invalidates both when the course data changes AND when the tree response
 * *shape* changes (e.g. a field is added to the projection). Keying solely on
 * `updatedAt` served stale bodies to unedited courses after a shape change —
 * a newly-projected field was missing until the course happened to be edited.
 * @param {Date|string|number} updatedAt Course updatedAt
 * @param {Array<string>} fields Projected tree field names
 * @return {string} Weak ETag value (quoted, `W/`-prefixed)
 */
export default function treeEtag (updatedAt, fields) {
  const shape = createHash('sha1').update([...(fields ?? [])].sort().join(',')).digest('hex').slice(0, 8)
  return `W/"${new Date(updatedAt).getTime()}-${shape}"`
}
