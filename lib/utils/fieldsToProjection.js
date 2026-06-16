/**
 * Builds a MongoDB inclusion projection from a list of field names, mapping
 * each to `1` (e.g. `['_id', 'title']` -> `{ _id: 1, title: 1 }`). Lets a
 * handler declare its projected fields as a readable one-per-line array.
 * @param {Array<string>} fields Field names to include
 * @return {Object} Inclusion projection
 */
export default function fieldsToProjection (fields) {
  return Object.fromEntries((fields ?? []).map(field => [field, 1]))
}
