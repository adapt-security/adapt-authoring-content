import { describe, it, mock, before, after, afterEach } from 'node:test'
import assert from 'assert/strict'
import _ from 'lodash'

import ContentModule from '../lib/ContentModule.js'
import { mockErrors } from './mocks/MockAdaptError.js'
import { generateModels, makeIdGenerator } from './mocks/Utils.js'

const errorCodes = [
  'CUT_ILLEGAL'
]

const mockLang = { translate: () => '[localised string]' }
const mockApp = { errors: mockErrors(errorCodes), lang: mockLang }
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
const isChild = (subject, target) => subject._parentId === target._id

before(() => {
  mock.method(ContentModule.prototype, 'init', () => Promise.resolve())

  mock.method(ContentModule.prototype, 'find', query => _.filter(mockCollection, query))

  mock.method(ContentModule.prototype, 'insert', data => {
    mockCollection.push({ ...data, _id: generateId() })
    return mockCollection.at(-1)
  })

  mock.method(ContentModule.prototype, 'update', (query, data) => {
    const content = mockCollection.find(i => i._id === query._id)
    return Object.assign(content, data)
  })
})

after(() => {
  mock.reset()
})

afterEach(() => {
  console.log('resetting mockCollection')
  mockCollection = []
})

describe('clone', () => {
  describe('pasting at parent level', () => {
    it('should copy a component into an existing empty block', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }],
        ['block', 'b-10']
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('c-05')
      const pasteHere = lookup('b-10')
      const newData = await content.clone(mockUser, copyThis._id, pasteHere._id)

      assert.ok(isChild(newData, pasteHere))
    })

    it('should copy a component into an available slot within an existing block', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }],
        ['block', 'b-10'],
        ['component', 'c-10', { _layout: 'left' }]
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('c-05')
      const pasteHere = lookup('b-10')
      const newData = await content.clone(mockUser, copyThis._id, pasteHere._id)

      assert.ok(isChild(newData, pasteHere))
      assert.strictEqual(newData._layout, 'right')
    })

    it('should copy a component into a new block if there are no available slots', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }]
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('c-05')
      const pasteHere = lookup('b-05')
      const newData = await content.clone(mockUser, copyThis._id, pasteHere._id)
      const newDataParent = _.find(mockCollection, { _id: newData._parentId })

      assert.ok(!isChild(newData, pasteHere))
      assert.strictEqual(newDataParent._parentId, pasteHere._parentId)
      assert.strictEqual(newDataParent._sortOrder, pasteHere._sortOrder + 1)
    })
  })

  describe('pasting at grandparent level', () => {
    it('should create the necessary hierarchy', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }],
        ['page', 'co-10']
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('c-05')
      const pasteHere = lookup('co-10')
      const newData = await content.clone(mockUser, copyThis._id, pasteHere._id)

      const page = ['block', 'article', 'page'].reduce((m, t) => {
        if (!m) return null
        return _.find(mockCollection, { _id: m._parentId, _type: t })
      }, newData)

      assert.strictEqual(page?._friendlyId, 'co-10')
    })

    it('should use an append strategy', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }]
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('c-05')
      const pasteHere = lookup('co-05')
      const newData = await content.clone(mockUser, copyThis._id, pasteHere._id)
      const parent = lookup(newData._parentId)

      assert.ok(isChild(parent, lookup('a-05')))
      assert.strictEqual(parent._sortOrder, 2)
    })

    it('should respect sort order when given', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }],
        ['article', 'a-10'],
        ['block', 'b-10'],
        ['component', 'c-10', { _layout: 'full' }]
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('c-05')
      const pasteHere = lookup('co-05')
      const newData = await content.clone(mockUser, copyThis._id, pasteHere._id, { _sortOrder: 2 })
      const parentBlock = lookup(newData._parentId)
      const parentArticle = lookup(parentBlock._parentId)

      assert.strictEqual(parentArticle._sortOrder, 2)
    })
  })

  describe('pasting at same or descendant level', () => {
    it('should respect hierarchical order', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }]
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('b-05')
      const pasteHere = lookup('c-05')
      const newBlock = await content.clone(mockUser, copyThis._id, pasteHere._id)

      assert.ok(isChild(newBlock, lookup('a-05')))
    })

    it('should permit a menu to be copied into a menu (including itself)', async t => {
      setupContent([
        ['course', 'm05'],
        ['menu', 'submenu'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }]
      ], ['en'])

      const content = new ContentModule(mockApp)
      const copyThis = lookup('submenu')
      const pasteHere = lookup('submenu')
      const newMenu = await content.clone(mockUser, copyThis._id, pasteHere._id)

      assert.ok(isChild(newMenu, pasteHere))
    })
  })

  describe('cut and paste', () => {
    it('should permit content to be cut from one place and pasted to another', async t => {
      setupContent([
        ['course', 'm05'],
        ['page', 'co-05'],
        ['article', 'a-05'],
        ['block', 'b-05'],
        ['component', 'c-05', { _layout: 'full' }],
        ['block', 'b-10']
      ], ['en'])

      const content = new ContentModule(mockApp)
      const cutThis = lookup('c-05')
      const pasteHere = lookup('b-10')
      const cutComponent = await content.clone(mockUser, cutThis._id, pasteHere._id, undefined, undefined, true)

      assert.ok(isChild(cutComponent, pasteHere))
    })
  })
})
