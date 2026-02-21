/**
 * Finds all descendant content items for a given root using BFS traversal
 * @param {Function} findFn Function to query content items (receives query object, returns array)
 * @param {Object} rootItem The root item document
 * @returns {Promise<Array<Object>>} Array of descendant content items
 * @memberof content
 */
export async function getDescendants (findFn, rootItem) {
  const courseItems = await findFn({ _courseId: rootItem._courseId })
  const descendants = []
  let items = [rootItem]
  do {
    items = items.reduce((m, i) => [...m, ...courseItems.filter(c => c._parentId?.toString() === i._id.toString())], [])
    descendants.push(...items)
  } while (items.length)

  if (rootItem._type === 'course') {
    const config = courseItems.find(c => c._type === 'config')
    if (config) descendants.push(config)
  }
  return descendants
}
