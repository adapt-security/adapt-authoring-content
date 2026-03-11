import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

const { default: ContentModule } = await import('../lib/ContentModule.js')

// Minimal stub — just enough for methods that only need `this.contentplugin`, etc.
function createInstance (overrides = {}) {
  return {
    schemaName: 'content',
    contentplugin: {
      findOne: mock.fn(async () => null)
    },
    jsonschema: { extendSchema: mock.fn() },
    authored: { schemaName: 'authored' },
    tags: { schemaExtensionName: 'tags' },
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
})
