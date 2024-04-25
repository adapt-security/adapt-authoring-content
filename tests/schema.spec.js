import { describe, it, mock, before, after, afterEach } from 'node:test'
import assert from 'assert/strict'
import _ from 'lodash'

import ContentModule from '../lib/ContentModule.js'

let mockCollection = []

const lookup = (identifier, options) => {
  const matches = mockCollection.filter(i => i._id === identifier || i._friendlyId === identifier)
  return _.find(matches, options)
}

before(() => {
  mock.method(ContentModule.prototype, 'init', () => Promise.resolve())
  mock.method(ContentModule.prototype, 'find', query => _.filter(mockCollection, query))
})

after(() => {
  mock.reset()
})

afterEach(() => {
  console.log('resetting mockCollection')
  mockCollection = []
})

describe('schema', () => {
  it('return an appropriate schema name', async () => {
    // mock contentplugin to return a simple text component
    const mockContentPlugin = { find: () => [{ targetAttribute: '_text' }] }
    const mockApp = { waitForModule: () => mockContentPlugin }
    const content = new ContentModule(mockApp)

    content.schemaName = 'content'

    mockCollection = [
      { _id: 'noTypeOrComponent' },
      { _id: 'block', _type: 'block' },
      { _id: 'article', _type: 'article' },
      { _id: 'page', _type: 'page' },
      { _id: 'menu', _type: 'menu' },
      { _id: 'component', _type: 'component', _component: 'text' }
    ]

    assert.strictEqual(await content.getSchemaName(lookup('noTypeOrComponent')), 'content')
    assert.strictEqual(await content.getSchemaName(lookup('block')), 'block')
    assert.strictEqual(await content.getSchemaName(lookup('article')), 'article')
    assert.strictEqual(await content.getSchemaName(lookup('page')), 'contentobject')
    assert.strictEqual(await content.getSchemaName(lookup('menu')), 'contentobject')
    assert.strictEqual(await content.getSchemaName(lookup('component')), 'text-component')
  })
})
