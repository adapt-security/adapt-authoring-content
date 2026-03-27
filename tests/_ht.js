import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import ContentModule from '../lib/ContentModule.js'
import ContentTree from '../lib/ContentTree.js'

const COURSE_ID = '507f1f77bcf86cd799439011'

function createMockCollection (overrides = {}) {
  return {
    findOne: mock.fn(async () => null),
    updateOne: mock.fn(async () => {}),
    findOneAndUpdate: mock.fn(async () => ({ seq: 1 })),
    find: mock.fn(() => ({ toArray: mock.fn(async () => []) })),
    deleteMany: mock.fn(async () => {}),
    ...overrides
  }
}

function createMockMongodb (collectionOverrides) {
  const col = createMockCollection(collectionOverrides)
  return { getCollection: mock.fn(() => col), collection: col }
}

function createInstance (overrides = {}) {
  return {
    schemaName: 'content',
    collectionName: 'content',
    counterCollectionName: 'contentcounters',
    idInterval: 5,
    contentplugin: { findOne: mock.fn(async () => null) },
    jsonschema: { extendSchema: mock.fn() },
    authored: { schemaName: 'authored' },
    tags: { schemaExtensionName: 'tags' },
    mongodb: createMockMongodb(),
    find: mock.fn(async () => []),
    findOne: mock.fn(async () => null),
    ...overrides
  }
}

describe('ContentModule', () => {
  describe('handleTree', () => {
    it('should return 304 when content has not been modified', async () => {
      const lastModified = new Date('2025-01-01T00:00:00Z')
      const inst = createInstance({
        findOne: mock.fn(async () => ({ updatedAt: lastModified }))
      })
      let statusCode
      let ended = false
      const req = {
        apiData: { query: { _courseId: COURSE_ID } },
        headers: { 'if-modified-since': new Date('2025-01-02T00:00:00Z').toUTCString() }
      }
      const res = {
        status: mock.fn(function (code) { statusCode = code; return this }),
        end: mock.fn(() => { ended = true })
      }
      const next = mock.fn()
      await ContentModule.prototype.handleTree.call(inst, req, res, next)
      assert.equal(statusCode, 304)
      assert.equal(ended, true)
      assert.equal(next.mock.callCount(), 0)
    })

    it('should return items with _children when content has been modified', async () => {
      const lastModified = new Date('2025-01-15T00:00:00Z')
      const items = [
        { _id: COURSE_ID, _type: 'course', _courseId: COURSE_ID },
        { _id: 'page1', _type: 'page', _parentId: COURSE_ID, _courseId: COURSE_ID },
        { _id: 'art1', _type: 'article', _parentId: 'page1', _courseId: COURSE_ID }
      ]
      const inst = createInstance({
        findOne: mock.fn(async () => ({ updatedAt: lastModified })),
        find: mock.fn(async () => items)
      })
      const req = {
        apiData: { query: { _courseId: COURSE_ID } },
        headers: {}
      }
      let responseData
      let lastModifiedHeader
      const res = {
        set: mock.fn((key, val) => { if (key === 'Last-Modified') lastModifiedHeader = val }),
        json: mock.fn((data) => { responseData = data })
      }
      const next = mock.fn()
      await ContentModule.prototype.handleTree.call(inst, req, res, next)

      assert.equal(next.mock.callCount(), 0)
      assert.equal(responseData.length, 3)
      // course should have page1 as child
      const course = responseData.find(i => i._id === COURSE_ID)
      assert.deepEqual(course._children, ['page1'])
      // page should have art1 as child
      const page = responseData.find(i => i._id === 'page1')
      assert.deepEqual(page._children, ['art1'])
      // article should have no children
      const art = responseData.find(i => i._id === 'art1')
      assert.deepEqual(art._children, [])
      // Last-Modified header should be set
      assert.equal(lastModifiedHeader, lastModified.toUTCString())
    })

    it('should call next on error', async () => {
      const inst = createInstance({
        findOne: mock.fn(async () => { throw new Error('db error') })
      })
      const req = { apiData: { query: { _courseId: COURSE_ID } }, headers: {} }
      const res = {}
      const next = mock.fn()
      await ContentModule.prototype.handleTree.call(inst, req, res, next)
      assert.equal(next.mock.callCount(), 1)
      assert.equal(next.mock.calls[0].arguments[0].message, 'db error')
    })
  })
})
