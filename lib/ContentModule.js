import { AbstractApiModule } from 'adapt-authoring-api'
import { Hook, stringifyValues } from 'adapt-authoring-core'
import { convertObjectIds, createObjectId, parseObjectId } from 'adapt-authoring-mongodb'
import { ObjectId } from 'mongodb'
import { ContentTree, computeSortOrderOps, contentTypeToSchemaName, extractAssetIds, formatFriendlyId, parseMaxSeq } from './utils.js'
/**
 * Module which handles course content
 * @memberof content
 * @extends {AbstractApiModule}
 */
class ContentModule extends AbstractApiModule {
  /** @override */
  async setValues () {
    await super.setValues()
    /** @ignore */ this.collectionName = this.schemaName = 'content'
    this.counterCollectionName = 'contentcounters'
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

    const [assets, authored, contentplugin, jsonschema, mongodb, tags] = await this.app.waitForModule('assets', 'authored', 'contentplugin', 'jsonschema', 'mongodb', 'tags')
    /** @ignore */ this.assets = assets
    /** @ignore */ this.contentplugin = contentplugin
    /** @ignore */ this.jsonschema = jsonschema
    /** @ignore */ this.mongodb = mongodb
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
      jsonschema.extendSchema('content', 'contentassets')
    })
    await this.registerConfigSchemas()
    jsonschema.extendSchema('content', 'contentassets')

    // Prevent deletion of assets that are referenced by content
    assets.preDeleteHook.tap(async (asset) => {
      const usedBy = await this.find(
        { _assetIds: asset._id.toString() },
        { validate: false },
        { projection: { _courseId: 1 } }
      )
      if (!usedBy.length) return
      const courseIds = [...new Set(usedBy.map(d => d._courseId?.toString()).filter(Boolean))]
      const courses = (await this.find(
        { _type: 'course', _id: { $in: courseIds } },
        { validate: false },
        { projection: { title: 1, displayTitle: 1 } }
      )).map(c => c.displayTitle || c.title)
      throw this.app.errors.RESOURCE_IN_USE.setData({ type: 'asset', courses })
    })

    await mongodb.setIndex(this.collectionName, { _courseId: 1, _parentId: 1, _type: 1 })
    await mongodb.setIndex(this.collectionName, { _parentId: 1 })
    await mongodb.setIndex(this.collectionName, { _type: 1, _courseId: 1 })
    await mongodb.setIndex(this.collectionName, { _assetIds: 1 })
    await mongodb.setIndex(this.collectionName, { _courseId: 1, _friendlyId: 1 }, {
      unique: true,
      partialFilterExpression: { _friendlyId: { $type: 'string', $gt: '' } }
    })
    await mongodb.setIndex(this.counterCollectionName, { _type: 1, _courseId: 1 }, { unique: true })
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
      return contentTypeToSchemaName(_type)
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

  /**
   * Generates multiple unique friendly IDs for a given type in a single atomic counter increment.
   * @param {String} _type Content type (e.g. 'page', 'block', 'component')
   * @param {String} _courseId The course these items belong to
   * @param {Number} count Number of IDs to generate
   * @param {String} [_language] Language code (only used for courses)
   * @return {Promise<Array<String>>}
   */
  async generateFriendlyIds (_type, _courseId, count, _language) {
    if (count === 0) return []
    if (_type === 'config') return [formatFriendlyId(_type)]

    const counters = this.mongodb.getCollection(this.counterCollectionName)
    const query = { _type }
    if (_type !== 'course') {
      query._courseId = parseObjectId(_courseId)
    }
    // Seed the counter from existing content on first use
    const exists = await counters.findOne(query)
    if (!exists) {
      const maxSeq = await this.findMaxSeq(_type, _courseId)
      await counters.updateOne(query, { $setOnInsert: { seq: maxSeq } }, { upsert: true })
    }
    // Atomically reserve a range of sequence numbers
    const counter = await counters.findOneAndUpdate(
      query,
      { $inc: { seq: count } },
      { returnDocument: 'after' }
    )
    const startSeq = counter.seq - count + 1
    return Array.from({ length: count }, (_, i) => {
      return formatFriendlyId(_type, startSeq + i, _language)
    })
  }

  /**
   * Finds the current max sequence number from existing content (for counter seeding)
   * @param {String} _type
   * @param {String} _courseId
   * @return {Promise<Number>}
   */
  async findMaxSeq (_type, _courseId) {
    const collection = this.mongodb.getCollection(this.collectionName)
    const query = { _type, _friendlyId: { $exists: true, $ne: '' } }
    if (_type !== 'course') {
      query._courseId = parseObjectId(_courseId)
    }
    const docs = await collection.find(query, { projection: { _friendlyId: 1 } }).toArray()
    return parseMaxSeq(docs)
  }

  /**
   * Removes counter documents for deleted courses
   * @param {Array<String>} courseIds
   * @return {Promise}
   */
  async deleteCounters (courseIds) {
    const counters = this.mongodb.getCollection(this.counterCollectionName)
    const objectIds = courseIds.map(id => parseObjectId(id))
    await counters.deleteMany({ _courseId: { $in: objectIds } })
  }

  /**
   * Computes the _assetIds array for a content document
   * @param {Object} doc Full content document
   * @return {Promise<Array<String>>} Unique asset IDs found in the doc
   */
  async computeAssetIds (doc) {
    const schema = await this.getSchema(this.schemaName, doc)
    return extractAssetIds(schema, doc)
  }

  /** @override */
  async insert (data, options = {}, mongoOptions = {}) {
    if (!data._friendlyId) {
      const [id] = await this.generateFriendlyIds(data._type, data._courseId, 1, data._language)
      data._friendlyId = id
    }
    if (!data._assetIds) {
      data._assetIds = await this.computeAssetIds(data)
    }
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
    // Recompute _assetIds from the full merged document. Cast to ObjectId so
    // the stored array matches the canonical insert-path format (and mongodb
    // queries, which auto-convert 24-hex strings to ObjectId, can match it).
    const newAssetIds = (await this.computeAssetIds(doc)).map(id => parseObjectId(id))
    const oldAssetIds = doc._assetIds ?? []
    if (newAssetIds.length !== oldAssetIds.length ||
      !newAssetIds.every((id, i) => id.toString() === oldAssetIds[i]?.toString())) {
      const collection = this.mongodb.getCollection(this.collectionName)
      await collection.updateOne({ _id: doc._id }, { $set: { _assetIds: newAssetIds } })
      doc._assetIds = newAssetIds
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
    // @note super.find to avoid hooks etc. for performance purposes
    const tree = new ContentTree(await super.find({ _courseId: targetDoc._courseId }, {}, { projection: { _id: 1, _parentId: 1, _type: 1, _component: 1, _enabledPlugins: 1, _menu: 1, _theme: 1 } }))
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
    const remainingTree = new ContentTree(tree.items.filter(i => !deletedIds.has(i._id.toString())))
    await Promise.all([
      options.updateEnabledPlugins !== false && this.updateEnabledPlugins(targetDoc, { tree: remainingTree }, options, mongoOptions),
      options.updateSortOrder !== false && this.updateSortOrder(targetDoc, undefined, options, mongoOptions),
      targetDoc._type === 'course' && this.deleteCounters([targetDoc._courseId])
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
    let parentIsNew = false
    try {
      // figure out which children need creating
      if (rootId === undefined) { // new course
        parent = await this.insert({ _type: 'course', createdBy, ...req.apiData.data }, { schemaName: 'course' })
        newItems.push(parent)
        childTypes.splice(0, 1, 'config')
        parentIsNew = true
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
        // Inner items are the first child of a parent we just created, so
        // _sortOrder is always 1. For the first iteration against an existing
        // parent we leave _sortOrder unset — updateSortOrder(topItem) places it.
        if (parentIsNew && _type !== 'config') data._sortOrder = 1
        const item = await this.insert(data, { updateSortOrder: false, updateEnabledPlugins: false })
        newItems.push(item)
        if (_type !== 'config') {
          parent = item
          parentIsNew = true
        }
      }
    } catch (e) {
      await Promise.all(newItems.map(({ _id }) => super.delete({ _id }, { invokePostHook: false })))
      throw e
    }
    // run side effects once for the topmost new item
    const topItem = newItems[0]
    await Promise.all([
      this.updateSortOrder(topItem, topItem),
      this.updateEnabledPlugins(topItem, { forceUpdate: true })
    ])
    return topItem
  }

  /**
   * Clones a content item and all its descendants in a single bulk operation.
   * Pre-generates all _id values and friendly IDs, then inserts everything in parallel.
   * @param {String} userId The user performing the action
   * @param {String} _id ID of the object to clone
   * @param {String} _parentId The intended parent object (if this is not passed, no parent will be set)
   * @param {Object} customData Data to be applied to the root content item
   * @param {Object} options
   * @param {ContentTree} options.tree Pre-built tree to avoid a DB query
   * @param {Object} options.parent Pre-fetched parent doc to avoid redundant lookup
   * @return {Promise<Object>} The cloned root item
   */
  async clone (userId, _id, _parentId, customData = {}, options = {}) {
    let { tree, parent } = options

    const originalDoc = tree
      ? tree.getById(_id)
      : await this.findOne({ _id })
    if (!originalDoc) {
      throw this.app.errors.NOT_FOUND
        .setData({ type: 'content', id: _id })
    }

    if (!parent && _parentId) {
      parent = await this.findOne({ _id: _parentId }, { throwOnMissing: false }, { projection: { _id: 1, _type: 1, _courseId: 1 } })
    }
    if (!parent && originalDoc._type !== 'course' && originalDoc._type !== 'config') {
      throw this.app.errors.INVALID_PARENT.setData({ parentId: _parentId })
    }
    if (!tree) {
      const sourceItems = await this.mongodb.find(this.collectionName, { _courseId: originalDoc._courseId })
      tree = new ContentTree(sourceItems)
    }

    // Collect all items to clone: root, config (if course clone), then all descendants
    const allItems = [originalDoc]
    if (originalDoc._type === 'course' && tree.config) {
      allItems.push(tree.config)
    }
    allItems.push(...tree.getDescendants(_id))

    if (options.invokePreHook !== false) {
      for (const item of allItems) await this.preCloneHook.invoke(item)
    }

    // Pre-generate ObjectIds for every item (old _id → new _id)
    const idMap = new Map()
    for (const item of allItems) {
      idMap.set(item._id.toString(), createObjectId())
    }

    const newCourseId = originalDoc._type === 'course'
      ? idMap.get(originalDoc._id.toString()).toString()
      : (parent?._type === 'course' ? parent._id.toString() : parent._courseId.toString())

    // Pre-allocate friendly IDs in bulk per type
    const typeCounts = new Map()
    for (const item of allItems) {
      if (item._type === 'course' || item._type === 'config') continue
      typeCounts.set(item._type, (typeCounts.get(item._type) ?? 0) + 1)
    }
    const friendlyIds = new Map()
    await Promise.all([...typeCounts].map(async ([_type, count]) => {
      const ids = await this.generateFriendlyIds(_type, newCourseId, count)
      friendlyIds.set(_type, ids)
    }))

    // Pre-allocate sequential _trackingId for cloned blocks. Bulk insertMany
    // defeats SpoorTrackingModule's preInsertHook (which reads the current max
    // from the DB per-block), so without this every cloned block would get the
    // same id.
    const blockCount = typeCounts.get('block') ?? 0
    let nextTrackingId
    if (blockCount > 0) {
      const [{ _trackingId: maxTrackingId = 0 } = {}] = await this.find(
        { _courseId: newCourseId }, {}, { limit: 1, sort: [['_trackingId', -1]] }
      )
      nextTrackingId = maxTrackingId + 1
    }

    // Build all insert payloads with pre-mapped IDs and parent references
    const rootId = _id.toString()
    const payloads = allItems.map(item => {
      const oldId = item._id.toString()
      const newId = idMap.get(oldId)
      const isCourse = item._type === 'course'
      const isConfig = item._type === 'config'

      let newParentId
      if (oldId === rootId) newParentId = _parentId
      else if (isConfig) newParentId = undefined
      else newParentId = idMap.get(item._parentId?.toString())?.toString()

      let friendlyId
      if (isCourse) friendlyId = item._friendlyId
      else if (isConfig) friendlyId = formatFriendlyId('config')
      else friendlyId = friendlyIds.get(item._type)?.shift()

      return stringifyValues({
        ...item,
        _id: newId,
        _trackingId: item._type === 'block' ? nextTrackingId++ : undefined,
        _friendlyId: friendlyId,
        _courseId: isCourse ? newId.toString() : newCourseId,
        _parentId: newParentId,
        createdBy: userId,
        ...(oldId === rootId ? customData : {})
      })
    })

    // Fire preInsertHook on each payload (allows observer modules to set timestamps etc.)
    await Promise.all(payloads.map(payload =>
      this.preInsertHook.invoke(payload, { schemaName: contentTypeToSchemaName(payload._type), collectionName: this.collectionName }, {})
    ))

    // Convert known ID fields to ObjectId instances and bulk insert in a single round-trip
    const allNewIds = allItems.map(item => idMap.get(item._id.toString()))
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i]
      payload._id = allNewIds[i]
      if (payload._courseId) payload._courseId = new ObjectId(payload._courseId)
      if (payload._parentId) payload._parentId = new ObjectId(payload._parentId)
    }

    const collection = this.mongodb.getCollection(this.collectionName)
    try {
      await collection.insertMany(payloads, { ordered: false })
    } catch (e) {
      await collection.deleteMany({ _id: { $in: allNewIds } }).catch(() => {})
      throw e
    }

    // payloads (post-convertObjectIds) are the stored documents — no find-back needed
    await Promise.all(payloads.map(doc => this.postInsertHook.invoke(doc)))

    if (options.invokePostHook !== false) {
      for (let i = 0; i < allItems.length; i++) {
        await this.postCloneHook.invoke(allItems[i], payloads[i])
      }
    }
    if (originalDoc._courseId?.toString() !== payloads[0]._courseId?.toString()) {
      await this.updateEnabledPlugins(payloads[0])
    }

    return payloads[0]
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
    const ops = computeSortOrderOps(siblings, updateData ? item : undefined)
    if (ops.length > 0) {
      const collection = this.mongodb.getCollection(this.collectionName)
      return collection.bulkWrite(ops, { ordered: false })
    }
  }

  /**
   * Maintains the list of plugins used in the current course
   * @param {Object} item The updated item
   * @param {Object} options
   * @param {Boolean} options.forceUpdate Forces an update of defaults regardless of whether the _enabledPlugins list has changed
   * @param {ContentTree} options.tree Pre-built tree to avoid redundant full-course fetch
   * @return {Promise}
   */
  async updateEnabledPlugins ({ _courseId, _type }, options = {}, parentOptions, parentMongoOptions) {
    // skip types that can never affect the plugin list (e.g. page, article).
    if (options.forceUpdate !== true && _type && _type !== 'component' && _type !== 'config') {
      return
    }
    const { contentplugin, jsonschema } = this
    const tree = options.tree ?? new ContentTree(await super.find({ _courseId }, {}, { projection: { _id: 1, _type: 1, _component: 1, _enabledPlugins: 1, _menu: 1, _theme: 1 } }))
    const config = tree.config

    if (!config) {
      return // can't continue if there's no config to update
    }
    const currentPlugins = new Set(config._enabledPlugins ?? [])
    const extensionNames = (await contentplugin.find({ type: 'extension' }, {}, { projection: { _id: 0, name: 1 } })).map(p => p.name)
    const componentNames = tree.getComponentNames()
    // generate unique list of used plugins
    const nextPlugins = new Set([
      ...[...currentPlugins].filter(name => extensionNames.includes(name)), // only extensions, rest are calculated below
      ...componentNames,
      config._menu,
      config._theme
    ].filter(Boolean))
    if (options.forceUpdate !== true &&
      currentPlugins.size === nextPlugins.size &&
      [...currentPlugins].every(p => nextPlugins.has(p))) {
      return // return early if the lists already match
    }
    // generate list of content types that need defaults applied for newly added plugins
    const newPluginSchemas = [...nextPlugins]
      .filter(p => options.forceUpdate || !currentPlugins.has(p))
      .flatMap(p => contentplugin.getPluginSchemas(p))

    const affectedTypes = new Set()
    for (const schemaName of newPluginSchemas) {
      const rawSchema = jsonschema.schemas[schemaName]?.raw
      const ref = rawSchema?.$merge?.source?.$ref ?? rawSchema?.$patch?.source?.$ref
      for (const t of (ref === 'contentobject' ? ['menu', 'page'] : [ref])) {
        if (t) affectedTypes.add(t)
      }
    }
    const _enabledPlugins = [...nextPlugins]
    // update config._enabledPlugins
    await super.update({ _courseId, _type: 'config' }, { _enabledPlugins }, parentOptions, parentMongoOptions)
    // update other affected content objects to ensure new defaults are applied
    // note: due to the complex data, each must be updated separately rather than using updateMany
    if (affectedTypes.size > 0) {
      const toUpdate = await super.find({ _courseId, _type: { $in: [...affectedTypes] } }, {}, { projection: { _id: 1 } })
      return Promise.all(toUpdate.map(c => super.update({ _id: c._id }, {}, parentOptions, parentMongoOptions)))
    }
  }

  /**
   * Returns a lightweight projection of all content items for a course
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   */
  async handleTree (req, res, next) {
    try {
      const _courseId = req.apiData.query._courseId
      const course = await this.findOne(
        { _type: 'course', _courseId },
        { validate: false },
        { projection: { updatedAt: 1 } }
      )
      const lastModified = new Date(course.updatedAt)
      lastModified.setMilliseconds(0) // HTTP dates are second-precision; must match before comparing
      const ifModifiedSince = req.headers['if-modified-since'] && new Date(req.headers['if-modified-since'])
      if (ifModifiedSince && lastModified <= ifModifiedSince) {
        return res.status(304).end()
      }
      const items = await this.find(
        { _courseId },
        { validate: false },
        { projection: { _id: 1, _parentId: 1, _courseId: 1, _type: 1, _sortOrder: 1, title: 1, displayTitle: 1, _friendlyId: 1, _component: 1, _layout: 1, _menu: 1, _theme: 1, _enabledPlugins: 1, updatedAt: 1 } }
      )
      const tree = new ContentTree(items)
      res.set('Last-Modified', lastModified.toUTCString())
      res.json(items.map(item => ({
        ...item,
        _children: tree.getChildren(item._id).map(c => c._id)
      })))
    } catch (e) {
      return next(e)
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
