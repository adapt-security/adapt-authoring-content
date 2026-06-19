import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import treeEtag from '../lib/utils/treeEtag.js'

const updatedAt = new Date('2026-06-18T17:34:00.123Z')

describe('treeEtag', () => {
  it('produces a quoted weak ETag', () => {
    assert.match(treeEtag(updatedAt, ['_id', 'title']), /^W\/".+"$/)
  })

  it('is stable for the same inputs', () => {
    assert.equal(treeEtag(updatedAt, ['_id', 'title']), treeEtag(updatedAt, ['_id', 'title']))
  })

  it('is independent of field order', () => {
    assert.equal(treeEtag(updatedAt, ['_id', 'title']), treeEtag(updatedAt, ['title', '_id']))
  })

  it('changes when the field set changes (shape bust)', () => {
    assert.notEqual(treeEtag(updatedAt, ['_id', 'title']), treeEtag(updatedAt, ['_id', 'title', 'heroImage']))
  })

  it('changes when updatedAt changes (data bust)', () => {
    assert.notEqual(treeEtag(updatedAt, ['_id']), treeEtag(new Date('2026-06-19T00:00:00Z'), ['_id']))
  })

  it('accepts Date, string and numeric timestamps equivalently', () => {
    const fields = ['_id', 'title']
    assert.equal(treeEtag(updatedAt, fields), treeEtag(updatedAt.toISOString(), fields))
    assert.equal(treeEtag(updatedAt, fields), treeEtag(updatedAt.getTime(), fields))
  })

  it('treats a missing field list as empty', () => {
    assert.match(treeEtag(updatedAt), /^W\/".+"$/)
    assert.equal(treeEtag(updatedAt), treeEtag(updatedAt, []))
  })
})
