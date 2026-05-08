import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import parseMaxSeq from '../lib/utils/parseMaxSeq.js'

describe('parseMaxSeq', () => {
  it('returns 0 for empty docs array', () => {
    assert.equal(parseMaxSeq([]), 0)
  })

  it('returns max number for course type', () => {
    const docs = [
      { _friendlyId: 'course-3' },
      { _friendlyId: 'course-7' },
      { _friendlyId: 'course-2' }
    ]
    assert.equal(parseMaxSeq(docs), 7)
  })

  it('returns raw max number for non-course types', () => {
    const docs = [
      { _friendlyId: 'b-10' },
      { _friendlyId: 'b-25' },
      { _friendlyId: 'b-5' }
    ]
    assert.equal(parseMaxSeq(docs), 25)
  })

  it('returns raw number without flooring', () => {
    const docs = [{ _friendlyId: 'a-13' }]
    assert.equal(parseMaxSeq(docs), 13)
  })

  it('skips docs with no _friendlyId', () => {
    const docs = [
      { _friendlyId: 'p-10' },
      {},
      { _friendlyId: undefined }
    ]
    assert.equal(parseMaxSeq(docs), 10)
  })

  it('skips docs with no numeric portion', () => {
    const docs = [
      { _friendlyId: 'config' },
      { _friendlyId: 'p-15' }
    ]
    assert.equal(parseMaxSeq(docs), 15)
  })
})
