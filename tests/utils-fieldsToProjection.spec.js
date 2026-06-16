import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fieldsToProjection from '../lib/utils/fieldsToProjection.js'

describe('fieldsToProjection', () => {
  it('maps each field name to 1', () => {
    assert.deepEqual(fieldsToProjection(['_id', 'title']), { _id: 1, title: 1 })
  })

  it('returns an empty projection for an empty array', () => {
    assert.deepEqual(fieldsToProjection([]), {})
  })

  it('treats a missing argument as empty', () => {
    assert.deepEqual(fieldsToProjection(), {})
    assert.deepEqual(fieldsToProjection(undefined), {})
  })

  it('collapses duplicate field names to a single key', () => {
    assert.deepEqual(fieldsToProjection(['_id', '_id', 'title']), { _id: 1, title: 1 })
  })
})
