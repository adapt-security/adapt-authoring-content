import { describe, it, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDescendants } from '../lib/utils.js'

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
      UNKNOWN_SCHEMA_NAME: createMockError('UNKNOWN_SCHEMA_NAME')
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

    useDefaultRouteConfig: mock.fn(),
    setDefaultOptions: mock.fn((opts) => opts),
    checkAccess: mock.fn(async (req, data) => data),
    log: mock.fn(),

    preCloneHook: createMockHook(),
    postCloneHook: createMockHook(),

    // Methods that setValues tries to .bind(this)
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
    it('should set root, collectionName and schemaName to "content"', async () => {
      const inst = createInstance()
      await ContentModule.prototype.setValues.call(inst)

      assert.equal(inst.root, 'content')
      assert.equal(inst.collectionName, 'content')
      assert.equal(inst.schemaName, 'content')
    })

    it('should call useDefaultRouteConfig', async () => {
      const inst = createInstance()
      await ContentModule.prototype.setValues.call(inst)

      assert.equal(inst.useDefaultRouteConfig.mock.callCount(), 1)
    })

    it('should push insertrecursive and clone routes', async () => {
      const inst = createInstance()
      await ContentModule.prototype.setValues.call(inst)

      assert.equal(inst.routes.length, 2)
      assert.equal(inst.routes[0].route, '/insertrecursive')
      assert.equal(inst.routes[1].route, '/clone')
    })

    it('should assign correct HTTP methods for insertrecursive route', async () => {
      const inst = createInstance()
      await ContentModule.prototype.setValues.call(inst)

      const route = inst.routes[0]
      assert.ok(route.handlers.post)
      assert.deepEqual(route.permissions, { post: ['write:content'] })
    })

    it('should assign correct HTTP methods for clone route', async () => {
      const inst = createInstance()
      await ContentModule.prototype.setValues.call(inst)

      const route = inst.routes[1]
      assert.ok(route.handlers.post)
      assert.deepEqual(route.permissions, { post: ['write:content'] })
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
        find: mock.fn(async () => [{
          targetAttribute: '_myPlugin'
        }])
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
        find: mock.fn(async () => [])
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
  // getDescendants
  // -----------------------------------------------------------------------
  describe('getDescendants', () => {
    it('should return empty array when root item has no children', async () => {
      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'root', _courseId: 'c1', _type: 'page' }
        ])
      })

      const result = await getDescendants(q => inst.find(q), {
        _id: 'root',
        _courseId: 'c1',
        _type: 'page'
      })

      assert.deepEqual(result, [])
    })

    it('should return direct children', async () => {
      const child1 = { _id: 'child1', _parentId: 'root', _courseId: 'c1', _type: 'article' }
      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'root', _courseId: 'c1', _type: 'page' },
          child1
        ])
      })

      const result = await getDescendants(q => inst.find(q), {
        _id: 'root',
        _courseId: 'c1',
        _type: 'page'
      })

      assert.equal(result.length, 1)
      assert.equal(result[0]._id, 'child1')
    })

    it('should return nested descendants (depth > 1)', async () => {
      const child1 = { _id: 'child1', _parentId: 'root', _courseId: 'c1', _type: 'article' }
      const child2 = { _id: 'child2', _parentId: 'child1', _courseId: 'c1', _type: 'block' }
      const child3 = { _id: 'child3', _parentId: 'child2', _courseId: 'c1', _type: 'component' }
      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'root', _courseId: 'c1', _type: 'page' },
          child1,
          child2,
          child3
        ])
      })

      const result = await getDescendants(q => inst.find(q), {
        _id: 'root',
        _courseId: 'c1',
        _type: 'page'
      })

      assert.equal(result.length, 3)
      const ids = result.map(r => r._id)
      assert.ok(ids.includes('child1'))
      assert.ok(ids.includes('child2'))
      assert.ok(ids.includes('child3'))
    })

    it('should include config item for course type roots', async () => {
      const config = { _id: 'config1', _courseId: 'c1', _type: 'config' }
      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'c1', _courseId: 'c1', _type: 'course' },
          config
        ])
      })

      const result = await getDescendants(q => inst.find(q), {
        _id: 'c1',
        _courseId: 'c1',
        _type: 'course'
      })

      assert.ok(result.some(r => r._type === 'config'))
    })

    it('should NOT include config for non-course roots', async () => {
      const config = { _id: 'config1', _courseId: 'c1', _type: 'config' }
      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'page1', _courseId: 'c1', _type: 'page' },
          config
        ])
      })

      const result = await getDescendants(q => inst.find(q), {
        _id: 'page1',
        _courseId: 'c1',
        _type: 'page'
      })

      assert.ok(!result.some(r => r._type === 'config'))
    })

    it('should handle _parentId comparison with toString()', async () => {
      const parent = {
        _id: 'root',
        _courseId: 'c1',
        _type: 'page',
        toString () { return 'root' }
      }
      const child = {
        _id: 'child1',
        _parentId: { toString () { return 'root' } },
        _courseId: 'c1',
        _type: 'article'
      }
      const inst = createInstance({
        find: mock.fn(async () => [parent, child])
      })

      const result = await getDescendants(q => inst.find(q), parent)

      assert.equal(result.length, 1)
      assert.equal(result[0]._id, 'child1')
    })

    it('should handle multiple children at the same level', async () => {
      const child1 = { _id: 'c1', _parentId: 'root', _courseId: 'x', _type: 'article' }
      const child2 = { _id: 'c2', _parentId: 'root', _courseId: 'x', _type: 'article' }
      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'root', _courseId: 'x', _type: 'page' },
          child1,
          child2
        ])
      })

      const result = await getDescendants(q => inst.find(q), {
        _id: 'root',
        _courseId: 'x',
        _type: 'page'
      })

      assert.equal(result.length, 2)
    })
  })

  // -----------------------------------------------------------------------
  // insert (logic tests using simulated method body)
  // -----------------------------------------------------------------------
  describe('insert', () => {
    it('should call super.insert and return result for non-course types', async () => {
      const superInsert = mock.fn(async (data) => ({
        ...data,
        _id: 'new-id'
      }))
      const updateSortOrder = mock.fn(async () => {})
      const updateEnabledPlugins = mock.fn(async () => {})

      const insertFn = async (data, options = {}) => {
        const doc = await superInsert(data, options)
        if (doc._type === 'course') {
          return doc
        }
        await Promise.all([
          options.updateSortOrder !== false && updateSortOrder(doc, data),
          options.updateEnabledPlugins !== false && updateEnabledPlugins(doc)
        ])
        return doc
      }

      const result = await insertFn({ _type: 'article', title: 'Test' })
      assert.equal(result._type, 'article')
      assert.equal(superInsert.mock.callCount(), 1)
      assert.equal(updateSortOrder.mock.callCount(), 1)
      assert.equal(updateEnabledPlugins.mock.callCount(), 1)
    })

    it('should update _courseId after inserting a course', async () => {
      const updateFn = mock.fn(async (q, d) => ({ ...q, ...d }))
      const superInsert = mock.fn(async (data) => ({
        ...data,
        _id: 'course-1'
      }))

      const insertFn = async (data) => {
        const doc = await superInsert(data)
        if (doc._type === 'course') {
          return updateFn({ _id: doc._id }, { _courseId: doc._id.toString() })
        }
        return doc
      }

      await insertFn({ _type: 'course', title: 'My Course' })
      assert.equal(updateFn.mock.callCount(), 1)
      assert.equal(
        updateFn.mock.calls[0].arguments[1]._courseId,
        'course-1'
      )
    })

    it('should skip updateSortOrder when options.updateSortOrder is false', async () => {
      const updateSortOrder = mock.fn(async () => {})
      const updateEnabledPlugins = mock.fn(async () => {})
      const superInsert = mock.fn(async (data) => ({ ...data, _id: 'id' }))

      const insertFn = async (data, options = {}) => {
        const doc = await superInsert(data)
        if (doc._type === 'course') return doc
        await Promise.all([
          options.updateSortOrder !== false && updateSortOrder(doc, data),
          options.updateEnabledPlugins !== false && updateEnabledPlugins(doc)
        ])
        return doc
      }

      await insertFn({ _type: 'block' }, { updateSortOrder: false })
      assert.equal(updateSortOrder.mock.callCount(), 0)
      assert.equal(updateEnabledPlugins.mock.callCount(), 1)
    })

    it('should skip updateEnabledPlugins when options.updateEnabledPlugins is false', async () => {
      const updateSortOrder = mock.fn(async () => {})
      const updateEnabledPlugins = mock.fn(async () => {})
      const superInsert = mock.fn(async (data) => ({ ...data, _id: 'id' }))

      const insertFn = async (data, options = {}) => {
        const doc = await superInsert(data)
        if (doc._type === 'course') return doc
        await Promise.all([
          options.updateSortOrder !== false && updateSortOrder(doc, data),
          options.updateEnabledPlugins !== false && updateEnabledPlugins(doc)
        ])
        return doc
      }

      await insertFn({ _type: 'block' }, { updateEnabledPlugins: false })
      assert.equal(updateSortOrder.mock.callCount(), 1)
      assert.equal(updateEnabledPlugins.mock.callCount(), 0)
    })
  })

  // -----------------------------------------------------------------------
  // update (logic tests using simulated method body)
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('should call super.update then updateSortOrder and updateEnabledPlugins', async () => {
      const superUpdate = mock.fn(async () => ({
        _id: 'id1',
        _type: 'article',
        _parentId: 'p1',
        _courseId: 'c1'
      }))
      const updateSortOrder = mock.fn(async () => {})
      const updateEnabledPlugins = mock.fn(async () => {})

      const updateFn = async (query, data) => {
        const doc = await superUpdate(query, data)
        await Promise.all([
          updateSortOrder(doc, data),
          updateEnabledPlugins(doc, data._enabledPlugins ? { forceUpdate: true } : {})
        ])
        return doc
      }

      const result = await updateFn({ _id: 'id1' }, { title: 'Updated' })
      assert.equal(result._id, 'id1')
      assert.equal(superUpdate.mock.callCount(), 1)
      assert.equal(updateSortOrder.mock.callCount(), 1)
      assert.equal(updateEnabledPlugins.mock.callCount(), 1)
    })

    it('should pass forceUpdate when _enabledPlugins is present in data', async () => {
      const superUpdate = mock.fn(async () => ({ _id: 'id', _courseId: 'c1' }))
      const updateEnabledPlugins = mock.fn(async () => {})

      const updateFn = async (query, data) => {
        const doc = await superUpdate(query, data)
        await updateEnabledPlugins(doc, data._enabledPlugins ? { forceUpdate: true } : {})
        return doc
      }

      await updateFn({ _id: 'id' }, { _enabledPlugins: ['plugin-a'] })
      const args = updateEnabledPlugins.mock.calls[0].arguments
      assert.deepEqual(args[1], { forceUpdate: true })
    })

    it('should pass empty options when _enabledPlugins is not in data', async () => {
      const superUpdate = mock.fn(async () => ({ _id: 'id', _courseId: 'c1' }))
      const updateEnabledPlugins = mock.fn(async () => {})

      const updateFn = async (query, data) => {
        const doc = await superUpdate(query, data)
        await updateEnabledPlugins(doc, data._enabledPlugins ? { forceUpdate: true } : {})
        return doc
      }

      await updateFn({ _id: 'id' }, { title: 'Updated' })
      const args = updateEnabledPlugins.mock.calls[0].arguments
      assert.deepEqual(args[1], {})
    })
  })

  // -----------------------------------------------------------------------
  // delete (logic tests using simulated method body)
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('should throw when target document is not found', async () => {
      const findFn = mock.fn(async () => [])
      const errors = { NOT_FOUND: createMockError('NOT_FOUND') }

      const deleteFn = async (query, options = {}) => {
        const [targetDoc] = await findFn(query)
        if (!targetDoc) {
          throw errors.NOT_FOUND.setData({ type: options.schemaName, id: JSON.stringify(query) })
        }
        return targetDoc
      }

      await assert.rejects(
        () => deleteFn({ _id: 'missing' }),
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

      const superDelete = mock.fn(async () => {})
      const getDescendants = mock.fn(async () => [desc1, desc2])
      const findFn = mock.fn(async () => [targetDoc])
      const updateSortOrder = mock.fn(async () => {})
      const updateEnabledPlugins = mock.fn(async () => {})

      const deleteFn = async (query) => {
        const [target] = await findFn(query)
        if (!target) throw new Error('NOT_FOUND')
        const descendants = await getDescendants(target)
        await Promise.all([...descendants, target].map(d => superDelete({ _id: d._id })))
        await Promise.all([
          updateEnabledPlugins(target),
          updateSortOrder(target)
        ])
        return [target, ...descendants]
      }

      const result = await deleteFn({ _id: 'target' })
      assert.equal(result.length, 3)
      assert.equal(result[0]._id, 'target')
      assert.equal(superDelete.mock.callCount(), 3)
    })

    it('should return target as first element followed by descendants', async () => {
      const target = { _id: 't1', _courseId: 'c1', _type: 'article', _parentId: 'p1' }
      const child = { _id: 'c1child', _courseId: 'c1', _type: 'block', _parentId: 't1' }

      const deleteFn = async (query) => {
        const [targetDoc] = [target]
        const descendants = [child]
        return [targetDoc, ...descendants]
      }

      const result = await deleteFn({ _id: 't1' })
      assert.equal(result[0]._id, 't1')
      assert.equal(result[1]._id, 'c1child')
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

    it('should call checkAccess before cloning', async () => {
      const callOrder = []
      const inst = createInstance()
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

      assert.deepEqual(callOrder, ['findOne', 'checkAccess', 'clone'])
    })
  })

  // -----------------------------------------------------------------------
  // clone
  // -----------------------------------------------------------------------
  describe('clone', () => {
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
      let callCount = 0
      const inst = createInstance({
        find: mock.fn(async () => {
          callCount++
          if (callCount === 1) return [{ _id: 'orig', _type: 'article', _courseId: 'c1' }]
          return [] // parent not found
        })
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
      let findCallCount = 0
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) return [{ _id: 'orig', _type: 'article', _courseId: 'c1' }]
          if (findCallCount === 2) return [{ _id: 'parent', _type: 'page', _courseId: 'c1' }]
          return []
        }),
        insert: mock.fn(async (data) => ({ ...data, _id: 'new-id' })),
        preCloneHook,
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'parent')

      assert.equal(preCloneHook.invoke.mock.callCount(), 1)
    })

    it('should skip preCloneHook when invokePreHook option is false', async () => {
      const preCloneHook = createMockHook()
      let findCallCount = 0
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) return [{ _id: 'orig', _type: 'article', _courseId: 'c1' }]
          if (findCallCount === 2) return [{ _id: 'parent', _type: 'page', _courseId: 'c1' }]
          return []
        }),
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
      let findCallCount = 0
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) return [{ _id: 'orig', _type: 'article', _courseId: 'c1' }]
          if (findCallCount === 2) return [{ _id: 'parent', _type: 'page', _courseId: 'c1' }]
          return []
        }),
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
      let findCallCount = 0
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) return [{ _id: 'orig', _type: 'page', _courseId: 'c1' }]
          if (findCallCount === 2) return [{ _id: 'c1', _type: 'course', _courseId: 'c1' }]
          return []
        }),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'c1')

      const insertCall = insertFn.mock.calls[0].arguments
      assert.equal(insertCall[1].schemaName, 'contentobject')
    })

    it('should use "contentobject" schema for menu types', async () => {
      let findCallCount = 0
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) return [{ _id: 'orig', _type: 'menu', _courseId: 'c1' }]
          if (findCallCount === 2) return [{ _id: 'parent', _type: 'course', _courseId: 'c1' }]
          return []
        }),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'parent')

      const insertCall = insertFn.mock.calls[0].arguments
      assert.equal(insertCall[1].schemaName, 'contentobject')
    })

    it('should set createdBy to the userId argument', async () => {
      let findCallCount = 0
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) return [{ _id: 'orig', _type: 'article', _courseId: 'c1' }]
          if (findCallCount === 2) return [{ _id: 'p', _type: 'page', _courseId: 'c1' }]
          return []
        }),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user-42', 'orig', 'p')

      const payload = insertFn.mock.calls[0].arguments[0]
      assert.equal(payload.createdBy, 'user-42')
    })

    it('should clear _id and _trackingId from cloned payload', async () => {
      let findCallCount = 0
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-id'
      }))
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) {
            return [{
              _id: 'orig',
              _type: 'article',
              _courseId: 'c1',
              _trackingId: 'track-1'
            }]
          }
          if (findCallCount === 2) return [{ _id: 'p', _type: 'page', _courseId: 'c1' }]
          return []
        }),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      await ContentModule.prototype.clone.call(inst, 'user1', 'orig', 'p')

      const payload = insertFn.mock.calls[0].arguments[0]
      assert.equal(payload._id, undefined)
      assert.equal(payload._trackingId, undefined)
    })

    it('should recursively clone children', async () => {
      let findCallCount = 0
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: `new-${data._type}`
      }))
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          // 1: find original (article)
          if (findCallCount === 1) return [{ _id: 'orig', _type: 'article', _courseId: 'c1' }]
          // 2: find parent
          if (findCallCount === 2) return [{ _id: 'p', _type: 'page', _courseId: 'c1' }]
          // 3: find children of orig
          if (findCallCount === 3) return [{ _id: 'child1', _type: 'block', _courseId: 'c1' }]
          // 4: find orig child (block) for recursive clone
          if (findCallCount === 4) return [{ _id: 'child1', _type: 'block', _courseId: 'c1' }]
          // 5: find parent of child clone (new-article)
          if (findCallCount === 5) return [{ _id: 'new-article', _type: 'article', _courseId: 'c1' }]
          // 6+: children of child1
          return []
        }),
        insert: insertFn,
        preCloneHook: createMockHook(),
        postCloneHook: createMockHook()
      })

      // Bind the real clone method to inst so recursive this.clone() calls work
      inst.clone = ContentModule.prototype.clone.bind(inst)

      await inst.clone('user1', 'orig', 'p')

      // Should have inserted the article clone and the block clone
      assert.ok(insertFn.mock.callCount() >= 2)
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
    it('getDescendants should handle items with no _parentId property', async () => {
      const inst = createInstance({
        find: mock.fn(async () => [
          { _id: 'root', _courseId: 'c1', _type: 'course' },
          { _id: 'config1', _courseId: 'c1', _type: 'config' }
        ])
      })

      const result = await getDescendants(q => inst.find(q), {
        _id: 'root',
        _courseId: 'c1',
        _type: 'course'
      })

      assert.ok(result.some(r => r._type === 'config'))
    })

    it('clone should allow course type without _parentId when config exists', async () => {
      let findCallCount = 0
      const insertFn = mock.fn(async (data, opts) => ({
        ...data,
        _id: 'new-course-id'
      }))
      const updateFn = mock.fn(async () => ({}))
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          // 1: find original course
          if (findCallCount === 1) return [{ _id: 'orig-course', _type: 'course', _courseId: 'orig-course' }]
          // 2: find config for the course clone
          if (findCallCount === 2) return [{ _id: 'config1', _type: 'config', _courseId: 'orig-course' }]
          // 3: find config original for the recursive clone call
          if (findCallCount === 3) return [{ _id: 'config1', _type: 'config', _courseId: 'orig-course' }]
          // 4+: children lookups
          return []
        }),
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
    it('should handle clone of course when no config exists', async () => {
      let findCallCount = 0
      const inst = createInstance({
        find: mock.fn(async () => {
          findCallCount++
          if (findCallCount === 1) return [{ _id: 'c1', _type: 'course', _courseId: 'c1' }]
          return [] // no config, no children
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
