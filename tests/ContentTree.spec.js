import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ContentTree from '../lib/ContentTree.js'

describe('ContentTree', () => {
  const makeId = (n) => ({ toString: () => `id${n}` })

  const items = [
    { _id: makeId(1), _type: 'course', _courseId: 'c1' },
    { _id: makeId(2), _type: 'config', _courseId: 'c1' },
    { _id: makeId(3), _type: 'page', _courseId: 'c1', _parentId: makeId(1) },
    { _id: makeId(4), _type: 'menu', _courseId: 'c1', _parentId: makeId(1) },
    { _id: makeId(5), _type: 'article', _courseId: 'c1', _parentId: makeId(3) },
    { _id: makeId(6), _type: 'article', _courseId: 'c1', _parentId: makeId(3) },
    { _id: makeId(7), _type: 'block', _courseId: 'c1', _parentId: makeId(5) },
    { _id: makeId(8), _type: 'block', _courseId: 'c1', _parentId: makeId(5) },
    { _id: makeId(9), _type: 'component', _courseId: 'c1', _parentId: makeId(7), _component: 'adapt-contrib-text' },
    { _id: makeId(10), _type: 'component', _courseId: 'c1', _parentId: makeId(8), _component: 'adapt-contrib-media' }
  ]

  describe('constructor', () => {
    it('should index all items by id', () => {
      const tree = new ContentTree(items)
      assert.equal(tree.byId.size, 10)
      assert.strictEqual(tree.byId.get('id1'), items[0])
    })

    it('should set course and config references', () => {
      const tree = new ContentTree(items)
      assert.strictEqual(tree.course, items[0])
      assert.strictEqual(tree.config, items[1])
    })

    it('should handle items with no course or config', () => {
      const tree = new ContentTree([
        { _id: makeId(1), _type: 'page', _parentId: makeId(99) }
      ])
      assert.equal(tree.course, null)
      assert.equal(tree.config, null)
    })

    it('should store items array', () => {
      const tree = new ContentTree(items)
      assert.strictEqual(tree.items, items)
    })

    it('should handle empty items array', () => {
      const tree = new ContentTree([])
      assert.equal(tree.byId.size, 0)
      assert.equal(tree.course, null)
      assert.equal(tree.config, null)
    })
  })

  describe('getById', () => {
    it('should return item by string id', () => {
      const tree = new ContentTree(items)
      assert.strictEqual(tree.getById('id3'), items[2])
    })

    it('should return item by object with toString', () => {
      const tree = new ContentTree(items)
      assert.strictEqual(tree.getById(makeId(3)), items[2])
    })

    it('should return undefined for non-existent id', () => {
      const tree = new ContentTree(items)
      assert.equal(tree.getById('missing'), undefined)
    })
  })

  describe('getChildren', () => {
    it('should return children of a parent', () => {
      const tree = new ContentTree(items)
      const children = tree.getChildren('id1')
      assert.equal(children.length, 2)
      assert.ok(children.some(c => c._type === 'page'))
      assert.ok(children.some(c => c._type === 'menu'))
    })

    it('should return empty array for leaf nodes', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getChildren('id9'), [])
    })

    it('should return empty array for non-existent parent', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getChildren('missing'), [])
    })

    it('should accept object with toString', () => {
      const tree = new ContentTree(items)
      const children = tree.getChildren(makeId(1))
      assert.equal(children.length, 2)
    })
  })

  describe('getByType', () => {
    it('should return all items of a given type', () => {
      const tree = new ContentTree(items)
      assert.equal(tree.getByType('article').length, 2)
      assert.equal(tree.getByType('component').length, 2)
      assert.equal(tree.getByType('course').length, 1)
    })

    it('should return empty array for non-existent type', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getByType('unknown'), [])
    })
  })

  describe('getDescendants', () => {
    it('should return all descendants of the course root', () => {
      const tree = new ContentTree(items)
      const desc = tree.getDescendants('id1')
      // page, menu, 2 articles, 2 blocks, 2 components = 8 (config excluded since it has no _parentId chain to course)
      assert.equal(desc.length, 8)
    })

    it('should return all descendants of a page', () => {
      const tree = new ContentTree(items)
      const desc = tree.getDescendants('id3')
      // 2 articles, 2 blocks, 2 components = 6
      assert.equal(desc.length, 6)
    })

    it('should return all descendants of an article', () => {
      const tree = new ContentTree(items)
      const desc = tree.getDescendants('id5')
      // 2 blocks, 2 components = 4
      assert.equal(desc.length, 4)
    })

    it('should return empty array for leaf nodes', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getDescendants('id9'), [])
    })

    it('should return empty array for non-existent id', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getDescendants('missing'), [])
    })

    it('should not include the root item itself', () => {
      const tree = new ContentTree(items)
      const desc = tree.getDescendants('id3')
      assert.ok(!desc.some(d => d._id.toString() === 'id3'))
    })
  })

  describe('getAncestors', () => {
    it('should return ancestors from leaf to root', () => {
      const tree = new ContentTree(items)
      const ancestors = tree.getAncestors('id9')
      // block -> article -> page -> course
      assert.equal(ancestors.length, 4)
      assert.equal(ancestors[0]._type, 'block')
      assert.equal(ancestors[1]._type, 'article')
      assert.equal(ancestors[2]._type, 'page')
      assert.equal(ancestors[3]._type, 'course')
    })

    it('should return empty array for root items', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getAncestors('id1'), [])
    })

    it('should return empty array for config (no _parentId)', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getAncestors('id2'), [])
    })

    it('should return empty array for non-existent id', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getAncestors('missing'), [])
    })
  })

  describe('getSiblings', () => {
    it('should return siblings excluding the item itself', () => {
      const tree = new ContentTree(items)
      const siblings = tree.getSiblings('id5')
      assert.equal(siblings.length, 1)
      assert.equal(siblings[0]._id.toString(), 'id6')
    })

    it('should return empty array for items with no _parentId', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getSiblings('id1'), [])
    })

    it('should return empty array for only children', () => {
      const tree = new ContentTree(items)
      const siblings = tree.getSiblings('id9')
      assert.equal(siblings.length, 0)
    })

    it('should return empty array for non-existent id', () => {
      const tree = new ContentTree(items)
      assert.deepEqual(tree.getSiblings('missing'), [])
    })
  })

  describe('getComponentNames', () => {
    it('should return unique component names', () => {
      const tree = new ContentTree(items)
      const names = tree.getComponentNames()
      assert.equal(names.length, 2)
      assert.ok(names.includes('adapt-contrib-text'))
      assert.ok(names.includes('adapt-contrib-media'))
    })

    it('should deduplicate component names', () => {
      const dupeItems = [
        { _id: makeId(1), _type: 'component', _component: 'adapt-contrib-text' },
        { _id: makeId(2), _type: 'component', _component: 'adapt-contrib-text' },
        { _id: makeId(3), _type: 'component', _component: 'adapt-contrib-media' }
      ]
      const tree = new ContentTree(dupeItems)
      assert.equal(tree.getComponentNames().length, 2)
    })

    it('should return empty array when no components exist', () => {
      const tree = new ContentTree([
        { _id: makeId(1), _type: 'course' }
      ])
      assert.deepEqual(tree.getComponentNames(), [])
    })
  })
})
