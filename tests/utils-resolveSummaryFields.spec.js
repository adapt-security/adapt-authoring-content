import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import resolveSummaryFields from '../lib/utils/resolveSummaryFields.js'

/** Minimal Schema stand-in: mirrors Schema.walk, returning matches with schemaField. */
function mockSchema (properties) {
  const walk = (data, predicate, schema = properties, parentPath = '') => {
    const matches = []
    for (const [key, schemaField] of Object.entries(schema)) {
      if (data?.[key] === undefined) continue
      const currentPath = parentPath ? `${parentPath}/${key}` : key
      if (schemaField.properties) {
        matches.push(...walk(data[key], predicate, schemaField.properties, currentPath))
      } else if (schemaField?.items?.properties) {
        data[key].forEach((item, i) => matches.push(...walk(item, predicate, schemaField.items.properties, `${currentPath}/${i}`)))
      } else if (predicate(schemaField)) {
        matches.push({ path: currentPath, key, data, value: data[key], schemaField })
      }
    }
    return matches
  }
  return { built: { properties }, walk }
}

describe('resolveSummaryFields()', () => {
  it('uses the override config map when present for the component', () => {
    const schema = mockSchema({ body: { type: 'string' } })
    const result = resolveSummaryFields(schema, { body: 'x' }, 'mcq', { mcq: ['body', '_items[].text'] })
    assert.deepEqual(result, ['body', '_items[].text'])
  })

  it('ignores an empty override array and falls through', () => {
    const schema = mockSchema({ body: { type: 'string' } })
    assert.deepEqual(resolveSummaryFields(schema, { body: 'x' }, 'mcq', { mcq: [] }), ['body', 'instruction'])
  })

  it('discovers annotated fields and converts paths to selectors', () => {
    const schema = mockSchema({
      _graphic: { properties: { src: { _backboneForms: 'Asset', _adapt: { summary: true } } } },
      _items: { items: { properties: { text: { type: 'string', _adapt: { summary: true } } } } }
    })
    const data = { _graphic: { src: 'a1' }, _items: [{ text: 'one' }, { text: 'two' }] }
    const result = resolveSummaryFields(schema, data, 'custom', {})
    assert.deepEqual(result, ['_graphic.src', '_items[].text'])
  })

  it('orders annotations by _adapt.summary.order and dedupes array selectors', () => {
    const schema = mockSchema({
      body: { type: 'string', _adapt: { summary: { order: 2 } } },
      _items: { items: { properties: { text: { type: 'string', _adapt: { summary: { order: 1 } } } } } }
    })
    const data = { body: 'b', _items: [{ text: 'a' }, { text: 'b' }] }
    assert.deepEqual(resolveSummaryFields(schema, data, 'custom', {}), ['_items[].text', 'body'])
  })

  it('falls back to body + instruction when no override and no annotations', () => {
    const schema = mockSchema({ body: { type: 'string' } })
    assert.deepEqual(resolveSummaryFields(schema, { body: 'x' }, 'unknown', {}), ['body', 'instruction'])
  })
})
