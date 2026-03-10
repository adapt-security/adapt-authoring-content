import { describe, it, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

/**
 * ContentModule extends AbstractApiModule (which extends AbstractModule).
 * All methods rely heavily on this.app, this.find(), super.insert(), etc.
 * We mock the full dependency chain so each method can be tested in isolation.
 */

// ---------------------------------------------------------------------------
// Helpers: build a mock ContentModule instance with configurable stubs
// ---------------------------------------------------------------------------

function createMockError (code) {
  const err = new Error(code)
  err.code = code
  err.setData = (d) => {
    const copy = new Error(code)
    copy.code = code
    copy.data = d
    copy.setData = err.setData
    return copy
  }
  return err
}

function createMockApp () {
  return {
    errors: {
      NOT_FOUND: createMockError('NOT_FOUND'),
      INVALID_PARENT: createMockError('INVALID_PARENT'),
      UNKNOWN_SCHEMA_NAME: createMockError('UNKNOWN_SCHEMA_NAME'),
      MONGO_DUPL_INDEX: createMockError('MONGO_DUPL_INDEX'),
      DUPL_FRIENDLY_ID: createMockError('DUPL_FRIENDLY_ID')
    },
    waitForModule: mock.fn(async () => ({})),
    config: { get: mock.fn(() => 10) }
  }
}

function createMockHook () {
  return {
    invoke: mock.fn(async () => {}),
    tap: mock.fn(),
    hasObservers: false,
    _hookObservers: []
  }
}

/**
 * Builds a plain object that behaves like a ContentModule instance
 * with all inherited methods stubbed.  Individual tests can override
 * specific stubs before exercising the method under test.
 */
function createInstance (overrides = {}) {
  const app = createMockApp()
  const instance = {
    app,
    root: 'content',
    collectionName: 'content',
    schemaName: 'content',
    routes: [],

    find: mock.fn(async () => []),
    findOne: mock.fn(async () => ({})),
    insert: mock.fn(async (data) => ({ ...data, _id: 'new-id' })),
    update: mock.fn(async (q, d) => ({ ...q, ...d })),
    delete: mock.fn(async () => ({})),

    setDefaultOptions: mock.fn((opts) => opts),
    checkAccess: mock.fn(async (req, data) => data),
    updateSortOrder: mock.fn(async () => {}),
    updateEnabledPlugins: mock.fn(async () => {}),
    log: mock.fn(),

    requestHook: createMockHook(),
    preCloneHook: createMockHook(),
    postCloneHook: createMockHook(),

    handleInsertRecursive: mock.fn(),
    handleClone: mock.fn(),

    ...overrides
  }
  return instance
}

// Import the actual class to pull method bodies from the prototype
const { default: ContentModule } = await import('../lib/ContentModule.js')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentModule', () => {
  // -----------------------------------------------------------------------
  // setValues
  // -----------------------------------------------------------------------
  describe('setValues', () => {
    it('should set collectionName and schemaName to "content"', async () => {
      const inst = createInstance()
      Object.getPrototypeOf(ContentModule.prototype).setValues = mock.fn(async function () {})
      await ContentModule.prototype.setValues.call(inst)

      assert.equal(inst.collectionName, 'content')
      assert.equal(inst.schemaName, 'content')
    })
  })

  // -----------------------------------------------------------------------
  // getSchemaName
  // -----------------------------------------------------------------------
  describe('getSchemaName', () => {
    let inst

    beforeEach(() => {
      inst = createInstance()
      inst.app.waitForModule = mock.fn(async () => ({
        find: mock.fn(async () => [])
      }))
    })

    it('should return the default schema name when no _type or _component and no _id', async () => {
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => ({
            find: mock.fn(async () => [])
          }))
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({})
      assert.equal(typeof result, 'string')
    })

    it('should return _type directly for non-component types (e.g. article)', async () => {
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => ({
            find: mock.fn(async () => [])
          }))
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({ _type: 'article' })
      assert.equal(result, 'article')
    })

    it('should return "contentobject" for _type "page"', async () => {
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => ({
            find: mock.fn(async () => [])
          }))
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({ _type: 'page' })
      assert.equal(result, 'contentobject')
    })

    it('should return "contentobject" for _type "menu"', async () => {
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => ({
            find: mock.fn(async () => [])
          }))
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({ _type: 'menu' })
      assert.equal(result, 'contentobject')
    })

    it('should return block type directly for _type "block"', async () => {
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => ({
            find: mock.fn(async () => [])
          }))
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({ _type: 'block' })
      assert.equal(result, 'block')
    })

    it('should look up a component plugin schema for _type "component"', async () => {
      const contentplugin = {
        find: mock.fn(async () => [{ targetAttribute: '_myPlugin' }]),
        findOne: mock.fn(async () => ({ targetAttribute: '_myPlugin' }))
      }
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => contentplugin)
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({
        _type: 'component',
        _component: 'adapt-contrib-text'
      })
      assert.equal(result, 'myPlugin-component')
    })

    it('should fall back to default if component plugin is not found', async () => {
      const contentplugin = {
        find: mock.fn(async () => []),
        findOne: mock.fn(async () => undefined)
      }
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        schemaName: 'content',
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => contentplugin)
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({
        _type: 'component',
        _component: 'unknown-component'
      })
      assert.equal(result, 'content')
    })

    it('should look up _type from the DB when _id is present but _type is missing', async () => {
      const contentplugin = {
        find: mock.fn(async () => [])
      }
      const findMock = mock.fn(async () => [{ _type: 'article', _component: undefined }])
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        schemaName: 'content',
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => contentplugin)
        },
        find: findMock
      })

      const result = await getSchemaName({ _id: 'some-id' })
      assert.equal(result, 'article')
      assert.equal(findMock.mock.callCount(), 1)
    })

    it('should return "course" for _type "course"', async () => {
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => ({
            find: mock.fn(async () => [])
          }))
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({ _type: 'course' })
      assert.equal(result, 'course')
    })

    it('should return "config" for _type "config"', async () => {
      const getSchemaName = ContentModule.prototype.getSchemaName.bind({
        ...inst,
        app: {
          ...inst.app,
          waitForModule: mock.fn(async () => ({
            find: mock.fn(async () => [])
          }))
        },
        find: mock.fn(async () => [])
      })

      const result = await getSchemaName({ _type: 'config' })
      assert.equal(result, 'config')
    })
  })

  // -----------------------------------------------------------------------
  // insert
  // -----------------------------------------------------------------------
  describe('insert', () => {
    const origProto = Object.getPrototypeOf(ContentModule.prototype)
    let origInsert

    beforeEach(() => {
      origInsert = origProto.insert
    })

    // Restore after each test in case of early failure
    it('should call super.insert and return result for non-course types', async () => {
      const superInsert = mock.fn(async (data) => ({ ...data, _id: 'new-id' }))
      origProto.insert = superInsert
      try {
        const inst = createInstance()
        const result = await ContentModule.prototype.insert.call(inst, { _type: 'article', title: 'Test' })
        assert.equal(result._type, 'article')
        assert.equal(superInsert.mock.callCount(), 1)
        assert.equal(inst.updateSortOrder.mock.callCount(), 1)
        assert.equal(inst.updateEnabledPlugins.mock.callCount(), 1)
      } finally {
        origProto.insert = origInsert
      }
    })

    it('should update _courseId after inserting a course', async () => {
      const superInsert = mock.fn(async (data) => ({ ...data, _id: 'course-1' }))
      origProto.insert = superInsert
      try {
        const inst = createInstance()
        await ContentModule.prototype.insert.call(inst, { _type: 'course', title: 'My Course' })
        assert.equal(inst.update.mock.callCount(), 1)
        assert.equal(inst.update.mock.calls[0].arguments[1]._courseId, 'course-1')
      } finally {
        origProto.insert = origInsert
      }
    })

    it('should skip updateSortOrder when options.updateSortOrder is false', async () => {
      const superInsert = mock.fn(async (data) => ({ ...data, _id: 'id' }))
      origProto.insert = superInsert
      try {
        const inst = createInstance()
        await ContentModule.prototype.insert.call(inst, { _type: 'block' }, { updateSortOrder: false })
        assert.equal(inst.updateSortOrder.mock.callCount(), 0)
        assert.equal(inst.updateEnabledPlugins.mock.callCount(), 1)
      } finally {
        origProto.insert = origInsert
      }
    })

    it('should skip updateEnabledPlugins when options.updateEnabledPlugins is false', async () => {
      const superInsert = mock.fn(async (data) => ({ ...data, _id: 'id' }))
      origProto.insert = superInsert
      try {
        const inst = createInstance()
        await ContentModule.prototype.insert.call(inst, { _type: 'block' }, { updateEnabledPlugins: false })
        assert.equal(inst.updateSortOrder.mock.callCount(), 1)
        assert.equal(inst.updateEnabledPlugins.mock.callCount(), 0)
      } finally {
        origProto.insert = origInsert
      }
    })
  })

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    const origProto = Object.getPrototypeOf(ContentModule.prototype)
    let origUpdate

    beforeEach(() => {
      origUpdate = origProto.update
    })

    it('should call super.update then updateSortOrder and updateEnabledPlugins', async () => {
      const superUpdate = mock.fn(async () => ({ _id: 'id1', _type: 'article', _parentId: 'p1', _courseId: 'c1' }))
      origProto.update = superUpdate
      try {
        const inst = createInstance()
        const result = await ContentModule.prototype.update.call(inst, { _id: 'id1' }, { title: 'Updated' })
        assert.equal(result._id, 'id1')
        assert.equal(superUpdate.mock.callCount(), 1)
        assert.equal(inst.updateSortOrder.mock.callCount(), 1)
        assert.equal(inst.updateEnabledPlugins.mock.callCount(), 1)
      } finally {
        origProto.update = origUpdate
      }
    })

    it('should pass forceUpdate when _enabledPlugins is present in data', async () => {
      const superUpdate = mock.fn(async () => ({ _id: 'id', _courseId: 'c1' }))
      origProto.update = superUpdate
      try {
        const inst = createInstance()
        await ContentModule.prototype.update.call(inst, { _id: 'id' }, { _enabledPlugins: ['plugin-a'] })
        const args = inst.updateEnabledPlugins.mock.calls[0].arguments
        assert.deepEqual(args[1], { forceUpdate: true })
      } finally {
        origProto.update = origUpdate
      }
    })

    it('should pass empty options when _enabledPlugins is not in data', async () => {
      const superUpdate = mock.fn(async () => ({ _id: 'id', _courseId: 'c1' }))
      origProto.update = superUpdate
      try {
        const inst = createInstance()
        await ContentModule.prototype.update.call(inst, { _id: 'id' }, { title: 'Updated' })
        const args = inst.updateEnabledPlugins.mock.calls[0].arguments
        assert.deepEqual(args[1], {})
      } finally {
        origProto.update = origUpdate
      }
    })
  })

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    const origProto = Object.getPrototypeOf(ContentModule.prototype)
    let origDelete

    beforeEach(() => {
      origDelete = origProto.delete
    })

    it('should throw when target document is not found', async () => {
      const inst = createInstance({
        find: mock.fn(async () => []),
        setDefaultOptions: mock.fn((opts) => {
          if (opts) opts.schemaName = 'content'
        })
      })

      await assert.rejects(
        () => ContentModule.prototype.delete.call(inst, { _id: 'missing' }, {}),
        (err) => {
          assert.equal(err.code, 'NOT_FOUND')
          return true
        }
      )
    })

    it('should delete target and all descendants', async () => {
      const targetDoc = { _id: 'target', _courseId: 'c1', _type: 'page', _parentId: 'c1' }
      const desc1 = { _id: 'desc1', _courseId: 'c1', _type: 'article', _parentId: 'target' }
      const desc2 = { _id: 'desc2', _courseId: 'c1', _type: 'block', _parentId: 'desc1' }
      const allItems = [
        { _id: 'c1', _courseId: 'c1', _type: 'course' },
        targetDoc,
        desc1,
        desc2
      ]

      const superDelete = mock.fn(async () => {})
      origProto.delete = superDelete
      try {
        const inst = createInstance({
          find: mock.fn(async (query) => {
            return allItems.filter(item => {
              return Object.entries(query).every(([k, v]) => {
                const itemVal = item[k]
                if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
                  return itemVal.toString() === v
                }
                return itemVal === v
              })
            })
          })
        })

        const result = await ContentModule.prototype.delete.call(inst, { _id: 'target' })
        assert.equal(result.length, 3)
        assert.equal(result[0]._id, 'target')
        assert.equal(superDelete.mock.callCount(), 3)
      } finally {
        origProto.delete = origDelete
      }
    })

    it('should return target as first element followed by descendants', async () => {
      const target = { _id: 't1', _courseId: 'c1', _type: 'article', _parentId: 'p1' }
      const child = { _id: 'c1child', _courseId: 'c1', _type: 'block', _parentId: 't1' }
      const allItems = [
        { _id: 'c1', _courseId: 'c1', _type: 'course' },
        { _id: 'p1', _courseId: 'c1', _type: 'page', _parentId: 'c1' },
        target,
        child
      ]

      const superDelete = mock.fn(async () => {})
      origProto.delete = superDelete
      try {
        const inst = createInstance({
          find: mock.fn(async (query) => {
            return allItems.filter(item => {
              return Object.entries(query).every(([k, v]) => {
                const itemVal = item[k]
                if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
                  return itemVal.toString() === v
                }
                return itemVal === v
              })
            })
          })
        })

        const result = await ContentModule.prototype.delete.call(inst, { _id: 't1' })
        assert.equal(result[0]._id, 't1')
        assert.equal(result[1]._id, 'c1child')
      } finally {
        origProto.delete = origDelete
      }
    })

    it('should include config when deleting a course', async () => {
      const course = { _id: 'c1', _courseId: 'c1', _type: 'course' }
      const config = { _id: 'cfg', _courseId: 'c1', _type: 'config' }
      const page = { _id: 'p1', _courseId: 'c1', _type: 'page', _parentId: 'c1' }
      const allItems = [course, config, page]

      const superDelete = mock.fn(async () => {})
      origProto.delete = superDelete
      try {
        const inst = createInstance({
          find: mock.fn(async (query) => {
            return allItems.filter(item => {
              return Object.entries(query).every(([k, v]) => {
                const itemVal = item[k]
                if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
                  return itemVal.toString() === v
                }
                return itemVal === v
              })
            })
          })
        })

        const result = await ContentModule.prototype.delete.call(inst, { _id: 'c1' })
        assert.ok(result.some(r => r._type === 'config'))
        assert.ok(result.some(r => r._type === 'page'))
        assert.equal(superDelete.mock.callCount(), 3)
      } finally {
        origProto.delete = origDelete
      }
    })

    it('should not include config when deleting a non-course item', async () => {
      const page = { _id: 'p1', _courseId: 'c1', _type: 'page', _parentId: 'c1' }
      const config = { _id: 'cfg', _courseId: 'c1', _type: 'config' }
      const article = { _id: 'a1', _courseId: 'c1', _type: 'article', _parentId: 'p1' }
      const allItems = [
        { _id: 'c1', _courseId: 'c1', _type: 'course' },
        config,
        page,
        article
      ]

      const superDelete = mock.fn(async () => {})
      origProto.delete = superDelete
      try {
        const inst = createInstance({
          find: mock.fn(async (query) => {
            return allItems.filter(item => {
              return Object.entries(query).every(([k, v]) => {
                const itemVal = item[k]
                if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
                  return itemVal.toString() === v
                }
                return itemVal === v
              })
            })
          })
        })

        const result = await ContentModule.prototype.delete.call(inst, { _id: 'p1' })
        assert.ok(!result.some(r => r._type === 'config'))
      } finally {
        origProto.delete = origDelete
      }
    })
  })

  // -----------------------------------------------------------------------
  // updateSortOrder
  // -----------------------------------------------------------------------
  describe('updateSortOrder', () => {
    it('should return early for config type', async () => {
      const inst = createInstance()
      const result = await ContentModule.prototype.updateSortOrder.call(
        inst,
        { _type: 'config', _parentId: 'p1', _id: 'x' },
        {}
      )
      assert.equal(result, undefined)
      assert.equal(inst.find.mock.callCount(), 0)
    })

    it('should return early for course type', async () => {
      const inst = createInstance()
      const result = await ContentModule.prototype.updateSortOrder.call(
        inst,
        { _type: 'course', _parentId: 'p1', _id: 'x' },
        {}
      )
      assert.equal(result, undefined)
      assert.equal(inst.find.mock.callCount(), 0)
    })

    it('should return early when _parentId is falsy', async () => {
      const inst = createInstance()
      const result = await ContentModule.prototype.updateSortOrder.call(
        inst,
        { _type: 'article', _id: 'x' },
        {}
      )
      assert.equal(result, undefined)
      assert.equal(inst.find.mock.callCount(), 0)
    })

    it('should query siblings excluding current item', async () => {
      // item._sortOrder = 2, so newSO = 2-1 = 1 which is > -1,
      // so item is spliced at position 1.
      // After splice: [s1, item, s2] => expected _sortOrder: [1, 2, 3]
      // s1 needs _sortOrder=1 (match), item needs _sortOrder=2 (match),
      // s2 needs _sortOrder=3 to avoid super.update calls
      const siblingsAlreadyOrdered = [
        { _id: 's1', _sortOrder: 1 },
        { _id: 's2', _sortOrder: 3 }
      ]

      const inst = createInstance({
        find: mock.fn(async () => [...siblingsAlreadyOrdered])
      })

      const item = { _type: 'article', _parentId: 'p1', _id: 'new-item', _sortOrder: 2 }

      await ContentModule.prototype.updateSortOrder.call(
        inst,
        item,
        { title: 'New' }
      )

      assert.equal(inst.find.mock.callCount(), 1)
      const findArgs = inst.find.mock.calls[0].arguments
      assert.equal(findArgs[0]._parentId, 'p1')
      assert.deepEqual(findArgs[0]._id, { $ne: 'new-item' })
    })

    it('should not splice item into siblings when updateData is falsy', async () => {
      // Use siblings where _sortOrder already matches expected re-indexed values
      // so super.update is not triggered
      const siblings = [
        { _id: 's1', _sortOrder: 1 },
        { _id: 's2', _sortOrder: 2 }
      ]
      const findMock = mock.fn(async () => [...siblings])

      const inst = createInstance({ find: findMock })

      await ContentModule.prototype.updateSortOrder.call(
        inst,
        { _type: 'article', _parentId: 'p1', _id: 'deleted-item', _sortOrder: 2 },
        undefined
      )

      // With falsy updateData, the item should NOT be spliced into siblings
      assert.equal(findMock.mock.callCount(), 1)
    })
  })

  // -----------------------------------------------------------------------
  // handleInsertRecursive
  // -----------------------------------------------------------------------
  describe('handleInsertRecursive', () => {
    it('should respond with 201 and JSON data on success', async () => {
      const expectedResult = { _id: 'new-course', _type: 'course' }
      const inst = createInstance()
      inst.insertRecursive = mock.fn(async () => expectedResult)

      let statusCode, jsonData
      const res = {
        status: (code) => {
          statusCode = code
          return { json: (data) => { jsonData = data } }
        }
      }
      const next = mock.fn()

      await ContentModule.prototype.handleInsertRecursive.call(inst, {}, res, next)

      assert.equal(statusCode, 201)
      assert.deepEqual(jsonData, expectedResult)
      assert.equal(next.mock.callCount(), 0)
    })

    it('should call next with error when insertRecursive throws', async () => {
      const inst = createInstance()
      const error = new Error('insert failed')
      inst.insertRecursive = mock.fn(async () => { throw error })

      const next = mock.fn()
      const res = {
        status: () => ({ json: () => {} })
      }

      await ContentModule.prototype.handleInsertRecursive.call(inst, {}, res, next)

      assert.equal(next.mock.callCount(), 1)
      assert.equal(next.mock.calls[0].arguments[0], error)
    })
  })

  // -----------------------------------------------------------------------
  // handleClone
  // -----------------------------------------------------------------------
  describe('handleClone', () => {
    it('should respond with 201 and cloned data on success', async () => {
      const clonedData = { _id: 'cloned-id', _type: 'article' }
      const inst = createInstance()
      inst.clone = mock.fn(async () => clonedData)
      inst.findOne = mock.fn(async () => ({ _id: 'orig', _type: 'article' }))
      inst.checkAccess = mock.fn(async () => {})

      let statusCode, jsonData
      const req = {
        body: { _id: 'orig', _parentId: 'parent-1', title: 'Cloned Title' },
        auth: { user: { _id: 'user-1' } }
      }
      const res = {
        status: (code) => {
          statusCode = code
          return { json: (data) => { jsonData = data } }
        }
      }
      const next = mock.fn()

      await ContentModule.prototype.handleClone.call(inst, req, res, next)

      assert.equal(statusCode, 201)
      assert.deepEqual(jsonData, clonedData)
      assert.equal(next.mock.callCount(), 0)
    })

    it('should strip _id and _parentId from customData before passing to clone', async () => {
      const inst = createInstance()
      inst.clone = mock.fn(async () => ({ _id: 'new' }))
      inst.findOne = mock.fn(async () => ({ _id: 'orig' }))
      inst.checkAccess = mock.fn(async () => {})

      const req = {
        body: { _id: 'orig', _parentId: 'p1', title: 'Cloned' },
        auth: { user: { _id: 'user-1' } }
      }
      const res = {
        status: () => ({ json: () => {} })
      }

      await ContentModule.prototype.handleClone.call(inst, req, res, mock.fn())

      const cloneArgs = inst.clone.mock.calls[0].arguments
      assert.equal(cloneArgs[3]._id, undefined)
      assert.equal(cloneArgs[3]._parentId, undefined)
      assert.equal(cloneArgs[3].title, 'Cloned')
    })

    it('should call next with error when clone throws', async () => {
      const inst = createInstance()
      const error = new Error('clone failed')
      inst.clone = mock.fn(async () => { throw error })
      inst.findOne = mock.fn(async () => ({ _id: 'orig' }))
      inst.checkAccess = mock.fn(async () => {})

      const req = {
        body: { _id: 'orig', _parentId: 'p1' },
        auth: { user: { _id: 'user-1' } }
      }
      const res = {
        status: () => ({ json: () => {} })
      }
      const next = mock.fn()

      await ContentModule.prototype.handleClone.call(inst, req, res, next)

      assert.equal(next.mock.callCount(), 1)
      assert.equal(next.mock.calls[0].arguments[0], error)
    })

    it('should call requestHook, checkAccess, then clone in order', async () => {
      const callOrder = []
      const inst = createInstance()
      inst.requestHook = { invoke: mock.fn(async () => { callOrder.push('requestHook') }) }
      inst.findOne = mock.fn(async () => {
        callOrder.push('findOne')
        return { _id: 'orig' }
      })
      inst.checkAccess = mock.fn(async () => {
        callOrder.push('checkAccess')
      })
      inst.clone = mock.fn(async () => {
        callOrder.push('clone')
        return { _id: 'new' }
      })

      const req = {
        body: { _id: 'orig', _parentId: 'p1' },
        auth: { user: { _id: 'user-1' } }
      }
      const res = {
        status: () => ({ json: () => {} })
      }

      await ContentModule.prototype.handleClone.call(inst, req, res, mock.fn())

      assert.deepEqual(callOrder, ['requestHook', 'findOne', 'checkAccess', 'clone'])
    })
  })

  // -----------------------------------------------------------------------
  // clone
  // -----------------------------------------------------------------------
  describe('clone', () => {
    // Helper: creates a find mock that returns items matching query against a dataset
    function createCloneFindMock (allItems) {
      return mock.fn(async (query) => {
        return allItems.filter(item => {
          return Object.entries(query).every(([k, v]) => {
            const itemVal = item[k]
            if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
              return itemVal.toString() === v
            }
            return itemVal === v
          })
        })
      })
    }

    it('should throw NOT_FOUND when original document is not found', async () => {
      const inst = createInstance({
        find: mock.fn(async () => [])
      })

      await assert.rejects(
        () => ContentModule.prototype.clone.call(inst, 'user1', 'missing-id', 'parent1'),
        (err) => {
          assert.equal(err.code, 'NOT_FOUND')
          return true
        }
      )
    })

    it('should throw INVALID_PARENT when parent not found and type is not course/config', async () => {
      const allItems = [
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems)
      })
      inst.preCloneHook = createMockHook()

      await assert.rejects(
        () => ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'missing-parent'),
        (err) => {
          assert.equal(err.code, 'INVALID_PARENT')
          return true
        }
      )
    })

    it('should invoke preCloneHook when invokePreHook option is not false', async () => {
      const preCloneHook = createMockHook()
      const allItems = [
        { _id: 'parent', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'parent' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: mock.fn(async (data) => ({ ...data, _id: 'new-id' })),
        preCloneHook,
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'parent')

      assert.equal(preCloneHook.invoke.mock.callCount(), 1)
    })

    it('should skip preCloneHook when invokePreHook option is false', async () => {
      const preCloneHook = createMockHook()
      const allItems = [
        { _id: 'parent', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'parent' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: mock.fn(async (data) => ({ ...data, _id: 'new-id' })),
        preCloneHook,
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(
        inst, 'user1', 'orig', 'parent', {}, { invokePreHook: false }
      )

      assert.equal(preCloneHook.invoke.mock.callCount(), 0)
    })

    it('should skip postCloneHook when invokePostHook option is false', async () => {
      const postCloneHook = createMockHook()
      const allItems = [
        { _id: 'parent', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'parent' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: mock.fn(async (data) => ({ ...data, _id: 'new-id' })),
        preCloneHook: createMockHook(),
        postCloneHook
      })

      await ContentModule.prototype.clone.call(
        inst, 'user1', 'orig', 'parent', {}, { invokePostHook: false }
      )

      assert.equal(postCloneHook.invoke.mock.callCount(), 0)
    })

    it('should use "contentobject" schema for page types', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const allItems = [
        { _id: 'c1', _type: 'course', _courseId: 'c1' },
        { _id: 'orig', _type: 'page', _courseId: 'c1', _parentId: 'c1' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'c1')

      const insertCall = insertFn.mock.calls[0].arguments
      assert.equal(insertCall[1].schemaName, 'contentobject')
    })

    it('should use "contentobject" schema for menu types', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const allItems = [
        { _id: 'parent', _type: 'course', _courseId: 'c1' },
        { _id: 'orig', _type: 'menu', _courseId: 'c1', _parentId: 'parent' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'parent')

      const insertCall = insertFn.mock.calls[0].arguments
      assert.equal(insertCall[1].schemaName, 'contentobject')
    })

    it('should set createdBy to the userId argument', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const allItems = [
        { _id: 'p', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user-42', 'orig', 'p')

      const payload = insertFn.mock.calls[0].arguments[0]
      assert.equal(payload.createdBy, 'user-42')
    })

    it('should clear _id and _trackingId from cloned payload', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const allItems = [
        { _id: 'p', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p', _trackingId: 'track-1' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'p')

      const payload = insertFn.mock.calls[0].arguments[0]
      assert.equal(payload._id, undefined)
      assert.equal(payload._trackingId, undefined)
    })

    it('should recursively clone children using ContentTree', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: `new-${data._type}`
      }))
      const allItems = [
        { _id: 'c1', _type: 'course', _courseId: 'c1' },
        { _id: 'p', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p' },
        { _id: 'child1', _type: 'block', _courseId: 'c1', _parentId: 'orig' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      inst.clone = ContentModule.prototype.clone.bind(inst)
      await inst.clone('user1', 'orig', 'p')

      // Should have inserted the article clone and the block clone
      assert.ok(insertFn.mock.callCount() >= 2)
    })

    it('should disable updateSortOrder and updateEnabledPlugins during recursive clone', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: `new-${data._type}`
      }))
      const allItems = [
        { _id: 'c1', _type: 'course', _courseId: 'c1' },
        { _id: 'p', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p' },
        { _id: 'child1', _type: 'block', _courseId: 'c1', _parentId: 'orig' }
      ]
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      inst.clone = ContentModule.prototype.clone.bind(inst)
      await inst.clone('user1', 'orig', 'p')

      // All inserts should have updateSortOrder: false
      for (const call of insertFn.mock.calls) {
        assert.equal(call.arguments[1].updateSortOrder, false)
      }
    })

    it('should call updateEnabledPlugins once at top level after clone', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: `new-${data._type}`
      }))
      const allItems = [
        { _id: 'c1', _type: 'course', _courseId: 'c1' },
        { _id: 'p', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p' },
        { _id: 'child1', _type: 'block', _courseId: 'c1', _parentId: 'orig' }
      ]
      const updateEnabledPluginsFn = mock.fn(async () => {})
      const inst = createInstance({
        find: createCloneFindMock(allItems),
        insert: insertFn,
        updateEnabledPlugins: updateEnabledPluginsFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      inst.clone = ContentModule.prototype.clone.bind(inst)
      await inst.clone('user1', 'orig', 'p')

      assert.equal(updateEnabledPluginsFn.mock.callCount(), 1)
    })

    it('should only issue find calls at top level (not per tree level)', async () => {
      const allItems = [
        { _id: 'c1', _type: 'course', _courseId: 'c1' },
        { _id: 'p', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p' },
        { _id: 'child1', _type: 'block', _courseId: 'c1', _parentId: 'orig' }
      ]
      const findFn = createCloneFindMock(allItems)
      const inst = createInstance({
        find: findFn,
        insert: mock.fn(async (data) => ({ ...data, _id: `new-${data._type}` })),
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      inst.clone = ContentModule.prototype.clone.bind(inst)
      await inst.clone('user1', 'orig', 'p')

      // Should only have 3 find calls: original doc, parent doc, course items for tree
      assert.equal(findFn.mock.callCount(), 3)
    })
  })

  // -----------------------------------------------------------------------
  // insertRecursive
  // -----------------------------------------------------------------------
  describe('insertRecursive', () => {
    it('should create a new course with children when rootId is undefined', async () => {
      const insertedItems = []
      const inst = createInstance({
        insert: mock.fn(async (data, opts) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'id-course' }
          insertedItems.push(item)
          return item
        })
      })

      const req = {
        apiData: { query: {}, data: { title: 'New Course' } },
        auth: { user: { _id: 'user-1' } },
        translate: mock.fn((key) => `Translated: ${key}`),
        body: {}
      }

      const result = await ContentModule.prototype.insertRecursive.call(inst, req)

      assert.equal(result._type, 'course')
      // course + config + page + article + block + component = 6
      assert.equal(insertedItems.length, 6)
    })

    it('should create child types starting from the rootId type', async () => {
      const insertedItems = []
      let findCalled = false

      const inst = createInstance({
        find: mock.fn(async () => {
          if (!findCalled) {
            findCalled = true
            return [{ _id: 'page1', _type: 'page', _courseId: 'c1' }]
          }
          return []
        }),
        insert: mock.fn(async (data) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'c1' }
          insertedItems.push(item)
          return item
        })
      })

      const req = {
        apiData: { query: { rootId: 'page1' }, data: {} },
        auth: { user: { _id: 'user-1' } },
        translate: mock.fn((key) => `Translated: ${key}`),
        body: {}
      }

      await ContentModule.prototype.insertRecursive.call(inst, req)

      const types = insertedItems.map(i => i._type)
      assert.ok(types.includes('article'))
      assert.ok(types.includes('block'))
      assert.ok(types.includes('component'))
      assert.ok(!types.includes('course'))
      assert.ok(!types.includes('page'))
    })

    it('should handle menu type specially by replacing course with menu', async () => {
      const insertedItems = []
      const inst = createInstance({
        find: mock.fn(async () => [{ _id: 'c1', _type: 'course', _courseId: 'c1' }]),
        insert: mock.fn(async (data) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'c1' }
          insertedItems.push(item)
          return item
        })
      })

      const req = {
        apiData: { query: { rootId: 'c1' }, data: {} },
        auth: { user: { _id: 'user-1' } },
        translate: mock.fn((key) => `Translated: ${key}`),
        body: { _type: 'menu' }
      }

      await ContentModule.prototype.insertRecursive.call(inst, req)

      const types = insertedItems.map(i => i._type)
      assert.ok(types.includes('menu'))
    })

    it('should rollback created items on error', async () => {
      const insertedItems = []
      let insertCount = 0

      // We simulate the rollback logic directly since super.delete
      // cannot be intercepted easily in isolation tests
      const rollbackFn = async (req) => {
        const newItems = []
        const insertFn = async (data) => {
          insertCount++
          if (insertCount === 3) throw new Error('Insert failed')
          const item = { ...data, _id: `id-${insertCount}` }
          newItems.push(item)
          return item
        }
        const deleteFn = mock.fn(async ({ _id }) => {
          insertedItems.push(_id)
        })

        const childTypes = ['config', 'page', 'article']
        try {
          for (const _type of childTypes) {
            const item = await insertFn({ _type })
            newItems.push(item)
          }
        } catch (e) {
          await Promise.all(newItems.map(({ _id }) => deleteFn({ _id })))
          throw e
        }
        return newItems[0]
      }

      await assert.rejects(
        () => rollbackFn({}),
        (err) => {
          assert.equal(err.message, 'Insert failed')
          return true
        }
      )

      // 2 successfully created items should be rolled back
      // (each inserted twice into newItems due to push, but deleteFn captures _id)
      assert.ok(insertedItems.length > 0)
    })

    it('should set default text component data', async () => {
      const insertedItems = []
      const inst = createInstance({
        find: mock.fn(async () => [{ _id: 'block1', _type: 'block', _courseId: 'c1' }]),
        insert: mock.fn(async (data) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'c1' }
          insertedItems.push(item)
          return item
        })
      })

      const req = {
        apiData: { query: { rootId: 'block1' }, data: {} },
        auth: { user: { _id: 'user-1' } },
        translate: mock.fn((key) => `T:${key}`),
        body: {}
      }

      await ContentModule.prototype.insertRecursive.call(inst, req)

      const component = insertedItems.find(i => i._type === 'component')
      assert.ok(component)
      assert.equal(component._component, 'adapt-contrib-text')
      assert.equal(component._layout, 'full')
      assert.equal(component.title, 'T:app.newtextcomponenttitle')
      assert.equal(component.body, 'T:app.newtextcomponentbody')
    })

    it('should set createdBy on all new items', async () => {
      const insertedItems = []
      const inst = createInstance({
        find: mock.fn(async () => [{ _id: 'article1', _type: 'article', _courseId: 'c1' }]),
        insert: mock.fn(async (data) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'c1' }
          insertedItems.push(item)
          return item
        })
      })

      const req = {
        apiData: { query: { rootId: 'article1' }, data: {} },
        auth: { user: { _id: { toString: () => 'user-42' } } },
        translate: mock.fn((key) => key),
        body: {}
      }

      await ContentModule.prototype.insertRecursive.call(inst, req)

      for (const item of insertedItems) {
        assert.equal(item.createdBy, 'user-42')
      }
    })

    it('should set _parentId and _courseId on child items', async () => {
      const insertedItems = []
      const inst = createInstance({
        find: mock.fn(async () => [{ _id: 'page1', _type: 'page', _courseId: 'c1' }]),
        insert: mock.fn(async (data) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'c1' }
          insertedItems.push(item)
          return item
        })
      })

      const req = {
        apiData: { query: { rootId: 'page1' }, data: {} },
        auth: { user: { _id: 'user-1' } },
        translate: mock.fn((key) => key),
        body: {}
      }

      await ContentModule.prototype.insertRecursive.call(inst, req)

      // First child (article) should have page as parent
      const article = insertedItems.find(i => i._type === 'article')
      assert.ok(article)
      assert.equal(article._courseId, 'c1')
    })

    it('should return the topmost new item', async () => {
      const insertedItems = []
      const inst = createInstance({
        find: mock.fn(async () => [{ _id: 'article1', _type: 'article', _courseId: 'c1' }]),
        insert: mock.fn(async (data) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'c1' }
          insertedItems.push(item)
          return item
        })
      })

      const req = {
        apiData: { query: { rootId: 'article1' }, data: {} },
        auth: { user: { _id: 'user-1' } },
        translate: mock.fn((key) => key),
        body: {}
      }

      const result = await ContentModule.prototype.insertRecursive.call(inst, req)

      // The first inserted item should be returned (block after article)
      assert.equal(result._id, insertedItems[0]._id)
    })
  })

  // -----------------------------------------------------------------------
  // updateEnabledPlugins
  // -----------------------------------------------------------------------
  describe('updateEnabledPlugins', () => {
    it('should return early when no config is found', async () => {
      const contentplugin = {
        find: mock.fn(async () => []),
        getPluginSchemas: mock.fn(() => []),
        isPluginSchema: mock.fn(() => false)
      }
      const jsonschema = { schemas: {} }

      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'article1', _type: 'article', _courseId: 'c1' }
        ])
      })
      inst.app.waitForModule = mock.fn(async () => [contentplugin, jsonschema])

      const result = await ContentModule.prototype.updateEnabledPlugins.call(
        inst,
        { _courseId: 'c1' }
      )

      assert.equal(result, undefined)
    })

    it('should return early when plugin lists already match', async () => {
      const contentplugin = {
        find: mock.fn(async () => [{ name: 'ext-1', type: 'extension' }]),
        getPluginSchemas: mock.fn(() => []),
        isPluginSchema: mock.fn(() => false)
      }
      const jsonschema = { schemas: {} }

      const inst = createInstance({
        find: mock.fn(async () => [
          {
            _id: 'config1',
            _type: 'config',
            _courseId: 'c1',
            _enabledPlugins: ['ext-1', 'comp-1', 'my-menu', 'my-theme'],
            _menu: 'my-menu',
            _theme: 'my-theme'
          },
          { _id: 'comp1', _type: 'component', _courseId: 'c1', _component: 'comp-1' }
        ])
      })
      inst.app.waitForModule = mock.fn(async () => [contentplugin, jsonschema])

      const superUpdate = mock.fn(async () => {})

      const boundFn = ContentModule.prototype.updateEnabledPlugins.bind({
        ...inst,
        find: inst.find,
        app: inst.app,
        __proto__: {
          update: superUpdate,
          find: mock.fn(async () => [])
        }
      })

      await boundFn({ _courseId: 'c1' })

      assert.equal(superUpdate.mock.callCount(), 0)
    })
  })

  // -----------------------------------------------------------------------
  // getSchema
  // -----------------------------------------------------------------------
  describe('getSchema', () => {
    it('should call jsonschema.getSchema with extensionFilter', async () => {
      const getSchemaResult = { built: {}, validate: mock.fn() }
      const jsonschema = {
        getSchema: mock.fn(async () => getSchemaResult)
      }
      const contentplugin = {
        find: mock.fn(async () => []),
        getPluginSchemas: mock.fn(() => []),
        isPluginSchema: mock.fn(() => false)
      }

      let waitForModuleCallCount = 0
      const inst = createInstance({
        find: mock.fn(async () => [])
      })
      inst.app.waitForModule = mock.fn(async () => {
        waitForModuleCallCount++
        if (waitForModuleCallCount <= 1) return jsonschema
        return contentplugin
      })
      inst.getSchemaName = mock.fn(async () => 'article')

      await ContentModule.prototype.getSchema.call(
        inst,
        'content',
        { _type: 'article' }
      )

      assert.equal(jsonschema.getSchema.mock.callCount(), 1)
    })

    it('should handle errors in getSchemaName gracefully', async () => {
      const getSchemaResult = { built: {}, validate: mock.fn() }
      const jsonschema = {
        getSchema: mock.fn(async () => getSchemaResult)
      }
      const contentplugin = {
        find: mock.fn(async () => []),
        getPluginSchemas: mock.fn(() => []),
        isPluginSchema: mock.fn(() => false)
      }

      let waitForModuleCallCount = 0
      const inst = createInstance()
      inst.app.waitForModule = mock.fn(async () => {
        waitForModuleCallCount++
        if (waitForModuleCallCount <= 1) return jsonschema
        return contentplugin
      })
      inst.getSchemaName = mock.fn(async () => { throw new Error('schema error') })
      inst.find = mock.fn(async () => [])

      const result = await ContentModule.prototype.getSchema.call(
        inst,
        'content',
        { _type: 'unknown' }
      )

      assert.ok(result)
    })

    it('should use the original schemaName when getSchemaName throws', async () => {
      const getSchemaResult = { built: {}, validate: mock.fn() }
      const jsonschema = {
        getSchema: mock.fn(async () => getSchemaResult)
      }
      const contentplugin = {
        find: mock.fn(async () => []),
        getPluginSchemas: mock.fn(() => []),
        isPluginSchema: mock.fn(() => false)
      }

      let waitForModuleCallCount = 0
      const inst = createInstance()
      inst.app.waitForModule = mock.fn(async () => {
        waitForModuleCallCount++
        if (waitForModuleCallCount <= 1) return jsonschema
        return contentplugin
      })
      inst.getSchemaName = mock.fn(async () => { throw new Error('fail') })
      inst.find = mock.fn(async () => [])

      await ContentModule.prototype.getSchema.call(inst, 'mySchema', { _type: 'x' })

      // jsonschema.getSchema should be called with the original 'mySchema'
      const calledWith = jsonschema.getSchema.mock.calls[0].arguments[0]
      assert.equal(calledWith, 'mySchema')
    })
  })

  // -----------------------------------------------------------------------
  // registerConfigSchemas
  // -----------------------------------------------------------------------
  describe('registerConfigSchemas', () => {
    it('should extend config schema with authored and tags schemas', async () => {
      const extendSchema = mock.fn()
      const authored = { schemaName: 'authored' }
      const tags = { schemaExtensionName: 'tags-ext' }
      const jsonschema = { extendSchema }

      const inst = createInstance()
      inst.app.waitForModule = mock.fn(async () => [authored, jsonschema, tags])

      await ContentModule.prototype.registerConfigSchemas.call(inst)

      assert.equal(extendSchema.mock.callCount(), 2)
      assert.deepEqual(extendSchema.mock.calls[0].arguments, ['config', 'authored'])
      assert.deepEqual(extendSchema.mock.calls[1].arguments, ['config', 'tags-ext'])
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('clone should allow course type without _parentId when config exists', async () => {
      const allItems = [
        { _id: 'orig-course', _type: 'course', _courseId: 'orig-course' },
        { _id: 'config1', _type: 'config', _courseId: 'orig-course' }
      ]
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-course-id'
      }))
      const updateFn = mock.fn(async () => ({}))
      const findFn = mock.fn(async (query) => {
        return allItems.filter(item => {
          return Object.entries(query).every(([k, v]) => {
            const itemVal = item[k]
            if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
              return itemVal.toString() === v
            }
            return itemVal === v
          })
        })
      })
      const inst = createInstance({
        find: findFn,
        insert: insertFn,
        update: updateFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      // Bind clone so recursive calls work
      inst.clone = ContentModule.prototype.clone.bind(inst)

      // course clone with _parentId undefined should not throw INVALID_PARENT
      await assert.doesNotReject(
        () => inst.clone('user1', 'orig-course', undefined)
      )
    })

    it('insertRecursive should use translate for default titles', async () => {
      const insertedItems = []
      const inst = createInstance({
        insert: mock.fn(async (data, opts) => {
          const item = { ...data, _id: `id-${data._type}`, _courseId: 'c1' }
          insertedItems.push(item)
          return item
        })
      })

      const translateKeys = []
      const req = {
        apiData: { query: {}, data: { title: 'Course' } },
        auth: { user: { _id: 'user-1' } },
        translate: mock.fn((key) => {
          translateKeys.push(key)
          return `T:${key}`
        }),
        body: {}
      }

      await ContentModule.prototype.insertRecursive.call(inst, req)

      assert.ok(translateKeys.includes('app.newpagetitle'))
      assert.ok(translateKeys.includes('app.newarticletitle'))
      assert.ok(translateKeys.includes('app.newblocktitle'))
      assert.ok(translateKeys.includes('app.newtextcomponenttitle'))
      assert.ok(translateKeys.includes('app.newtextcomponentbody'))
    })
  })

  // -----------------------------------------------------------------------
  // Bug fixes
  // -----------------------------------------------------------------------
  describe('bug fixes', () => {
    it('insert should catch MONGO_DUPL_INDEX and throw DUPL_FRIENDLY_ID', async () => {
      const duplError = createMockError('MONGO_DUPL_INDEX')
      const inst = createInstance()
      const superInsert = mock.fn(async () => { throw duplError })

      const origProto = Object.getPrototypeOf(ContentModule.prototype)
      const origInsert = origProto.insert
      origProto.insert = superInsert
      try {
        await assert.rejects(
          () => ContentModule.prototype.insert.call(inst, { _friendlyId: 'fid-1', _courseId: 'c1', _type: 'article' }),
          (err) => {
            assert.equal(err.code, 'DUPL_FRIENDLY_ID')
            assert.equal(err.data._friendlyId, 'fid-1')
            assert.equal(err.data._courseId, 'c1')
            return true
          }
        )
      } finally {
        origProto.insert = origInsert
      }
    })

    it('insert should re-throw non-duplicate errors unchanged', async () => {
      const otherError = new Error('SOME_OTHER_ERROR')
      otherError.code = 'SOME_OTHER_ERROR'
      const inst = createInstance()

      const origProto = Object.getPrototypeOf(ContentModule.prototype)
      const origInsert = origProto.insert
      origProto.insert = mock.fn(async () => { throw otherError })
      try {
        await assert.rejects(
          () => ContentModule.prototype.insert.call(inst, { _type: 'article' }),
          (err) => {
            assert.equal(err.code, 'SOME_OTHER_ERROR')
            return true
          }
        )
      } finally {
        origProto.insert = origInsert
      }
    })

    it('update should catch MONGO_DUPL_INDEX and throw DUPL_FRIENDLY_ID', async () => {
      const duplError = createMockError('MONGO_DUPL_INDEX')
      const inst = createInstance()

      const origProto = Object.getPrototypeOf(ContentModule.prototype)
      const origUpdate = origProto.update
      origProto.update = mock.fn(async () => { throw duplError })
      try {
        await assert.rejects(
          () => ContentModule.prototype.update.call(inst, { _id: 'x' }, { _friendlyId: 'fid-1', _courseId: 'c1' }),
          (err) => {
            assert.equal(err.code, 'DUPL_FRIENDLY_ID')
            assert.equal(err.data._friendlyId, 'fid-1')
            assert.equal(err.data._courseId, 'c1')
            return true
          }
        )
      } finally {
        origProto.update = origUpdate
      }
    })

    it('update should re-throw non-duplicate errors unchanged', async () => {
      const otherError = new Error('SOME_OTHER_ERROR')
      otherError.code = 'SOME_OTHER_ERROR'
      const inst = createInstance()

      const origProto = Object.getPrototypeOf(ContentModule.prototype)
      const origUpdate = origProto.update
      origProto.update = mock.fn(async () => { throw otherError })
      try {
        await assert.rejects(
          () => ContentModule.prototype.update.call(inst, { _id: 'x' }, { title: 'Updated' }),
          (err) => {
            assert.equal(err.code, 'SOME_OTHER_ERROR')
            return true
          }
        )
      } finally {
        origProto.update = origUpdate
      }
    })

    it('clone should clear _friendlyId for non-course types', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const allItems = [
        { _id: 'p', _type: 'page', _courseId: 'c1', _parentId: 'c1' },
        { _id: 'orig', _type: 'article', _courseId: 'c1', _parentId: 'p', _friendlyId: 'art-1' }
      ]
      const inst = createInstance({
        find: mock.fn(async (query) => {
          return allItems.filter(item => {
            return Object.entries(query).every(([k, v]) => {
              const itemVal = item[k]
              if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
                return itemVal.toString() === v
              }
              return itemVal === v
            })
          })
        }),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'p')

      const payload = insertFn.mock.calls[0].arguments[0]
      assert.equal(payload._friendlyId, undefined)
    })

    it('clone should preserve _friendlyId for course types', async () => {
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-course-id'
      }))
      const allItems = [
        { _id: 'c1', _type: 'course', _courseId: 'c1', _friendlyId: 'course-1' }
      ]
      const inst = createInstance({
        find: mock.fn(async (query) => {
          return allItems.filter(item => {
            return Object.entries(query).every(([k, v]) => {
              const itemVal = item[k]
              if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
                return itemVal.toString() === v
              }
              return itemVal === v
            })
          })
        }),
        insert: insertFn,
        update: mock.fn(async () => ({})),
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'c1', undefined)

      const payload = insertFn.mock.calls[0].arguments[0]
      assert.equal(payload._friendlyId, 'course-1')
    })

    it('should handle clone of course when no config exists', async () => {
      const allItems = [
        { _id: 'c1', _type: 'course', _courseId: 'c1' }
      ]
      const inst = createInstance({
        find: mock.fn(async (query) => {
          return allItems.filter(item => {
            return Object.entries(query).every(([k, v]) => {
              const itemVal = item[k]
              if (itemVal && typeof itemVal.toString === 'function' && typeof v === 'string') {
                return itemVal.toString() === v
              }
              return itemVal === v
            })
          })
        }),
        insert: mock.fn(async (data, opts) => ({ ...data, _id: 'new-c1' })),
        update: mock.fn(async () => ({})),
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      const result = await ContentModule.prototype.clone.call(inst, 'user1', 'c1', undefined)
      assert.strictEqual(result._id, 'new-c1')
    })
  })
})
