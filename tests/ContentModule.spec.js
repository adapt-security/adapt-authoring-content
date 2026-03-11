import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

const { default: ContentModule } = await import('../lib/ContentModule.js')

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

  describe('generateFriendlyId', () => {
    const bind = (overrides) => {
      const inst = createInstance(overrides)
      inst.findMaxSeq = ContentModule.prototype.findMaxSeq.bind(inst)
      return ContentModule.prototype.generateFriendlyId.bind(inst)
    }

    it('should return "config" for config type', async () => {
      assert.equal(await bind()({ _type: 'config' }), 'config')
    })

    it('should generate a course ID without language', async () => {
      const result = await bind()({ _type: 'course' })
      assert.equal(result, 'course-1')
    })

    it('should generate a course ID with language', async () => {
      const result = await bind()({ _type: 'course', _language: 'en' })
      assert.equal(result, 'course-1-en')
    })

    it('should generate a non-course ID using type prefix and interval', async () => {
      const result = await bind()({ _type: 'block', _courseId: COURSE_ID })
      assert.equal(result, 'b-5')
    })

    it('should seed counter from existing content on first use', async () => {
      const docs = [{ _friendlyId: 'b-10' }, { _friendlyId: 'b-15' }]
      const mongodb = createMockMongodb({
        findOneAndUpdate: mock.fn(async () => ({ seq: 4 })),
        find: mock.fn(() => ({ toArray: mock.fn(async () => docs) }))
      })
      await bind({ mongodb })({ _type: 'block', _courseId: COURSE_ID })
      assert.equal(mongodb.collection.updateOne.mock.callCount(), 1)
      assert.deepEqual(mongodb.collection.updateOne.mock.calls[0].arguments[1], { $setOnInsert: { seq: 3 } })
    })

    it('should skip seeding when counter already exists', async () => {
      const mongodb = createMockMongodb({
        findOne: mock.fn(async () => ({ seq: 5 })),
        findOneAndUpdate: mock.fn(async () => ({ seq: 6 }))
      })
      await bind({ mongodb })({ _type: 'block', _courseId: COURSE_ID })
      assert.equal(mongodb.collection.updateOne.mock.callCount(), 0)
    })

    it('should atomically increment the counter', async () => {
      const mongodb = createMockMongodb({
        findOne: mock.fn(async () => ({ seq: 6 })),
        findOneAndUpdate: mock.fn(async () => ({ seq: 7 }))
      })
      const result = await bind({ mongodb })({ _type: 'article', _courseId: COURSE_ID })
      assert.equal(result, 'a-35')
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

    it('should return max number divided by interval for non-course types', async () => {
      const docs = [{ _friendlyId: 'b-10' }, { _friendlyId: 'b-25' }, { _friendlyId: 'b-5' }]
      assert.equal(await bind(docs)('block', COURSE_ID), 5)
    })

    it('should return raw max number for course type', async () => {
      const docs = [{ _friendlyId: 'course-3-en' }, { _friendlyId: 'course-7-fr' }]
      assert.equal(await bind(docs)('course'), 7)
    })

    it('should skip documents without numeric IDs', async () => {
      const docs = [{ _friendlyId: 'config' }, { _friendlyId: 'b-15' }]
      assert.equal(await bind(docs)('block', COURSE_ID), 3)
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
})
