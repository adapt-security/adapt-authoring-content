import { AbstractApiModule, AbstractApiUtils } from 'adapt-authoring-api'
/**
 * Module which handles course content
 * @memberof content
 * @extends {AbstractApiModule}
 */
class ContentModule extends AbstractApiModule {
  /** @override */
  async setValues () {
    const server = await this.app.waitForModule('server')
    /** @ignore */ this.root = 'content'
    /** @ignore */ this.collectionName = 'content'
    /** @ignore */ this.schemaName = 'content'
    /** @ignore */ this.router = server.api.createChildRouter('content')
    this.useDefaultRouteConfig()
    /** @ignore */ this.routes = [
      {
        route: '/insertrecusive',
        handlers: { post: this.handleInsertRecursive.bind(this) },
        permissions: { post: ['write:content'] }
      },
      {
        route: '/clone',
        handlers: { post: this.handleClone.bind(this) },
        permissions: { post: ['write:content'] }
      },
      ...this.routes
    ]
  }

  /** @override */
  async init () {
    await super.init()

    const [authored, jsonschema, mongodb, tags] = await this.app.waitForModule('authored', 'jsonschema', 'mongodb', 'tags')

    await authored.registerModule(this)
    await tags.registerModule(this)
    /**
     * we extend config specifically here because it doesn't use the default content schema
     */
    jsonschema.extendSchema('config', authored.schemaName)
    jsonschema.extendSchema('config', tags.schemaExtensionName)

    await mongodb.setIndex(this.collectionName, { _courseId: 1, _parentId: 1, _type: 1 })
  }

  /** @override */
  async getSchemaName (data) {
    const contentplugin = await this.app.waitForModule('contentplugin')
    let { _component, _id, _type } = data
    const defaultSchemaName = super.getSchemaName(data)

    if (_id && (!_type || !_component)) { // no explicit type, so look for record in the DB
      const [item] = await this.find({ _id }, { validate: false })
      if (item) {
        _type = item._type
        _component = item._component
      }
    }
    if (!_type && !_component) { // can't go any further, return default value
      return defaultSchemaName
    }
    if (_type !== 'component') {
      return _type === 'page' || _type === 'menu' ? 'contentobject' : _type
    }
    const [component] = await contentplugin.find({ name: _component }, { validate: false })
    return component ? `${component.targetAttribute.slice(1)}-component` : defaultSchemaName
  }

  /** @override */
  async getSchema (schemaName, data) {
    const jsonschema = await this.app.waitForModule('jsonschema')
    try { // try and determine a more specific schema
      schemaName = await this.getSchemaName(data)
    } catch (e) {}
    const contentplugin = await this.app.waitForModule('contentplugin')
    const _courseId = data._courseId ?? (await this.find({ _id: data._id }, { validate: false }))[0]._courseId
    const [config] = await this.find({ _type: 'config', _courseId }, { validate: false })
    let enabledPluginSchemas = []
    try {
      enabledPluginSchemas = config._enabledPlugins.reduce((m, p) => [...m, ...contentplugin.getPluginSchemas(p)], [])
    } catch (e) {}
    return jsonschema.getSchema(schemaName, {
      useCache: false,
      extensionFilter: s => contentplugin.isPluginSchema(s) ? enabledPluginSchemas.includes(s) : true
    })
  }

  /** @override */
  async insert (data, options = {}, mongoOptions = {}) {
    const doc = await super.insert(data, options, mongoOptions)

    if (doc._type === 'course') { // add the _courseId to a new course to make querying easier
      return this.update({ _id: doc._id }, { _courseId: doc._id.toString() })
    }
    if (options.updateSortOrder !== false) await this.updateSortOrder(doc, data)
    if (options.updateEnabledPlugins !== false) await this.updateEnabledPlugins(doc)

    return doc
  }

  /** @override */
  async update (query, data, options, mongoOptions) {
    const doc = await super.update(query, data, options, mongoOptions)
    await Promise.all([
      this.updateSortOrder(doc, data),
      this.updateEnabledPlugins(doc, data._enabledPlugins ? { forceUpdate: true } : {})
    ])
    return doc
  }

  /** @override */
  async delete (query, options, mongoOptions, rootId) {
    this.setDefaultOptions(options)

    const [targetDoc] = await this.find(query)

    if (!targetDoc) {
      throw this.app.errors.NOT_FOUND.setData({ type: options.schemaName, id: JSON.stringify(query) })
    }
    if (targetDoc._type !== 'course') {
      let deleted = await this.deleteChildren(targetDoc._id, options, mongoOptions, rootId)
      if (!Array.isArray(deleted)) deleted = [deleted]
      await Promise.all(deleted.map(async d => {
        return Promise.all([this.updateEnabledPlugins(d), this.updateSortOrder(d)])
      }))
      return deleted
    }
    await this.updateEnabledPlugins(targetDoc)
    const mongodb = await this.app.waitForModule('mongodb')
    // this find is needed for the event data later
    const courseDocs = await this.find({ _courseId: targetDoc._id })
    await mongodb.getCollection(options.collectionName).deleteMany({ _courseId: targetDoc._id }, mongoOptions)
    if (options.invokePostHook) await this.postDeleteHook.invoke(courseDocs)
    await this.updateSortOrder(targetDoc)
    return courseDocs
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
        parent = (await this.find({ _id: rootId }))[0]
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
   * @return {Promise}
   */
  async clone (userId, _id, _parentId, customData = {}) {
    const [originalDoc] = await this.find({ _id })
    if (!originalDoc) {
      throw this.app.errors.NOT_FOUND
        .setData({ type: originalDoc?._type, id: _id })
    }
    const [parent] = _parentId ? await this.find({ _id: _parentId }) : []

    if (!parent && originalDoc._type !== 'course' && originalDoc._type !== 'config') {
      throw this.app.errors.INVALID_PARENT.setData({ parentId: _parentId })
    }
    const schemaName = originalDoc._type === 'menu' || originalDoc._type === 'page' ? 'contentobject' : originalDoc._type
    // const newData = await this.insert(Object.assign(originalDoc, {
    const newData = await this.insert(AbstractApiUtils.stringifyValues({
      ...originalDoc,
      _id: undefined,
      _courseId: parent?._type === 'course' ? parent?._id : parent?._courseId,
      _parentId,
      createdBy: userId,
      ...customData
    }), { schemaName })

    if (originalDoc._type === 'course') {
      const [config] = await this.find({ _type: 'config', _courseId: originalDoc._courseId })
      await this.clone(userId, config._id, undefined, { _courseId: newData._id.toString() })
    }
    const children = await this.find({ _parentId: _id })
    await Promise.all(children.map(({ _id }) => this.clone(userId, _id, newData._id)))
    return newData
  }

  /**
   * Recursive deletion applied to each child content item
   * @param {String} _id Target _id
   * @param {Object} options
   * @param {Object} mongoOptions
   * @param {String} rootId The initiating content item
   */
  async deleteChildren (_id, options, mongoOptions, rootId) {
    const children = await this.find({ _parentId: _id })
    const data = (await Promise.all([
      super.delete({ _id }, { ...options, invokePostHook: false }, mongoOptions),
      ...children.map(c => this.delete({ _id: c._id }, options, mongoOptions, rootId || _id))
    ])).reduce((m, d) => m.concat(Array.isArray(d) ? d : [d]), [])

    if (options.invokePostHook) await this.postDeleteHook.invoke(data[0])
    return data.length > 1 ? data : data[0]
  }

  /**
   * Recalculates the _sortOrder values for all content items affected by an update
   * @param {Object} item The existing item data
   * @param {Object} updateData The update data
   * @return {Promise}
   */
  async updateSortOrder (item, updateData) {
    // some exceptions which don't need a _sortOrder
    if (item._type === 'config' || item._type === 'course' || !item._parentId) {
      return
    }
    const siblings = await this.find({ _parentId: item._parentId, _id: { $ne: item._id } }, {}, { sort: { _sortOrder: 1 } })
    if (updateData) {
      const newSO = item._sortOrder - 1 > -1 ? item._sortOrder - 1 : siblings.length
      siblings.splice(newSO, 0, item)
    }
    return Promise.all(siblings.map(async (s, i) => {
      const _sortOrder = i + 1
      if (s._sortOrder !== _sortOrder) super.update({ _id: s._id }, { _sortOrder })
    }))
  }

  /**
   * Maintains the list of plugins used in the current course
   * @param {Object} item The updated item
   * @param {Object} options
   * @param {Boolean} options.forceUpdate Forces an update of defaults regardless of whether the _enabledPlugins list has changed
   * @return {Promise}
   */
  async updateEnabledPlugins ({ _courseId }, options = {}) {
    const [contentplugin, jsonschema] = await this.app.waitForModule('contentplugin', 'jsonschema')
    const contentItems = await this.find({ _courseId })
    const config = contentItems.find(c => c._type === 'config')

    if (!config) {
      return // can't continue if there's no config to update
    }
    const extensionNames = (await contentplugin.find({ type: 'extension' })).map(p => p.name)
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
          if (t && t !== 'component' && !m.includes(t)) m.push(t)
          return m
        }, types)
      }, [])
    // update config._enabledPlugins
    await super.update({ _courseId, _type: 'config' }, { _enabledPlugins })
    // update other affected content objects to ensure new defaults are applied
    // note: due to the complex data, each must be updated separately rather than using updateMany
    if (types.length > 0) {
      const toUpdate = await super.find({ _courseId, _type: { $in: types } }, {})
      return Promise.all(toUpdate.map(c => super.update({ _id: c._id }, {})))
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
      await this.checkAccess(req, req.apiData.query)
      const { _id, _parentId } = req.body

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
