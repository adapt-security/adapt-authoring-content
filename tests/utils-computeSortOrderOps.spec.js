import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import computeSortOrderOps from '../lib/utils/computeSortOrderOps.js'

describe('computeSortOrderOps', () => {
  it('returns empty array when all siblings already have correct _sortOrder', () => {
    const siblings = [
      { _id: 'a', _sortOrder: 1 },
      { _id: 'b', _sortOrder: 2 }
    ]
    assert.deepEqual(computeSortOrderOps(siblings), [])
  })

  it('returns ops to fix incorrect _sortOrder values', () => {
    const siblings = [
      { _id: 'a', _sortOrder: 3 },
      { _id: 'b', _sortOrder: 5 }
    ]
    const ops = computeSortOrderOps(siblings)
    assert.equal(ops.length, 2)
    assert.deepEqual(ops[0], { updateOne: { filter: { _id: 'a' }, update: { $set: { _sortOrder: 1 } } } })
    assert.deepEqual(ops[1], { updateOne: { filter: { _id: 'b' }, update: { $set: { _sortOrder: 2 } } } })
  })

  it('returns empty array for empty siblings', () => {
    assert.deepEqual(computeSortOrderOps([]), [])
  })

  describe('with item insertion', () => {
    it('appends item to end when _sortOrder is null', () => {
      const siblings = [
        { _id: 'a', _sortOrder: 1 }
      ]
      const item = { _id: 'new', _sortOrder: null }
      const ops = computeSortOrderOps(siblings, item)
      assert.equal(ops.length, 1)
      assert.deepEqual(ops[0], { updateOne: { filter: { _id: 'new' }, update: { $set: { _sortOrder: 2 } } } })
    })

    it('appends item to end when _sortOrder is undefined', () => {
      const siblings = [
        { _id: 'a', _sortOrder: 1 }
      ]
      const item = { _id: 'new' }
      const ops = computeSortOrderOps(siblings, item)
      assert.equal(ops.length, 1)
      assert.deepEqual(ops[0], { updateOne: { filter: { _id: 'new' }, update: { $set: { _sortOrder: 2 } } } })
    })

    it('inserts item at position based on _sortOrder', () => {
      const siblings = [
        { _id: 'a', _sortOrder: 1 },
        { _id: 'b', _sortOrder: 2 }
      ]
      const item = { _id: 'new', _sortOrder: 2 }
      const ops = computeSortOrderOps(siblings, item)
      // item spliced at index 1 (_sortOrder - 1 = 1)
      // result: [a, new, b] -> sortOrders [1, 2, 3]
      // a already has _sortOrder 1, new already has 2, only b needs updating 2→3
      assert.equal(ops.length, 1)
      assert.deepEqual(ops[0], { updateOne: { filter: { _id: 'b' }, update: { $set: { _sortOrder: 3 } } } })
    })

    it('appends to end when _sortOrder is 0', () => {
      const siblings = [
        { _id: 'a', _sortOrder: 1 },
        { _id: 'b', _sortOrder: 2 }
      ]
      const item = { _id: 'new', _sortOrder: 0 }
      const ops = computeSortOrderOps(siblings, item)
      // _sortOrder - 1 = -1, which is not > -1, so appends to end
      assert.equal(ops.length, 1)
      assert.deepEqual(ops[0], { updateOne: { filter: { _id: 'new' }, update: { $set: { _sortOrder: 3 } } } })
    })

    it('inserts into empty siblings list', () => {
      const item = { _id: 'new', _sortOrder: null }
      const ops = computeSortOrderOps([], item)
      assert.equal(ops.length, 1)
      assert.deepEqual(ops[0], { updateOne: { filter: { _id: 'new' }, update: { $set: { _sortOrder: 1 } } } })
    })

    it('only returns ops for items that need updating', () => {
      const siblings = [
        { _id: 'a', _sortOrder: 1 },
        { _id: 'b', _sortOrder: 3 }
      ]
      const item = { _id: 'new', _sortOrder: 2 }
      const ops = computeSortOrderOps(siblings, item)
      // result: [a, new, b] -> [1, 2, 3] — a=1 ok, new=2 ok, b=3 ok — no ops needed
      assert.equal(ops.length, 0)
    })
  })
})
