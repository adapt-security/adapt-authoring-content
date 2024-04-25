import { describe, it, mock, before, beforeEach, after, afterEach } from 'node:test'
import assert from 'assert/strict'
import _ from 'lodash'

import ContentModule from '../lib/ContentModule.js'
import { mockErrors } from './mocks/MockAdaptError.js'
import { generateModels, makeIdGenerator } from './mocks/Utils.js'

const errorCodes = []

const mockApp = { errors: mockErrors(errorCodes) }
const mockCourseId = 'course1'
const mockUser = 'user1'
const defaultLanguage = 'en'

let mockCollection = []

const generateId = makeIdGenerator()

const setupContent = (data, langs) => {
  const config = {
    _id: generateId(),
    _type: 'config',
    _courseId: mockCourseId,
    _defaultLanguage: defaultLanguage
  }
  mockCollection = [config].concat(generateModels(data, langs, mockCourseId, generateId))
}

/**
 * locate the first item in mockCollection that matches the given identifier and constraints
 * @param {string} identifier the _id or _friendlyId of the item under search (_id has precedence)
 * @param {Object} options additional constraints on the match (e.g. {_lang: 'en'})
 * @returns a single item or undefined
 */
const lookup = (identifier, options) => {
  const matches = mockCollection.filter(i => i._id === identifier || i._friendlyId === identifier)
  return _.find(matches, options)
}

before(() => {
  mock.method(ContentModule.prototype, 'init', () => Promise.resolve())

  mock.method(ContentModule.prototype, 'find', query => _.filter(mockCollection, query))

  mock.method(ContentModule.prototype, 'getContentModels', () => {
    return mockCollection.filter(i => i._type !== 'config')
  })

  // mock super.update
  mock.method(Object.getPrototypeOf(ContentModule).prototype, 'update', (query, data) => {
    const content = mockCollection.find(i => i._id === query._id)
    return Object.assign(content, data)
  })

  mock.method(ContentModule.prototype, 'updateEnabledPlugins', () => {})
})

after(() => {
  mock.reset()
})

afterEach(() => {
  console.log('resetting mockCollection')
  mockCollection = []
})

describe('updating sort order', () => {
  beforeEach(t => {
    t.mock.method(ContentModule.prototype, 'findSiblings', (parentId, excludeId = null, shouldSort = true) => {
      const query = { _parentId: parentId }
      let siblings = _.filter(mockCollection, query)
      if (excludeId !== null) siblings = siblings.filter(i => i._id !== excludeId)
      if (shouldSort) siblings = _.sortBy(siblings, ['_sortOrder'])
      return siblings
    })
  })

  afterEach(t => {
    t.mock.reset()
  })

  it('should ensure contiguous order when adding a new sibling', async () => {
    setupContent([
      ['course', 'm05'],
      ['page', 'co-05'],
      ['article', 'a-05'],
      ['block', 'b-05', { _sortOrder: 1 }],
      ['block', 'b-10', { _sortOrder: 2 }],
      ['block', 'b-15', { _sortOrder: 3 }],
      /* simulate appending b-20 by nullifying _sortOrder */
      ['block', 'b-20', { _sortOrder: null }]
    ], ['en'])

    const b20 = lookup('b-20', { _lang: 'en' })

    const content = new ContentModule(mockApp)
    await content.updateSortOrder(b20, true)

    assert.strictEqual(b20._sortOrder, 4)
  })

  it('should ensure contiguous order when removing a sibling', async () => {
    setupContent([
      ['course', 'm05'],
      ['page', 'co-05'],
      ['article', 'a-05'],
      ['block', 'b-05', { _sortOrder: 1 }],
      ['block', 'b-10', { _sortOrder: 2 }],
      /* simulate removal of b-15 */
      ['block', 'b-20', { _sortOrder: 4 }]
    ], ['en'])

    const b20 = lookup('b-20', { _lang: 'en' })

    const content = new ContentModule(mockApp)
    await content.updateSortOrder(b20, true)

    assert.strictEqual(b20._sortOrder, 3)
  })
})
