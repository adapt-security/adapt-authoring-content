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
  describe('getSchemaName', () => {
    const bind = (overrides) => ContentModule.prototype.getSchemaName.bind(createInstance(overrides))

    it('should return default schema name when no _type or _component', async () => {
      const result = await bind()({})
      assert.equal(result, 'content')
    })

    it('should return _type directly for article', async () => {
      assert.equal(await bind()({ _type: 'article' }), 'article')
    })

    it('should return _type directly for block', async () => {
      assert.equal(await bind()({ _type: 'block' }), 'block')
    })

    it('should return _type directly for course', async () => {
      assert.equal(await bind()({ _type: 'course' }), 'course')
    })

    it('should return _type directly for config', async () => {
      assert.equal(await bind()({ _type: 'config' }), 'config')
    })

    it('should return "contentobject" for page', async () => {
      assert.equal(await bind()({ _type: 'page' }), 'contentobject')
    })

    it('should return "contentobject" for menu', async () => {
      assert.equal(await bind()({ _type: 'menu' }), 'contentobject')
    })

    it('should look up component plugin schema', async () => {
      const fn = bind({
        contentplugin: { findOne: mock.fn(async () => ({ targetAttribute: '_myPlugin' })) }
      })
      assert.equal(await fn({ _type: 'component', _component: 'adapt-contrib-text' }), 'myPlugin-component')
    })

    it('should fall back to default when component plugin not found', async () => {
      assert.equal(
        await bind()({ _type: 'component', _component: 'unknown' }),
        'content'
      )
    })

    it('should look up _type from DB when _id present but _type missing', async () => {
      const findOneMock = mock.fn(async () => ({ _type: 'article' }))
      assert.equal(await bind({ findOne: findOneMock })({ _id: 'some-id' }), 'article')
      assert.equal(findOneMock.mock.callCount(), 1)
    })

    it('should populate data._courseId from DB when missing', async () => {
      const findOneMock = mock.fn(async () => ({ _type: 'article', _courseId: 'c123' }))
      const data = { _id: 'some-id' }
      await bind({ findOne: findOneMock })(data)
      assert.equal(data._courseId, 'c123')
    })

    it('should not overwrite existing data._courseId', async () => {
      const findOneMock = mock.fn(async () => ({ _type: 'article', _courseId: 'c999' }))
      const data = { _id: 'some-id', _courseId: 'c123' }
      await bind({ findOne: findOneMock })(data)
      assert.equal(data._courseId, 'c123')
    })

    it('should return default when DB lookup returns null', async () => {
      const findOneMock = mock.fn(async () => null)
      assert.equal(await bind({ findOne: findOneMock })({ _id: 'missing' }), 'content')
    })

    it('should not query DB when both _type and _component are present', async () => {
      const findOneMock = mock.fn(async () => null)
      const fn = bind({
        findOne: findOneMock,
        contentplugin: { findOne: mock.fn(async () => ({ targetAttribute: '_text' })) }
      })
      await fn({ _id: 'some-id', _type: 'component', _component: 'adapt-contrib-text' })
      assert.equal(findOneMock.mock.callCount(), 0)
    })
  })

  describe('updateSortOrder', () => {
    const call = (item, updateData) =>
      ContentModule.prototype.updateSortOrder.call(createInstance(), item, updateData)

    it('should return early for config type', async () => {
      assert.equal(await call({ _type: 'config', _parentId: 'p', _id: 'x' }, {}), undefined)
    })

    it('should return early for course type', async () => {
      assert.equal(await call({ _type: 'course', _parentId: 'p', _id: 'x' }, {}), undefined)
    })

    it('should return early when _parentId is falsy', async () => {
      assert.equal(await call({ _type: 'article', _id: 'x' }, {}), undefined)
    })
  })

  describe('insertRecursive', () => {
    function createReq ({ rootId, body } = {}) {
      return {
        apiData: { query: { rootId }, data: {} },
        auth: { user: { _id: 'user1' } },
        body,
        translate: key => key
      }
    }

    function createRecursiveInstance () {
      const insertCalls = []
      let id = 0
      const nextId = () => `id${++id}`
      const insert = mock.fn(async data => {
        insertCalls.push(data)
        return { ...data, _id: nextId(), _courseId: data._courseId ?? nextId() }
      })
      return {
        instance: {
          insert,
          findOne: mock.fn(async () => null),
          updateSortOrder: mock.fn(async () => {}),
          updateEnabledPlugins: mock.fn(async () => {})
        },
        insertCalls
      }
    }

    it('should assign _sortOrder to every non-config/course child when creating a new course', async () => {
      const { instance, insertCalls } = createRecursiveInstance()
      await ContentModule.prototype.insertRecursive.call(instance, createReq())
      // payloads: course, config, page, article, block, component
      const needSortOrder = insertCalls.filter(d => d._type !== 'course' && d._type !== 'config')
      assert.ok(needSortOrder.length > 0, 'expected at least one child insert')
      for (const d of needSortOrder) {
        assert.equal(typeof d._sortOrder, 'number', `${d._type} inserted without numeric _sortOrder`)
      }
    })
  })

  describe('update guards', () => {
    // Exercises the guard logic from update() — whether updateSortOrder/updateEnabledPlugins
    // are called based on which fields are in the update data.
    // We replicate the guard block directly because super.update cannot be mocked on a plain object.
    async function callUpdate (data) {
      const updateSortOrder = mock.fn(async () => {})
      const updateEnabledPlugins = mock.fn(async () => {})
      const doc = { _id: 'x', _courseId: 'c', ...data }
      const sortChanged = '_sortOrder' in data || '_parentId' in data
      const pluginsChanged = '_component' in data || '_menu' in data || '_theme' in data || '_enabledPlugins' in data
      await Promise.all([
        sortChanged && updateSortOrder(doc, data),
        pluginsChanged && updateEnabledPlugins(doc, data._enabledPlugins ? { forceUpdate: true } : {})
      ])
      return { updateSortOrder, updateEnabledPlugins }
    }

    it('should skip both when updating unrelated fields', async () => {
      const { updateSortOrder, updateEnabledPlugins } = await callUpdate({ title: 'new' })
      assert.equal(updateSortOrder.mock.callCount(), 0)
      assert.equal(updateEnabledPlugins.mock.callCount(), 0)
    })

    it('should call updateSortOrder when _sortOrder changes', async () => {
      const { updateSortOrder } = await callUpdate({ _sortOrder: 2 })
      assert.equal(updateSortOrder.mock.callCount(), 1)
    })

    it('should call updateSortOrder when _parentId changes', async () => {
      const { updateSortOrder } = await callUpdate({ _parentId: 'p2' })
      assert.equal(updateSortOrder.mock.callCount(), 1)
    })

    it('should call updateEnabledPlugins when _component changes', async () => {
      const { updateEnabledPlugins } = await callUpdate({ _component: 'new-comp' })
      assert.equal(updateEnabledPlugins.mock.callCount(), 1)
    })

    it('should call updateEnabledPlugins when _enabledPlugins changes', async () => {
      const { updateEnabledPlugins } = await callUpdate({ _enabledPlugins: [] })
      assert.equal(updateEnabledPlugins.mock.callCount(), 1)
    })

    it('should call updateEnabledPlugins when _menu changes', async () => {
      const { updateEnabledPlugins } = await callUpdate({ _menu: 'new-menu' })
      assert.equal(updateEnabledPlugins.mock.callCount(), 1)
    })

    it('should call updateEnabledPlugins when _theme changes', async () => {
      const { updateEnabledPlugins } = await callUpdate({ _theme: 'new-theme' })
      assert.equal(updateEnabledPlugins.mock.callCount(), 1)
    })

    it('should pass forceUpdate when _enabledPlugins is in data', async () => {
      const { updateEnabledPlugins } = await callUpdate({ _enabledPlugins: ['p1'] })
      assert.deepEqual(updateEnabledPlugins.mock.calls[0].arguments[1], { forceUpdate: true })
    })

    it('should not pass forceUpdate for other plugin fields', async () => {
      const { updateEnabledPlugins } = await callUpdate({ _component: 'x' })
      assert.deepEqual(updateEnabledPlugins.mock.calls[0].arguments[1], {})
    })
  })

  describe('registerConfigSchemas', () => {
    it('should extend config schema with authored and tags', () => {
      const extendSchema = mock.fn()
      const inst = createInstance({
        jsonschema: { extendSchema },
        authored: { schemaName: 'authored' },
        tags: { schemaExtensionName: 'tags-ext' }
      })
      ContentModule.prototype.registerConfigSchemas.call(inst)
      assert.equal(extendSchema.mock.callCount(), 2)
      assert.deepEqual(extendSchema.mock.calls[0].arguments, ['config', 'authored'])
      assert.deepEqual(extendSchema.mock.calls[1].arguments, ['config', 'tags-ext'])
    })
  })

  describe('generateFriendlyIds', () => {
    const bind = (overrides) => {
      const inst = createInstance(overrides)
      inst.findMaxSeq = ContentModule.prototype.findMaxSeq.bind(inst)
      return ContentModule.prototype.generateFriendlyIds.bind(inst)
    }

    it('should return ["config"] for config type', async () => {
      assert.deepEqual(await bind()('config', null, 1), ['config'])
    })

    it('should generate a course ID without language', async () => {
      const result = await bind()('course', null, 1)
      assert.deepEqual(result, ['course-1'])
    })

    it('should generate a course ID with language', async () => {
      const result = await bind()('course', null, 1, 'en')
      assert.deepEqual(result, ['course-1-en'])
    })

    it('should generate a non-course ID using type prefix', async () => {
      const result = await bind()('block', COURSE_ID, 1)
      assert.deepEqual(result, ['b-1'])
    })

    it('should seed counter from existing content on first use', async () => {
      const docs = [{ _friendlyId: 'b-10' }, { _friendlyId: 'b-15' }]
      const mongodb = createMockMongodb({
        findOneAndUpdate: mock.fn(async () => ({ seq: 4 })),
        find: mock.fn(() => ({ toArray: mock.fn(async () => docs) }))
      })
      await bind({ mongodb })('block', COURSE_ID, 1)
      assert.equal(mongodb.collection.updateOne.mock.callCount(), 1)
      assert.deepEqual(mongodb.collection.updateOne.mock.calls[0].arguments[1], { $setOnInsert: { seq: 15 } })
    })

    it('should skip seeding when counter already exists', async () => {
      const mongodb = createMockMongodb({
        findOne: mock.fn(async () => ({ seq: 5 })),
        findOneAndUpdate: mock.fn(async () => ({ seq: 6 }))
      })
      await bind({ mongodb })('block', COURSE_ID, 1)
      assert.equal(mongodb.collection.updateOne.mock.callCount(), 0)
    })

    it('should atomically increment the counter', async () => {
      const mongodb = createMockMongodb({
        findOne: mock.fn(async () => ({ seq: 6 })),
        findOneAndUpdate: mock.fn(async () => ({ seq: 7 }))
      })
      const result = await bind({ mongodb })('article', COURSE_ID, 1)
      assert.deepEqual(result, ['a-7'])
      assert.equal(mongodb.collection.findOneAndUpdate.mock.callCount(), 1)
      assert.deepEqual(mongodb.collection.findOneAndUpdate.mock.calls[0].arguments[1], { $inc: { seq: 1 } })
    })
  })

  describe('findMaxSeq', () => {
    const bind = (docs) => ContentModule.prototype.findMaxSeq.bind(createInstance({
      mongodb: createMockMongodb({
        find: mock.fn(() => ({ toArray: mock.fn(async () => docs) }))
      })
    }))

    it('should return 0 when no documents exist', async () => {
      assert.equal(await bind([])('block', COURSE_ID), 0)
    })

    it('should return max number for non-course types', async () => {
      const docs = [{ _friendlyId: 'b-10' }, { _friendlyId: 'b-25' }, { _friendlyId: 'b-5' }]
      assert.equal(await bind(docs)('block', COURSE_ID), 25)
    })

    it('should return raw max number for course type', async () => {
      const docs = [{ _friendlyId: 'course-3-en' }, { _friendlyId: 'course-7-fr' }]
      assert.equal(await bind(docs)('course'), 7)
    })

    it('should skip documents without numeric IDs', async () => {
      const docs = [{ _friendlyId: 'config' }, { _friendlyId: 'b-15' }]
      assert.equal(await bind(docs)('block', COURSE_ID), 15)
    })
  })

  describe('deleteCounters', () => {
    it('should call deleteMany with parsed ObjectIds', async () => {
      const mongodb = createMockMongodb()
      await ContentModule.prototype.deleteCounters.call(
        createInstance({ mongodb }),
        ['507f1f77bcf86cd799439011']
      )
      assert.equal(mongodb.collection.deleteMany.mock.callCount(), 1)
      const query = mongodb.collection.deleteMany.mock.calls[0].arguments[0]
      assert.ok(query._courseId.$in)
      assert.equal(query._courseId.$in.length, 1)
    })
  })

  describe('clone', () => {
    const COURSE_OID = '507f1f77bcf86cd799439011'
    const PAGE_OID = '507f1f77bcf86cd799439022'
    const ART_OID = '507f1f77bcf86cd799439033'
    const BLOCK_OID = '507f1f77bcf86cd799439044'
    const COMP_OID = '507f1f77bcf86cd799439055'
    const CONFIG_OID = '507f1f77bcf86cd799439066'
    const PARENT_OID = '507f1f77bcf86cd799439077'

    function createCloneInstance (collectionOverrides = {}) {
      const insertedDocs = []
      const mongodb = createMockMongodb({
        insertMany: mock.fn(async (docs) => { insertedDocs.push(...docs) }),
        deleteMany: mock.fn(async () => {}),
        ...collectionOverrides
      })
      const inst = createInstance({
        mongodb,
        app: { errors: { NOT_FOUND: makeError('NOT_FOUND'), INVALID_PARENT: makeError('INVALID_PARENT') } },
        generateFriendlyIds: mock.fn(async (_type, _courseId, count) => {
          return Array.from({ length: count }, (_, i) => `${_type[0]}-${i + 1}`)
        }),
        getSchema: mock.fn(async () => ({})),
        updateEnabledPlugins: mock.fn(async () => {}),
        preCloneHook: { invoke: mock.fn(async () => {}) },
        preInsertHook: { invoke: mock.fn(async () => {}) },
        postInsertHook: { invoke: mock.fn(async () => {}) },
        postCloneHook: { invoke: mock.fn(async () => {}) }
      })
      return { inst, mongodb, insertedDocs }
    }

    function makeError (code) {
      return { code, setData: (d) => Object.assign(new Error(code), { code, data: d }) }
    }

    it('should throw NOT_FOUND when original doc is missing', async () => {
      const { inst } = createCloneInstance()

      const tree = new ContentTree([])
      await assert.rejects(
        () => ContentModule.prototype.clone.call(inst, 'user1', 'missing-id', PARENT_OID, {}, { tree }),
        (err) => err.code === 'NOT_FOUND'
      )
    })

    it('should throw INVALID_PARENT when non-course has no parent', async () => {
      const { inst } = createCloneInstance()

      const tree = new ContentTree([
        { _id: PAGE_OID, _type: 'page', _parentId: COURSE_OID, _courseId: COURSE_OID }
      ])
      inst.findOne = mock.fn(async () => null) // parent lookup returns null
      await assert.rejects(
        () => ContentModule.prototype.clone.call(inst, 'user1', PAGE_OID, 'bad-parent', {}, { tree }),
        (err) => err.code === 'INVALID_PARENT'
      )
    })

    it('should clone a page and its descendants via insertMany', async () => {
      const { inst, mongodb } = createCloneInstance()

      const items = [
        { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID },
        { _id: PAGE_OID, _type: 'page', _parentId: COURSE_OID, _courseId: COURSE_OID },
        { _id: ART_OID, _type: 'article', _parentId: PAGE_OID, _courseId: COURSE_OID },
        { _id: BLOCK_OID, _type: 'block', _parentId: ART_OID, _courseId: COURSE_OID },
        { _id: COMP_OID, _type: 'component', _parentId: BLOCK_OID, _courseId: COURSE_OID, _component: 'adapt-contrib-text' }
      ]
      const tree = new ContentTree(items)
      const parent = { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID }
      const result = await ContentModule.prototype.clone.call(inst, 'user1', PAGE_OID, COURSE_OID, { title: 'Cloned' }, { tree, parent })

      // insertMany should have been called once
      assert.equal(mongodb.collection.insertMany.mock.callCount(), 1)
      const inserted = mongodb.collection.insertMany.mock.calls[0].arguments[0]
      // should clone page + article + block + component = 4 items
      assert.equal(inserted.length, 4)
      // root payload should have customData applied
      assert.equal(result.title, 'Cloned')
      assert.equal(result.createdBy, 'user1')
    })

    it('should clone a course with config', async () => {
      const { inst, mongodb } = createCloneInstance()

      const items = [
        { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID, _friendlyId: 'course-1' },
        { _id: CONFIG_OID, _type: 'config', _courseId: COURSE_OID },
        { _id: PAGE_OID, _type: 'page', _parentId: COURSE_OID, _courseId: COURSE_OID }
      ]
      const tree = new ContentTree(items)
      const result = await ContentModule.prototype.clone.call(inst, 'user1', COURSE_OID, undefined, {}, { tree })

      const inserted = mongodb.collection.insertMany.mock.calls[0].arguments[0]
      // course + config + page = 3
      assert.equal(inserted.length, 3)
      assert.equal(result._type, 'course')
    })

    it('should remap parent IDs correctly', async () => {
      const { inst, mongodb } = createCloneInstance()

      const items = [
        { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID },
        { _id: PAGE_OID, _type: 'page', _parentId: COURSE_OID, _courseId: COURSE_OID },
        { _id: ART_OID, _type: 'article', _parentId: PAGE_OID, _courseId: COURSE_OID }
      ]
      const tree = new ContentTree(items)
      const parent = { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID }
      await ContentModule.prototype.clone.call(inst, 'user1', PAGE_OID, COURSE_OID, {}, { tree, parent })

      const inserted = mongodb.collection.insertMany.mock.calls[0].arguments[0]
      const clonedPage = inserted.find(d => d._type === 'page')
      const clonedArticle = inserted.find(d => d._type === 'article')
      // article's parent should be the cloned page's new ID, not the original
      assert.equal(clonedArticle._parentId.toString(), clonedPage._id.toString())
    })

    it('should roll back on insertMany failure', async () => {
      const deleteManyMock = mock.fn(async () => {})
      const { inst, mongodb } = createCloneInstance({
        insertMany: mock.fn(async () => { throw new Error('insert failed') }),
        deleteMany: deleteManyMock
      })

      const items = [
        { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID },
        { _id: PAGE_OID, _type: 'page', _parentId: COURSE_OID, _courseId: COURSE_OID }
      ]
      const tree = new ContentTree(items)
      const parent = { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID }
      await assert.rejects(
        () => ContentModule.prototype.clone.call(inst, 'user1', PAGE_OID, COURSE_OID, {}, { tree, parent }),
        { message: 'insert failed' }
      )
      // should attempt cleanup via deleteMany
      assert.equal(mongodb.collection.deleteMany.mock.callCount(), 1)
    })

    it('should fire pre/post clone hooks', async () => {
      const { inst } = createCloneInstance()

      const items = [
        { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID },
        { _id: PAGE_OID, _type: 'page', _parentId: COURSE_OID, _courseId: COURSE_OID }
      ]
      const tree = new ContentTree(items)
      const parent = { _id: COURSE_OID, _type: 'course', _courseId: COURSE_OID }
      await ContentModule.prototype.clone.call(inst, 'user1', PAGE_OID, COURSE_OID, {}, { tree, parent })

      assert.ok(inst.preCloneHook.invoke.mock.callCount() > 0)
      assert.ok(inst.postCloneHook.invoke.mock.callCount() > 0)
      assert.ok(inst.preInsertHook.invoke.mock.callCount() > 0)
      assert.ok(inst.postInsertHook.invoke.mock.callCount() > 0)
    })
  })

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
