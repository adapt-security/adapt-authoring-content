import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import partitionCourseAssets from '../lib/utils/partitionCourseAssets.js'

describe('partitionCourseAssets', () => {
  it('marks an asset used by only one course as deletable', () => {
    assert.deepEqual(
      partitionCourseAssets(['a'], { a: 1 }),
      { deletable: ['a'], shared: [] }
    )
  })

  it('marks an asset used by more than one course as shared', () => {
    assert.deepEqual(
      partitionCourseAssets(['a'], { a: 2 }),
      { deletable: [], shared: ['a'] }
    )
  })

  it('treats an asset absent from the counts map as deletable (unused)', () => {
    assert.deepEqual(
      partitionCourseAssets(['a'], {}),
      { deletable: ['a'], shared: [] }
    )
  })

  it('defaults the counts map so a missing second argument is safe', () => {
    assert.deepEqual(
      partitionCourseAssets(['a']),
      { deletable: ['a'], shared: [] }
    )
  })

  it('partitions a mix and preserves input order within each bucket', () => {
    assert.deepEqual(
      partitionCourseAssets(['a', 'b', 'c', 'd'], { a: 1, b: 3, c: 1, d: 2 }),
      { deletable: ['a', 'c'], shared: ['b', 'd'] }
    )
  })

  it('returns empty buckets for no asset ids', () => {
    assert.deepEqual(
      partitionCourseAssets([], { a: 5 }),
      { deletable: [], shared: [] }
    )
  })
})
