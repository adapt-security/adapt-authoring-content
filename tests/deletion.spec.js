import { describe, it, mock, before, after, afterEach } from 'node:test'
import assert from 'assert/strict'
import _ from 'lodash'

import ContentModule from '../lib/ContentModule.js'
import { mockErrors } from './mocks/MockAdaptError.js'
import { generateModels, makeIdGenerator } from './mocks/Utils.js'

const errorCodes = [
]

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

  // mock super.delete
  mock.method(Object.getPrototypeOf(ContentModule).prototype, 'delete', query => {
    const toBeDeleted = _.find(mockCollection, query)
    return mockCollection.splice(mockCollection.indexOf(toBeDeleted), 1)
  })

  mock.method(ContentModule.prototype, 'updateEnabledPlugins', () => {})
  mock.method(ContentModule.prototype, 'updateSortOrder', () => {})
})

after(() => {
  mock.reset()
})

afterEach(() => {
  console.log('resetting mockCollection')
  mockCollection = []
})

describe('delete', () => {
  it('should remove the content and its descendants', async () => {
    setupContent([
      ['course', 'm05'],
      ['page', 'co-05'],
      ['article', 'a-05'],
      ['block', 'b-05'],
      ['component', 'c-05', { _layout: 'full' }]
    ], ['en'])

    const content = new ContentModule(mockApp)
    const articleEn = _.find(mockCollection, { _friendlyId: 'a-05', _lang: 'en' })
    const deleted = await content.delete({ _id: articleEn._id })
    const get = (_friendlyId, _lang) => _.find(deleted, { _friendlyId, _lang })

    assert.strictEqual(deleted.length, 3)
    assert.ok(deleted.includes(get('a-05', 'en')))
    assert.ok(deleted.includes(get('b-05', 'en')))
    assert.ok(deleted.includes(get('c-05', 'en')))
  })

  it('should remove the necessary peers when deleting content', async () => {
    setupContent([
      ['course', 'm05'],
      ['page', 'co-05'],
      ['article', 'a-05'],
      ['block', 'b-05'],
      ['component', 'c-05', { _layout: 'full' }]
    ], ['en'])

    // locate the component to be deleted and its peer
    const componentEn = lookup('c-05', { _lang: 'en' })

    const deleteIds = []

    // mock super.delete to record the identity of documents to be deleted
    mock.method(Object.getPrototypeOf(ContentModule).prototype, 'delete', ({ _id }) => deleteIds.push(_id))

    const content = new ContentModule(mockApp)
    await content.delete({ _id: componentEn._id })
    const contentToBeDeleted = mockCollection.filter(i => deleteIds.includes(i._id))

    assert.strictEqual(deleteIds.length, 1)
    assert.ok(contentToBeDeleted.includes(componentEn))
  })
})
