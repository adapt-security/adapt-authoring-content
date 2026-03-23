import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractAssetIds } from '../lib/utils/extractAssetIds.js'

/**
 * Creates a minimal schema-like object with a walk method that
 * mirrors Schema.walk behaviour for the given properties
 */
function mockSchema (properties) {
  return {
    walk (data, predicate, schema, parentPath = '') {
      schema = schema ?? properties
      const matches = []
      for (const [key, val] of Object.entries(schema)) {
        if (data[key] === undefined) continue
        const currentPath = parentPath ? `${parentPath}/${key}` : key
        if (val.properties) {
          matches.push(...this.walk(data[key], predicate, val.properties, currentPath))
        } else if (val?.items?.properties) {
          data[key].forEach((item, i) => {
            matches.push(...this.walk(item, predicate, val.items.properties, `${currentPath}/${i}`))
          })
        } else if (predicate(val)) {
          matches.push({ path: currentPath, key, data, value: data[key] })
        }
      }
      return matches
    }
  }
}

describe('extractAssetIds()', () => {
  it('should return empty array when no asset fields exist', () => {
    const schema = mockSchema({ title: { type: 'string' } })
    assert.deepEqual(extractAssetIds(schema, { title: 'test' }), [])
  })

  it('should extract asset ID from _backboneForms Asset string type', () => {
    const schema = mockSchema({ image: { _backboneForms: 'Asset' } })
    assert.deepEqual(extractAssetIds(schema, { image: 'abc123' }), ['abc123'])
  })

  it('should extract asset ID from _backboneForms.type Asset', () => {
    const schema = mockSchema({ image: { _backboneForms: { type: 'Asset' } } })
    assert.deepEqual(extractAssetIds(schema, { image: 'abc123' }), ['abc123'])
  })

  it('should skip keys not present in data', () => {
    const schema = mockSchema({ image: { _backboneForms: 'Asset' } })
    assert.deepEqual(extractAssetIds(schema, {}), [])
  })

  it('should skip falsy asset values', () => {
    const schema = mockSchema({ image: { _backboneForms: 'Asset' } })
    assert.deepEqual(extractAssetIds(schema, { image: '' }), [])
  })

  it('should skip HTTP URLs', () => {
    const schema = mockSchema({ image: { _backboneForms: 'Asset' } })
    assert.deepEqual(extractAssetIds(schema, { image: 'http://example.com/image.png' }), [])
  })

  it('should skip HTTPS URLs', () => {
    const schema = mockSchema({ image: { _backboneForms: 'Asset' } })
    assert.deepEqual(extractAssetIds(schema, { image: 'https://example.com/image.png' }), [])
  })

  it('should recurse into nested schema properties', () => {
    const schema = mockSchema({
      _graphic: {
        properties: {
          src: { _backboneForms: 'Asset' }
        }
      }
    })
    assert.deepEqual(extractAssetIds(schema, { _graphic: { src: 'img123' } }), ['img123'])
  })

  it('should recurse into array items with properties', () => {
    const schema = mockSchema({
      _items: {
        items: {
          properties: {
            src: { _backboneForms: 'Asset' }
          }
        }
      }
    })
    assert.deepEqual(extractAssetIds(schema, { _items: [{ src: 'a1' }, { src: 'a2' }] }), ['a1', 'a2'])
  })

  it('should deduplicate asset IDs', () => {
    const schema = mockSchema({
      _items: {
        items: {
          properties: {
            src: { _backboneForms: 'Asset' }
          }
        }
      }
    })
    assert.deepEqual(extractAssetIds(schema, { _items: [{ src: 'same' }, { src: 'same' }] }), ['same'])
  })

  it('should handle toString on non-string asset values', () => {
    const schema = mockSchema({ image: { _backboneForms: 'Asset' } })
    assert.deepEqual(extractAssetIds(schema, { image: { toString: () => 'obj123' } }), ['obj123'])
  })

  it('should handle multiple asset fields at the same level', () => {
    const schema = mockSchema({
      image1: { _backboneForms: 'Asset' },
      image2: { _backboneForms: { type: 'Asset' } },
      title: { type: 'string' }
    })
    assert.deepEqual(extractAssetIds(schema, { image1: 'a1', image2: 'a2', title: 'test' }), ['a1', 'a2'])
  })
})
