/**
 * Mutates a mongo query to exclude the given `_id`s. If the query already
 * has an `_id` constraint, both are preserved via `$and` so existing filters
 * are not silently dropped.
 * @param {Object} query The mongo query object to mutate
 * @param {Array} ids Document `_id`s to exclude. Falsy or empty → no-op
 * @memberof content
 */
export function excludeIdsFromQuery (query, ids) {
  if (!ids?.length) return
  const existing = query._id
  if (existing) {
    query.$and = [
      ...(query.$and ?? []),
      { _id: existing },
      { _id: { $nin: ids } }
    ]
    delete query._id
  } else {
    query._id = { $nin: ids }
  }
}
