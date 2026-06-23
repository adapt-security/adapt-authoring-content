/**
 * Efficient tree abstraction over a flat array of course content items.
 * Builds O(1) lookup indexes on construction for parent-child, type, and ID queries.
 * Pure data structure with no DB access — works on both server and client.
 * @memberof content
 */
class ContentTree {
  /**
   * @param {Array<Object>} items Flat array of content items (from a single course)
   */
  constructor (items) {
    /** @type {Array<Object>} */
    this.items = items
    /** @type {Map<string, Object>} _id -> item */
    this.byId = new Map()
    /** @type {Map<string, Array<Object>>} _parentId -> [children] */
    this.byParent = new Map()
    /** @type {Map<string, Array<Object>>} _type -> [items] */
    this.byType = new Map()
    /** @type {Object|null} */
    this.course = null
    /** @type {Object|null} */
    this.config = null

    for (const item of items) {
      const id = item._id.toString()
      this.byId.set(id, item)

      const parentId = item._parentId?.toString()
      if (parentId) {
        if (!this.byParent.has(parentId)) this.byParent.set(parentId, [])
        this.byParent.get(parentId).push(item)
      }

      const type = item._type
      if (!this.byType.has(type)) this.byType.set(type, [])
      this.byType.get(type).push(item)

      if (type === 'course') this.course = item
      if (type === 'config') this.config = item
    }
  }

  /**
   * O(1) lookup by ID
   * @param {string|Object} id
   * @returns {Object|undefined}
   */
  getById (id) {
    return this.byId.get(id.toString())
  }

  /**
   * O(1) children lookup
   * @param {string|Object} parentId
   * @returns {Array<Object>}
   */
  getChildren (parentId) {
    return this.byParent.get(parentId.toString()) ?? []
  }

  /**
   * O(1) type lookup
   * @param {string} type
   * @returns {Array<Object>}
   */
  getByType (type) {
    return this.byType.get(type) ?? []
  }

  /**
   * BFS traversal to find all descendants. O(n) where n = number of descendants.
   * @param {string|Object} rootId
   * @returns {Array<Object>}
   */
  getDescendants (rootId) {
    const descendants = []
    const queue = [rootId.toString()]
    let head = 0
    while (head < queue.length) {
      const children = this.byParent.get(queue[head++]) ?? []
      for (const child of children) {
        descendants.push(child)
        queue.push(child._id.toString())
      }
    }
    return descendants
  }

  /**
   * Walk up the parent chain. O(d) where d = depth.
   * @param {string|Object} itemId
   * @returns {Array<Object>}
   */
  getAncestors (itemId) {
    const ancestors = []
    let current = this.byId.get(itemId.toString())
    while (current?._parentId) {
      current = this.byId.get(current._parentId.toString())
      if (current) ancestors.push(current)
    }
    return ancestors
  }

  /**
   * O(1) siblings lookup (excludes the item itself)
   * @param {string|Object} itemId
   * @returns {Array<Object>}
   */
  getSiblings (itemId) {
    const id = itemId.toString()
    const item = this.byId.get(id)
    if (!item?._parentId) return []
    return this.getChildren(item._parentId).filter(c => c._id.toString() !== id)
  }

  /**
   * Finds container items that have no children. Components are leaf nodes and
   * config is a childless root — both are exempt; every other type (course, menu,
   * page, article, block) is expected to contain at least one child.
   * @returns {Array<Object>} Childless container items
   */
  getEmptyContainers () {
    return this.items.filter(i =>
      i._type !== 'component' &&
      i._type !== 'config' &&
      this.getChildren(i._id).length === 0
    )
  }

  /**
   * Whether an item's _parentId chain terminates at the course root. Returns false
   * when a link in the chain points at an item missing from the tree (e.g. a block
   * whose parent article was deleted) or forms a cycle.
   * @param {string|Object} itemId
   * @returns {boolean}
   */
  isReachable (itemId) {
    let current = this.byId.get(itemId.toString())
    if (!current) return false
    const seen = new Set()
    while (current?._parentId) {
      const id = current._id.toString()
      if (seen.has(id)) return false
      seen.add(id)
      current = this.byId.get(current._parentId.toString())
      if (!current) return false
    }
    return current === this.course
  }

  /**
   * Items whose _parentId chain does not reach the course root (orphans), excluding
   * the course and config (childless roots). Orphans are invisible in the editor yet
   * still returned by flat _courseId queries, so they break a build. Returns [] when
   * the tree has no course node, since reachability cannot be determined.
   * @returns {Array<Object>} Orphaned items
   */
  getUnreachableItems () {
    if (!this.course) return []
    return this.items.filter(i =>
      i._type !== 'course' &&
      i._type !== 'config' &&
      !this.isReachable(i._id)
    )
  }

  /**
   * O(1) — unique component names across the course
   * @returns {Array<string>}
   */
  getComponentNames () {
    const names = new Set()
    for (const c of this.getByType('component')) names.add(c._component)
    return [...names]
  }
}

export default ContentTree
