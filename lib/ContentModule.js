import { AbstractApiModule } from 'adapt-authoring-api'
import ContentTree from './ContentTree.js'
import { Hook, stringifyValues } from 'adapt-authoring-core'
/**
 * Module which handles course content
 *
 * Convention: `this.find`/`this.insert`/`this.update`/`this.delete` trigger hooks and validation
 * (use for user-facing operations). `super.*` bypasses hooks (use for internal bookkeeping like
 * `updateSortOrder`, `updateEnabledPlugins`, and error cleanup to avoid infinite recursion).
 *
 * @memberof content
 * @extends {AbstractApiModule}
 */
class ContentModule extends AbstractApiModule {
  /** @override */
  async setValues () {
    await super.setValues()
    /** @ignore */ this.collectionName = this.schemaName = 'content'
  }

  /** @override */
  async init () {
    await super.init()
    /**
     * Hook invoked before content data is cloned
     * @type {Hook}
     */
    this.preCloneHook = new Hook({ mutable: true })
    /**
     * Hook invoked after content data is cloned
     * @type {Hook}
     */
    this.postCloneHook = new Hook()

    const [authored, contentplugin, jsonschema, mongodb, tags] = await this.app.waitForModule('authored', 'contentplugin', 'jsonschema', 'mongodb', 'tags')
    /** @ignore */ this.contentplugin = contentplugin
    /** @ignore */ this.jsonschema = jsonschema
    /** @ignore */ this.authored = authored
    /** @ignore */ this.tags = tags
    /** @ignore */ this._schemaCache = new Map()

    await authored.registerModule(this)
    await tags.registerModule(this)
    /**
     * we have to extend config specifically here because it doesn't use the default content schema
     */
    jsonschema.registerSchemasHook.tap(() => {
      this._schemaCache.clear()
      this.registerConfigSchemas()
    })
    await this.registerConfigSchemas()

    await mongodb.setIndex(this.collectionName, { _courseId: 1, _parentId: 1, _type: 1 })
    await mongodb.setIndex(this.collectionName, { _courseId: 1, _friendlyId: 1 }, {
      unique: true,
      partialFilterExpression: { _friendlyId: { $type: 'string', $gt: '' } }
    })
  }

  /** @override */
  async getSchemaName (data) {
    const { contentplugin } = this
    let { _component, _id, _type } = data
    const defaultSchemaName = super.getSchemaName(data)

    if (_id && (!_type || !_component)) { // no explicit type, so look for record in the DB
      const item = await this.findOne({ _id }, { validate: false, throwOnMissing: false }, { projection: { _type: 1, _component: 1, _courseId: 1 } })
      if (item) {
        _type = item._type
        _component = item._component
        if (!data._courseId && item._courseId) data._courseId = item._courseId
      }
    }
    if (!_type && !_component) { // can't go any further, return default value
      return defaultSchemaName
    }
    if (_type !== 'component') {
      return _type === 'page' || _type === 'menu' ? 'contentobject' : _type
    }
    const component = await contentplugin.findOne({ name: _component }, { validate: false, throwOnMissing: false })
    return component ? `${component.targetAttribute.slice(1)}-component` : defaultSchemaName
  }

  /** @override */
  async getSchema (schemaName, data) {
    const { contentplugin, jsonschema } = this
    schemaName = await this.getSchemaName(data)
    const _courseId = data._courseId ??
      (data._id ? (await this.findOne({ _id: data._id }, { validate: false, throwOnMissing: false }, { projection: { _courseId: 1 } }))?._courseId : undefined)
    let enabledPluginSchemas = []
    if (_courseId) {
      const config = await this.findOne({ _type: 'config', _courseId }, { validate: false, throwOnMissing: false }, { projection: { _enabledPlugins: 1 } })
      const pluginList = config?._enabledPlugins ?? data?._enabledPlugins ?? []
      enabledPluginSchemas = pluginList.flatMap(p => contentplugin.getPluginSchemas(p))
    }
    const cacheKey = schemaName + ':' + enabledPluginSchemas.slice().sort().join(',')
    const cached = this._schemaCache.get(cacheKey)
    if (cached) return cached

    const schema = await jsonschema.getSchema(schemaName, {
      useCache: false,
      extensionFilter: s => contentplugin.isPluginSchema(s) ? enabledPluginSchemas.includes(s) : true
    })
    this._schemaCache.set(cacheKey, schema)
    return schema
  }

  /**
   * Adds config schema extensions
   */
  registerConfigSchemas () {
    this.jsonschema.extendSchema('config', this.authored.schemaName)
    this.jsonschema.extendSchema('config', this.tags.schemaExtensionName)
  }

  /** @override */
  async insert (data, options = {}, mongoOptions = {}) {
    let doc
    try {
      doc = await super.insert(data, options, mongoOptions)
    } catch (e) {
      if (e.code === this.app.errors.MONGO_DUPL_INDEX?.code) {
        throw this.app.errors.DUPL_FRIENDLY_ID.setData({ _friendlyId: data._friendlyId, _courseId: data._courseId })
      }
      throw e
    }

    if (doc._type === 'course') { // add the _courseId to a new course to make querying easier
      return this.update({ _id: doc._id }, { _courseId: doc._id.toString() })
    }
    await Promise.all([
      options.updateSortOrder !== false && this.updateSortOrder(doc, data, options, mongoOptions),
      options.updateEnabledPlugins !== false && this.updateEnabledPlugins(doc, {}, options, mongoOptions)
    ])
    return doc
  }

  /** @override */
  async update (query, data, options, mongoOptions) {
    let doc
    try {
      doc = await super.update(query, data, options, mongoOptions)
    } catch (e) {
      if (e.code === this.app.errors.MONGO_DUPL_INDEX?.code) {
        throw this.app.errors.DUPL_FRIENDLY_ID.setData({ _friendlyId: data._friendlyId, _courseId: data._courseId })
      }
      throw e
    }
    const sortChanged = '_sortOrder' in data || '_parentId' in data
    const pluginsChanged = '_component' in data || '_menu' in data || '_theme' in data || '_enabledPlugins' in data
    await Promise.all([
      sortChanged && this.updateSortOrder(doc, data, options, mongoOptions),
      pluginsChanged && this.updateEnabledPlugins(doc, data._enabledPlugins ? { forceUpdate: true } : {}, options, mongoOptions)
    ])
    return doc
  }

  /** @override */
  async delete (query, options = {}, mongoOptions) {
    this.setDefaultOptions(options)

    const targetDoc = await this.findOne(query)
    const tree = new ContentTree(await this.find({ _courseId: targetDoc._courseId }))
    const descendants = tree.getDescendants(targetDoc._id)
    if (targetDoc._type === 'course' && tree.config) {
      descendants.push(tree.config)
    }

    const deletedIds = new Set([targetDoc, ...descendants].map(d => d._id.toString()))
    // deleteMany for descendants (1 bulk query, pre/postDeleteHook still fires per item)
    // super.delete for targetDoc (triggers deleteHook middleware for observer modules)
    if (descendants.length > 0) {
      await super.deleteMany({ _id: { $in: descendants.map(d => d._id) } }, options, mongoOptions)
    }
    await super.delete({ _id: targetDoc._id }, options, mongoOptions)
    const remainingItems = tree.items.filter(i => !deletedIds.has(i._id.toString()))
    await Promise.all([
      this.updateEnabledPlugins(targetDoc, { contentItems: remainingItems }, options, mongoOptions),
      this.updateSortOrder(targetDoc, undefined, options, mongoOptions)
    ])
    return [targetDoc, ...descendants]
  }

  /**
   * Creates a new parent content type, along with any necessary children
   * @param {external:ExpressRequest} req
   */
  async insertRecursive (req) {
    const rootId = req.apiData.query.rootId
    const createdBy = req.auth.user._id.toString()
    let childTypes = ['course', 'page', 'article', 'block', 'component']
    const defaultData = {
      page: { title: req.translate('app.newpagetitle') },
      article: { title: req.translate('app.newarticletitle') },
      block: { title: req.translate('app.newblocktitle') },
      component: {
        _component: 'adapt-contrib-text',
        _layout: 'full',
        title: req.translate('app.newtextcomponenttitle'),
        body: req.translate('app.newtextcomponentbody')
      }
    }
    const newItems = []
    let parent
    try {
      // figure out which children need creating
      if (rootId === undefined) { // new course
        parent = await this.insert({ _type: 'course', createdBy, ...req.apiData.data }, { schemaName: 'course' })
        newItems.push(parent)
        childTypes.splice(0, 1, 'config')
      } else {
        parent = await this.findOne({ _id: rootId })
        // special case for menus
        req.body?._type === 'menu'
          ? childTypes.splice(0, 1, 'menu')
          : childTypes = childTypes.slice(childTypes.indexOf(parent._type) + 1)
      }
      for (const _type of childTypes) {
        const data = Object.assign({ _type, createdBy }, defaultData[_type])
        if (parent) {
          Object.assign(data, {
            _parentId: parent._id.toString(),
            _courseId: parent._courseId.toString()
          })
        }
        const item = await this.insert(data)
        newItems.push(item)
        if (_type !== 'config') parent = item
      }
    } catch (e) {
      await Promise.all(newItems.map(({ _id }) => super.delete({ _id }, { invokePostHook: false })))
      throw e
    }
    // return the topmost new item
    return newItems[0]
  }

  /**
   * Recursively clones a content item
   * @param {String} userId The user performing the action
   * @param {String} _id ID of the object to clone
   * @param {String} _parentId The intended parent object (if this is not passed, no parent will be set)
   * @param {Object} customData Data to be applied to the content item
   * @param {Object} options
   * @param {ContentTree} options.tree Pre-built tree to avoid per-level DB queries
   * @param {Object} options.parent Pre-fetched parent doc to avoid redundant lookup
   * @return {Promise}
   */
  async clone (userId, _id, _parentId, customData = {}, options = {}) {
    let { tree, parent } = options
    const isTopLevel = !options.tree
    const createdItems = options._createdItems ?? []

    const originalDoc = tree
      ? tree.getById(_id)
      : await this.findOne({ _id })
    if (!originalDoc) {
      throw this.app.errors.NOT_FOUND
        .setData({ type: 'content', id: _id })
    }
    if (options.invokePreHook !== false) await this.preCloneHook.invoke(originalDoc)

    if (!parent && _parentId) {
      parent = await this.findOne({ _id: _parentId }, { throwOnMissing: false }, { projection: { _id: 1, _type: 1, _courseId: 1 } })
    }
    if (!parent && originalDoc._type !== 'course' && originalDoc._type !== 'config') {
      throw this.app.errors.INVALID_PARENT.setData({ parentId: _parentId })
    }
    // build tree from source course if not provided (top-level clone call)
    if (!tree) {
      const courseItems = await this.find({ _courseId: originalDoc._courseId })
      tree = new ContentTree(courseItems)
    }
    const schemaName = originalDoc._type === 'menu' || originalDoc._type === 'page' ? 'contentobject' : originalDoc._type
    const payload = stringifyValues({
      ...originalDoc,
      _id: undefined,
      _trackingId: undefined,
      _friendlyId: originalDoc._type !== 'course' ? undefined : originalDoc._friendlyId,
      _courseId: parent?._type === 'course' ? parent?._id : parent?._courseId,
      _parentId,
      createdBy: userId,
      ...customData
    })
    try {
      const newData = await this.insert(payload, {
        schemaName,
        validate: false,
        updateSortOrder: false,
        updateEnabledPlugins: isTopLevel
      })
      createdItems.push(newData)

      if (originalDoc._type === 'course') {
        if (tree.config) {
          await this.clone(userId, tree.config._id, undefined, { _courseId: newData._id.toString() }, { tree, _createdItems: createdItems })
          const { _id: _, _courseId: __, ...updatePayload } = payload
          await this.update({ _id: newData._id }, updatePayload, { validate: false })
        }
      }
      const children = tree.getChildren(_id)
      await Promise.all(children.map(c => {
        return this.clone(userId, c._id, newData._id, {}, { tree, parent: newData, _createdItems: createdItems })
      }))
      if (isTopLevel) {
        await this.updateEnabledPlugins(newData)
      }
      if (options.invokePostHook !== false) await this.postCloneHook.invoke(originalDoc, newData)

      return newData
    } catch (e) {
      if (isTopLevel && createdItems.length > 0) {
        await Promise.all(createdItems.map(({ _id }) => super.delete({ _id }, { invokePostHook: false })))
      }
      throw e
    }
  }

  /**
   * Recalculates the _sortOrder values for all content items affected by an update
   * @param {Object} item The existing item data
   * @param {Object} updateData The update data
   * @return {Promise}
   */
  async updateSortOrder (item, updateData, parentOptions, parentMongoOptions) {
    // some exceptions which don't need a _sortOrder
    if (item._type === 'config' || item._type === 'course' || !item._parentId) {
      return
    }
    const siblings = await super.find({ _parentId: item._parentId, _id: { $ne: item._id } }, {}, { sort: { _sortOrder: 1 }, projection: { _id: 1, _sortOrder: 1 } })
    if (updateData) {
      const newSO = item._sortOrder != null && item._sortOrder - 1 > -1 ? item._sortOrder - 1 : siblings.length
      siblings.splice(newSO, 0, item)
    }
    return Promise.all(siblings.map(async (s, i) => {
      const _sortOrder = i + 1
      if (s._sortOrder !== _sortOrder) return super.update({ _id: s._id }, { _sortOrder }, parentOptions, parentMongoOptions)
    }))
  }

  /**
   * Maintains the list of plugins used in the current course
   * @param {Object} item The updated item
   * @param {Object} options
   * @param {Boolean} options.forceUpdate Forces an update of defaults regardless of whether the _enabledPlugins list has changed
   * @param {Array<Object>} options.contentItems Pre-fetched content items to avoid redundant full-course fetch
   * @return {Promise}
   */
  async updateEnabledPlugins ({ _courseId }, options = {}, parentOptions, parentMongoOptions) {
    const { contentplugin, jsonschema } = this
    const contentItems = options.contentItems ?? await super.find({ _courseId }, {}, { projection: { _id: 1, _type: 1, _component: 1, _enabledPlugins: 1, _menu: 1, _theme: 1 } })
    const config = contentItems.find(c => c._type === 'config')

    if (!config) {
      return // can't continue if there's no config to update
    }
    const extensionNames = (await contentplugin.find({ type: 'extension' }, {}, { projection: { _id: 0, name: 1 } })).map(p => p.name)
    const componentNames = (contentItems.filter(c => c._type === 'component')).map(c => c._component)
    // generate unique list of used plugins
    const _enabledPlugins = Array.from(new Set([
      ...config._enabledPlugins.filter(name => extensionNames.includes(name)), // only extensions, rest are calculated below
      ...componentNames,
      config._menu,
      config._theme
    ]))
    if (options.forceUpdate !== true &&
      config._enabledPlugins.length === _enabledPlugins.length &&
      config._enabledPlugins.every(p => _enabledPlugins.includes(p))) {
      return // return early if the lists already match
    }
    // generate list of used content types which need defaults applied
    const types = _enabledPlugins
      .filter(p => options.forceUpdate || !config._enabledPlugins.includes(p))
      .reduce((m, p) => m.concat(contentplugin.getPluginSchemas(p)), [])
      .reduce((types, pluginSchemaName) => {
        const rawSchema = jsonschema.schemas[pluginSchemaName].raw
        const type = rawSchema?.$merge?.source?.$ref ?? rawSchema?.$patch?.source?.$ref
        return (type === 'contentobject' ? ['menu', 'page'] : [type]).reduce((m, t) => {
          if (t && !m.includes(t)) m.push(t)
          return m
        }, types)
      }, [])
    // update config._enabledPlugins
    await super.update({ _courseId, _type: 'config' }, { _enabledPlugins }, parentOptions, parentMongoOptions)
    // update other affected content objects to ensure new defaults are applied
    // note: due to the complex data, each must be updated separately rather than using updateMany
    if (types.length > 0) {
      const toUpdate = await super.find({ _courseId, _type: { $in: types } }, {}, { projection: { _id: 1 } })
      return Promise.all(toUpdate.map(c => super.update({ _id: c._id }, {}, parentOptions, parentMongoOptions)))
    }
  }

  /**
   * Special request handler for bootstrapping a new content object with dummy content
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   */
  async handleInsertRecursive (req, res, next) {
    try {
      res.status(201).json(await this.insertRecursive(req))
    } catch (e) {
      return next(e)
    }
  }

  /**
   * Request handler for cloning content items
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   * @return {Promise} Resolves with the cloned data
   */
  async handleClone (req, res, next) {
    try {
      await this.requestHook.invoke(req)
      const { _id, _parentId } = req.body
      if (!_id) {
        throw this.app.errors.NOT_FOUND.setData({ type: 'content', id: _id })
      }
      const source = await this.findOne({ _id })
      await this.checkAccess(req, source)

      const customData = { ...req.body }
      delete customData._id
      delete customData._parentId

      const newData = await this.clone(req.auth.user._id, _id, _parentId, customData)
      res.status(201).json(newData)
    } catch (e) {
      return next(e)
    }
  }
}

export default ContentModule
