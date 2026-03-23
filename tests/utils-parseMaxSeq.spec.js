import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import parseMaxSeq from '../lib/utils/parseMaxSeq.js'

describe('parseMaxSeq', () => {
  const idInterval = 5

  it('returns 0 for empty docs array', () => {
    assert.equal(parseMaxSeq([], 'block', idInterval), 0)
  })

  it('returns max number for course type without dividing', () => {
    const docs = [
      { _friendlyId: 'course-3' },
      { _friendlyId: 'course-7' },
      { _friendlyId: 'course-2' }
    ]
    assert.equal(parseMaxSeq(docs, 'course', idInterval), 7)
  })

  it('divides by idInterval for non-course types', () => {
    const docs = [
      { _friendlyId: 'b-10' },
      { _friendlyId: 'b-25' },
      { _friendlyId: 'b-5' }
    ]
    assert.equal(parseMaxSeq(docs, 'block', idInterval), 5)
  })

  it('floors the result of division', () => {
    const docs = [{ _friendlyId: 'a-13' }]
    assert.equal(parseMaxSeq(docs, 'article', idInterval), 2)
  })

  it('skips docs with no _friendlyId', () => {
    const docs = [
      { _friendlyId: 'p-10' },
      {},
      { _friendlyId: undefined }
    ]
    assert.equal(parseMaxSeq(docs, 'page', idInterval), 2)
  })

  it('skips docs with no numeric portion', () => {
    const docs = [
      { _friendlyId: 'config' },
      { _friendlyId: 'p-15' }
    ]
    assert.equal(parseMaxSeq(docs, 'page', idInterval), 3)
  })
})
