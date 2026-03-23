/**
 * Computes the bulk-write operations needed to recalculate _sortOrder values.
 * Optionally splices the target item into the siblings list at the correct position.
 * @param {Array<Object>} siblings Existing siblings sorted by _sortOrder (excluding the item)
 * @param {Object} [item] The item being inserted/moved — omit when deleting
 * @return {Array<Object>} Array of MongoDB updateOne operations
 */
export default function computeSortOrderOps (siblings, item) {
  if (item) {
    const newSO = item._sortOrder != null && item._sortOrder - 1 > -1 ? item._sortOrder - 1 : siblings.length
    siblings.splice(newSO, 0, item)
  }
  const ops = []
  for (let i = 0; i < siblings.length; i++) {
    const _sortOrder = i + 1
    if (siblings[i]._sortOrder !== _sortOrder) {
      ops.push({ updateOne: { filter: { _id: siblings[i]._id }, update: { $set: { _sortOrder } } } })
    }
  }
  return ops
}
