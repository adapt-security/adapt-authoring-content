import { describe, it, mock, before, beforeEach, after, afterEach } from 'node:test'
import assert from 'assert/strict'
import _ from 'lodash'

import ContentModule from '../lib/ContentModule.js'
import { mockErrors } from './mocks/MockAdaptError.js'
import { generateModels, makeIdGenerator } from './mocks/Utils.js'

const mockLang = { translate: () => '[localised string]' }
const mockApp = { errors: mockErrors(), lang: mockLang }
const mockCourseId = 'course1'
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

  mock.method(ContentModule.prototype, 'find', query => {
    return _.filter(mockCollection, query)
  })

  mock.method(ContentModule.prototype, 'getContentModels', () => {
    return mockCollection.filter(i => i._type !== 'config')
  })

  mock.method(Object.getPrototypeOf(ContentModule).prototype, 'insert', data => {
    mockCollection.push({ ...data, _id: generateId() })
    return mockCollection.at(-1)
  })

  mock.method(Object.getPrototypeOf(ContentModule).prototype, 'update', (query, data) => {
    const content = mockCollection.find(i => i._id === query._id)
    return Object.assign(content, data)
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

describe('insert', () => {
  it('should ensure the parent exists before the child is inserted', async () => {
    setupContent([
      ['course', 'm05']
    ], ['en'])

    const content = new ContentModule(mockApp)
    await assert.rejects(async () => content.insert({
      _courseId: mockCourseId,
      _type: 'component',
      _parentId: 'b-10'
    }))
  })
})

describe('insertRecursive', () => {
  beforeEach(t => {
    // mock insert (super.insert is already mocked)
    t.mock.method(ContentModule.prototype, 'insert', data => {
      if (data._type === 'course') return { ...data, _id: mockCourseId, _courseId: mockCourseId }
      return { ...data, _id: generateId() }
    })
  })

  afterEach(t => {
    console.log('resetting mock')
    t.mock.reset()
  })

  it('should create a course, config and single page with descendants', async t => {
    const content = new ContentModule(mockApp)

    const [course, config, page, article, block, component] = await content.insertRecursive()

    assert.strictEqual(course._type, 'course')
    assert.strictEqual(config._type, 'config')
    assert.strictEqual(page._type, 'page')
    assert.strictEqual(article._type, 'article')
    assert.strictEqual(block._type, 'block')
    assert.strictEqual(component._type, 'component')
  })

  it('should create a page with descendants and return them hierarchically ordered', async t => {
    setupContent([
      ['course', 'm05']
    ], ['en'])

    const content = new ContentModule(mockApp)
    const course = lookup('m05')
    const newData = await content.insertRecursive(course._id)

    const checkHierarchy = (courseId, data) => {
      let parent = data[0]
      const typeOrder = ['page', 'article', 'block', 'component']
      for (let i = 1; i < data.length; i++) {
        const child = data[i]
        if (child._courseId !== courseId) return false
        if (child._parentId !== parent._id) return false
        if (typeOrder.indexOf(child._type) !== typeOrder.indexOf(parent._type) + 1) return false
        parent = child
      }
      return true
    }

    assert.ok(checkHierarchy(mockCourseId, newData))
  })
})
