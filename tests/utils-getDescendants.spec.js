import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getDescendants } from '../lib/utils/getDescendants.js'

describe('getDescendants()', () => {
  const makeId = (n) => ({ toString: () => `id${n}` })

  const courseItems = [
    { _id: makeId(1), _courseId: 'course1', _type: 'course' },
    { _id: makeId(2), _courseId: 'course1', _parentId: makeId(1), _type: 'page' },
    { _id: makeId(3), _courseId: 'course1', _parentId: makeId(2), _type: 'article' },
    { _id: makeId(4), _courseId: 'course1', _parentId: makeId(3), _type: 'block' },
    { _id: makeId(5), _courseId: 'course1', _parentId: makeId(4), _type: 'component' },
    { _id: makeId(6), _courseId: 'course1', _type: 'config' }
  ]

  const findFn = async (query) => {
    return courseItems.filter(c => {
      return Object.entries(query).every(([k, v]) => {
        const itemVal = c[k]
        if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
          return itemVal.toString() === v
        }
        return itemVal === v
      })
    })
  }

  it('should return all descendants of the course (including config)', async () => {
    const root = courseItems[0]
    const result = await getDescendants(findFn, root)
    // Should include page, article, block, component, config = 5 items
    assert.equal(result.length, 5)
    assert.ok(result.some(r => r._type === 'page'))
    assert.ok(result.some(r => r._type === 'article'))
    assert.ok(result.some(r => r._type === 'block'))
    assert.ok(result.some(r => r._type === 'component'))
    assert.ok(result.some(r => r._type === 'config'))
  })

  it('should return descendants of a page', async () => {
    const root = courseItems[1] // page
    const result = await getDescendants(findFn, root)
    // article, block, component = 3
    assert.equal(result.length, 3)
    assert.ok(result.some(r => r._type === 'article'))
    assert.ok(result.some(r => r._type === 'block'))
    assert.ok(result.some(r => r._type === 'component'))
  })

  it('should return descendants of an article', async () => {
    const root = courseItems[2] // article
    const result = await getDescendants(findFn, root)
    // block, component = 2
    assert.equal(result.length, 2)
    assert.ok(result.some(r => r._type === 'block'))
    assert.ok(result.some(r => r._type === 'component'))
  })

  it('should return empty array for a leaf node', async () => {
    const root = courseItems[4] // component (leaf)
    const result = await getDescendants(findFn, root)
    assert.equal(result.length, 0)
  })

  it('should not include config for non-course roots', async () => {
    const root = courseItems[1] // page
    const result = await getDescendants(findFn, root)
    assert.ok(!result.some(r => r._type === 'config'))
  })

  it('should include config for course root', async () => {
    const root = courseItems[0]
    const result = await getDescendants(findFn, root)
    assert.ok(result.some(r => r._type === 'config'))
  })

  it('should handle course with no config', async () => {
    const itemsNoConfig = courseItems.filter(c => c._type !== 'config')
    const findNoConfig = async (query) => {
      return itemsNoConfig.filter(c => {
        return Object.entries(query).every(([k, v]) => {
          const itemVal = c[k]
          if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
            return itemVal.toString() === v
          }
          return itemVal === v
        })
      })
    }
    const root = itemsNoConfig[0] // course
    const result = await getDescendants(findNoConfig, root)
    // page, article, block, component = 4 (no config)
    assert.equal(result.length, 4)
    assert.ok(!result.some(r => r._type === 'config'))
  })

  it('should handle empty course (no children)', async () => {
    const emptyItems = [{ _id: makeId(10), _courseId: 'course10', _type: 'course' }]
    const emptyFind = async () => emptyItems
    const root = emptyItems[0]
    const result = await getDescendants(emptyFind, root)
    assert.equal(result.length, 0)
  })

  it('should use findFn with correct query', async () => {
    const queries = []
    const trackingFind = async (query) => {
      queries.push(query)
      return []
    }
    const root = { _id: makeId(99), _courseId: 'courseX', _type: 'page' }
    await getDescendants(trackingFind, root)
    assert.equal(queries.length, 1)
    assert.deepEqual(queries[0], { _courseId: 'courseX' })
  })
})
