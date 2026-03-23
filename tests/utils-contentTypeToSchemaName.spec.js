import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import contentTypeToSchemaName from '../lib/utils/contentTypeToSchemaName.js'

describe('contentTypeToSchemaName', () => {
  const cases = [
    { _type: 'page', expected: 'contentobject' },
    { _type: 'menu', expected: 'contentobject' },
    { _type: 'article', expected: 'article' },
    { _type: 'block', expected: 'block' },
    { _type: 'component', expected: 'component' },
    { _type: 'course', expected: 'course' },
    { _type: 'config', expected: 'config' }
  ]

  for (const { _type, expected } of cases) {
    it(`maps "${_type}" to "${expected}"`, () => {
      assert.equal(contentTypeToSchemaName(_type), expected)
    })
  }
})
