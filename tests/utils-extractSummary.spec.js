import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import extractSummary from '../lib/utils/extractSummary.js'

/** Minimal Schema stand-in: mirrors Schema.walk and exposes built.properties. */
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

const TEXT = { body: { type: 'string' } }

describe('extractSummary()', () => {
  it('builds a scalar text cell from the body fallback', () => {
    const schema = mockSchema(TEXT)
    assert.deepEqual(
      extractSummary(schema, { body: '<p>Hello</p>' }, 'text', {}),
      [{ kind: 'text', label: 'body', text: 'Hello' }]
    )
  })

  it('skips selectors whose value is missing or empty', () => {
    const schema = mockSchema(TEXT)
    assert.deepEqual(extractSummary(schema, { body: '' }, 'text', {}), [])
    assert.deepEqual(extractSummary(schema, {}, 'text', {}), [])
  })

  it('resolves an asset selector to an asset cell with the id only', () => {
    const schema = mockSchema({ _graphic: { properties: { src: { _backboneForms: 'Asset' } } } })
    assert.deepEqual(
      extractSummary(schema, { _graphic: { src: 'img1' } }, 'graphic', { graphic: ['_graphic.src'] }),
      [{ kind: 'asset', label: 'src', assetId: 'img1' }]
    )
  })

  it('builds a collection cell holding ALL items (no cap)', () => {
    const schema = mockSchema({ _items: { type: 'array', items: { properties: { text: { type: 'string' } } } } })
    const data = { _items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] }
    const [cell] = extractSummary(schema, data, 'mcq', { mcq: ['_items[].text'] })
    assert.equal(cell.kind, 'collection')
    assert.equal(cell.count, 4)
    assert.equal(cell.items.length, 4)
    assert.deepEqual(cell.items.map(i => i.text), ['a', 'b', 'c', 'd'])
  })

  it('reduces collection items to leaf cells (never nested collections)', () => {
    const schema = mockSchema({ _items: { type: 'array', items: { properties: { src: { _backboneForms: 'Asset' } } } } })
    const data = { _items: [{ src: 'a1' }, { src: 'a2' }] }
    const [cell] = extractSummary(schema, data, 'x', { x: ['_items[].src'] })
    assert.deepEqual(cell.items, [{ kind: 'asset', assetId: 'a1' }, { kind: 'asset', assetId: 'a2' }])
  })

  it('picks a heuristic item field for a bare array selector', () => {
    const schema = mockSchema({ _items: { type: 'array', items: { properties: { title: { type: 'string' } } } } })
    const data = { _items: [{ title: 'one' }, { title: 'two' }] }
    const [cell] = extractSummary(schema, data, 'accordion', { accordion: ['_items'] })
    assert.equal(cell.kind, 'collection')
    assert.deepEqual(cell.items.map(i => i.text), ['one', 'two'])
  })

  it('returns count-only collection when no item field can be resolved', () => {
    const schema = mockSchema({ _items: { type: 'array', items: { properties: { _n: { type: 'number' } } } } })
    const data = { _items: [{ _n: 1 }, { _n: 2 }] }
    const [cell] = extractSummary(schema, data, 'x', { x: ['_items'] })
    assert.equal(cell.count, 2)
    assert.deepEqual(cell.items, [])
  })

  it('yields one cell per selector, in order', () => {
    const schema = mockSchema({
      body: { type: 'string' },
      _items: { type: 'array', items: { properties: { text: { type: 'string' } } } }
    })
    const data = { body: 'q', _items: [{ text: 'a' }] }
    const cells = extractSummary(schema, data, 'mcq', { mcq: ['body', '_items[].text'] })
    assert.deepEqual(cells.map(c => c.kind), ['text', 'collection'])
  })
})
