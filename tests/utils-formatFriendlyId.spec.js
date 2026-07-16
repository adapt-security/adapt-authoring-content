import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import formatFriendlyId from '../lib/utils/formatFriendlyId.js'

describe('formatFriendlyId', () => {
  describe('course type', () => {
    it('formats without language', () => {
      assert.equal(formatFriendlyId('course', 1), 'course-1')
    })

    it('formats with language', () => {
      assert.equal(formatFriendlyId('course', 3, 'en'), 'course-3-en')
    })

    it('omits language suffix when _language is empty string', () => {
      assert.equal(formatFriendlyId('course', 2, ''), 'course-2')
    })
  })

  describe('config type', () => {
    it('always returns "config"', () => {
      assert.equal(formatFriendlyId('config'), 'config')
    })
  })

  describe('missing type', () => {
    for (const _type of [undefined, null, '']) {
      it(`throws for _type ${JSON.stringify(_type)}`, () => {
        assert.throws(() => formatFriendlyId(_type, 1), /requires a _type/)
      })
    }
  })

  describe('other types', () => {
    const cases = [
      { _type: 'page', count: 1, expected: 'p-1' },
      { _type: 'article', count: 2, expected: 'a-2' },
      { _type: 'block', count: 3, expected: 'b-3' },
      { _type: 'component', count: 4, expected: 'c-4' }
    ]

    for (const { _type, count, expected } of cases) {
      it(`formats ${_type} with count ${count} as "${expected}"`, () => {
        assert.equal(formatFriendlyId(_type, count), expected)
      })
    }
  })
})
