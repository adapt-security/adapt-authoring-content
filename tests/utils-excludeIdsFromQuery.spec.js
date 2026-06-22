import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { excludeIdsFromQuery } from '../lib/utils/excludeIdsFromQuery.js'

describe('excludeIdsFromQuery', () => {
  it('is a no-op for empty/falsy ids', () => {
    const query = { type: 'image' }
    excludeIdsFromQuery(query, [])
    excludeIdsFromQuery(query, undefined)
    assert.deepEqual(query, { type: 'image' })
  })

  it('adds a $nin _id constraint when none exists', () => {
    const query = { type: 'image' }
    excludeIdsFromQuery(query, ['a', 'b'])
    assert.deepEqual(query, { type: 'image', _id: { $nin: ['a', 'b'] } })
  })

  it('preserves an existing _id constraint via $and', () => {
    const query = { _id: { $in: ['keep'] } }
    excludeIdsFromQuery(query, ['drop'])
    assert.deepEqual(query, {
      $and: [
        { _id: { $in: ['keep'] } },
        { _id: { $nin: ['drop'] } }
      ]
    })
    assert.ok(!('_id' in query))
  })

  it('appends to an existing $and', () => {
    const query = { $and: [{ a: 1 }], _id: 'x' }
    excludeIdsFromQuery(query, ['y'])
    assert.deepEqual(query.$and, [
      { a: 1 },
      { _id: 'x' },
      { _id: { $nin: ['y'] } }
    ])
  })
})
