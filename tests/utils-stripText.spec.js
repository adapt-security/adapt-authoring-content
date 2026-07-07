import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import stripText from '../lib/utils/stripText.js'

describe('stripText()', () => {
  const cases = [
    ['returns empty string for undefined', undefined, ''],
    ['returns empty string for null', null, ''],
    ['passes through plain text', 'hello world', 'hello world'],
    ['strips HTML tags', '<p>hello <b>world</b></p>', 'hello world'],
    ['collapses whitespace', 'a\n\t  b   c', 'a b c'],
    ['trims surrounding whitespace', '  padded  ', 'padded'],
    ['decodes &nbsp;', 'a&nbsp;b', 'a b'],
    ['decodes named entities', '&amp;&lt;&gt;&quot;&#39;', '&<>"\''],
    ['stringifies numbers', 42, '42'],
    ['does not truncate long text', 'x'.repeat(500), 'x'.repeat(500)]
  ]
  for (const [name, input, expected] of cases) {
    it(name, () => assert.equal(stripText(input), expected))
  }
})
