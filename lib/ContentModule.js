import { AbstractApiModule } from 'adapt-authoring-api'
import { Hook, stringifyValues } from 'adapt-authoring-core'
import { createObjectId, parseObjectId } from 'adapt-authoring-mongodb'
import { ObjectId } from 'mongodb'
import { ContentTree, buildAssetUsagePipeline, computeSortOrderOps, contentTypeToSchemaName, excludeIdsFromQuery, extractAssetIds, extractSummary, fieldsToProjection, formatFriendlyId, parseMaxSeq, treeEtag } from './utils.js'
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

    // ownership is course-level: the generic createdBy grant is applied by the content
    // access resolver (adaptframework), not per content item — so opt out of authored's
    // per-item ownership grant here.
    await authored.registerModule(this, { accessCheck: false })
    await tags.registerModule(this)
    /**
     * we have to extend config specifically here because it doesn't use the default content schema
     */
    jsonschema.registerSchemasHook.tap(() => {
      this._schemaCache.clear()
      this.registerConfigSchemas()
      jsonschema.extendSchema('content', 'contentassets')
      jsonschema.extendSchema('content', 'contentsummary')
      this.registerAccessSchemas(jsonschema)
    })
    await this.registerConfigSchemas()
    jsonschema.extendSchema('content', 'contentassets')
    jsonschema.extendSchema('content', 'contentsummary')
    this.registerAccessSchemas(jsonschema)

    // bump course.updatedAt so tree endpoint If-Modified-Since invalidates
    this.postInsertHook.tap(this.touchCourse.bind(this))
    this.postUpdateHook.tap((_, doc) => this.touchCourse(doc))
    this.postDeleteHook.tap(this.touchCourse.bind(this))

    assets.preDeleteHook.tap(this.enforceAssetNotInUse.bind(this))
    assets.queryHook.tap(this.onAssetQueryHook, this)

    // block builds when the course structure has empty containers. adaptframework depends on
    // content (not vice-versa), so tap its hook once available rather than awaiting it here.
    this.app.waitForModule('adaptframework').then(framework => {
      framework.preBuildHook.tap(this.enforceNoEmptyContainers.bind(this))
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

  /**
   * Extends the course schema with the generic `_access` grant fields (public + per-user
   * sharing) so course sharing can be stored and edited. Scoped to the `course` schema — NOT
   * the base `content` schema — so nested content items carry no `_access` of their own and
   * can't self-grant; content access is resolved to the course centrally (adaptframework).
   * Group sharing (`_access.groups`) is added to the course schema by the usergroups module.
   * @param {Object} jsonschema The jsonschema module
   */
  registerAccessSchemas (jsonschema) {
    jsonschema.extendSchema('course', 'access')
    jsonschema.extendSchema('course', 'users')
  }

  /**
   * Touches the parent course's updatedAt so the tree endpoint's If-Modified-Since check invalidates after any descendant content changes.
   * @param {Object} doc Content document that was inserted/updated/deleted
   * @return {Promise}
   */
  async touchCourse (doc) {
    if (!doc || doc._type === 'course' || !doc._courseId) return
    await this.mongodb.getCollection(this.collectionName).updateOne(
      { _id: parseObjectId(doc._courseId), _type: 'course' },
      { $set: { updatedAt: new Date() } }
    )
  }

  /**
   * Refuses asset deletion when the asset is referenced by content. Throws RESOURCE_IN_USE listing the affected course titles.
   * @param {Object} asset Asset document being deleted
   * @return {Promise}
   */
  async enforceAssetNotInUse (asset) {
    const usedBy = await this.find(
      { _assetIds: asset._id.toString() },
      { validate: false },
      { projection: { _courseId: 1 } }
    )
    if (!usedBy.length) return
    const courseIds = [...new Set(usedBy.map(d => d._courseId?.toString()).filter(Boolean))].map(id => parseObjectId(id))
    const courses = (await this.find(
      { _type: 'course', _id: { $in: courseIds } },
      { validate: false },
      { projection: { title: 1, displayTitle: 1 } }
    )).map(c => c.displayTitle || c.title)
    throw this.app.errors.RESOURCE_IN_USE.setData({ type: 'asset', courses })
  }

  /**
   * preBuildHook observer: prunes orphaned items (unreachable from the course root, left by an
   * interrupted delete — invisible in the editor but build-breaking), then refuses the build when
   * any reachable non-component container has no children (an empty page, article or block).
   * Components are leaf nodes and config is exempt. Records the pruned count on `build` so the
   * caller can surface it.
   * @param {AdaptFrameworkBuild} build The build being run
   * @return {Promise}
   */
  async enforceNoEmptyContainers (build) {
    const _courseId = parseObjectId(build.courseId)
    const items = await this.find(
      { $or: [{ _id: _courseId }, { _courseId }] },
      { validate: false },
      { projection: { _type: 1, _parentId: 1, title: 1, displayTitle: 1 } }
    )
    const tree = new ContentTree(items)
    const orphans = tree.getUnreachableItems()
    if (orphans.length) {
      await this.mongodb.deleteMany(this.collectionName, { _id: { $in: orphans.map(o => o._id) } })
      this.log('warn', `pruned ${orphans.length} orphaned content item(s) from course ${_courseId}: ${orphans.map(o => o._id).join(', ')}`)
      build.prunedOrphans = (build.prunedOrphans ?? 0) + orphans.length
    }
    const orphanIds = new Set(orphans.map(o => o._id.toString()))
    const empty = tree.getEmptyContainers().filter(i => !orphanIds.has(i._id.toString()))
    if (!empty.length) return
    throw this.app.errors.EMPTY_CONTAINERS.setData({
      items: empty.map(i => ({ _id: i._id.toString(), _type: i._type, title: i.displayTitle || i.title, _parentId: i._parentId?.toString() }))
    })
  }

  /**
   * Returns a map of asset _id to the number of distinct courses each asset is referenced by.
   * Reads the indexed `_assetIds` field. Accepts an optional `assetIds` array in the request body to
   * scope the counts (e.g. the page of assets shown in the UI); assets with no usage are omitted.
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {function} next
   * @return {Promise}
   */
  async handleAssetUsage (req, res, next) {
    try {
      const assetIds = Array.isArray(req.body?.assetIds) ? req.body.assetIds.map(id => parseObjectId(id)) : undefined
      const results = await this.mongodb.getCollection(this.collectionName).aggregate(buildAssetUsagePipeline(assetIds)).toArray()
      res.json(Object.fromEntries(results.map(r => [r._id.toString(), r.courseCount])))
    } catch (e) {
      next(e)
    }
  }

  /**
   * Returns the courses that reference a given asset as `{ _id, title }` rows, for the asset sheet's "used in courses" list.
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {function} next
   * @return {Promise}
   */
  async handleAssetCourses (req, res, next) {
    try {
      const usedBy = await this.find(
        { _assetIds: req.apiData.query._id },
        { validate: false },
        { projection: { _courseId: 1 } }
      )
      const courseIds = [...new Set(usedBy.map(d => d._courseId?.toString()).filter(Boolean))].map(id => parseObjectId(id))
      const courses = await this.find(
        { _type: 'course', _id: { $in: courseIds } },
        { validate: false },
        { projection: { title: 1, displayTitle: 1 } }
      )
      res.json(courses.map(c => ({ _id: c._id.toString(), title: c.displayTitle || c.title })))
    } catch (e) {
      next(e)
    }
  }

  /**
   * "Unused assets" filter for the asset manager. The UI sends a `?unused`
   * query-string flag (see adapt-authoring-ui Assets page); restrict the assets
   * query to those not referenced by any content document. Read from req.query
   * because the flag is not part of the asset schema.
   *
   * Lives here, tapping the assets module's queryHook, so the `_assetIds`
   * mechanism stays owned by content and assets remains usage-agnostic. Uses
   * queryHook (not accessQueryHook) because it's a user-driven filter that must
   * apply to every role.
   * @param {external:ExpressRequest} req
   * @return {Promise}
   */
  async onAssetQueryHook (req) {
    if (!req.query.unused) return
    // distinct can surface a null when legacy docs carry a null in _assetIds;
    // those would crash the mongodb layer's ObjectId conversion of the $nin array
    const usedIds = (await this.mongodb.getCollection(this.collectionName).distinct('_assetIds')).filter(Boolean)
    excludeIdsFromQuery(req.apiData.query, usedIds)
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

  /**
   * Computes the display-only _summary cell array for a component document. Non-component
   * types have no summary (their title suffices on the structure page) and return [].
   * @param {Object} doc Full content document
   * @return {Promise<Array<Object>>} Summary cells for the doc
   */
  async computeSummary (doc) {
    if (doc._type !== 'component' || !doc._component) return []
    const schema = await this.getSchema(this.schemaName, doc)
    return extractSummary(schema, doc, doc._component, this.getConfig('summaryFields') ?? {})
  }

  /**
   * Throws INVALID_PARENT when a write sets a _parentId that does not resolve to an existing item
   * in the same course. Prevents orphans (items unreachable from the course root) being created by
   * a delete/insert race or a stale client reference. No-op when no _parentId is set (course/config
   * roots, or an update that does not reparent).
   * @param {Object} data The content data being written
   * @return {Promise}
   */
  async validateParent (data) {
    if (!data._parentId) return
    const parent = await this.findOne(
      { _id: data._parentId },
      { validate: false, throwOnMissing: false },
      { projection: { _id: 1, _courseId: 1 } }
    )
    if (!parent || (data._courseId && parent._courseId && parent._courseId.toString() !== data._courseId.toString())) {
      throw this.app.errors.INVALID_PARENT.setData({ parentId: data._parentId.toString() })
    }
  }

  /** @override */
  async insert (data, options = {}, mongoOptions = {}) {
    await this.validateParent(data)
    if (!data._friendlyId) {
      const [id] = await this.generateFriendlyIds(data._type, data._courseId, 1, data._language)
      data._friendlyId = id
    }
    if (!data._assetIds) {
      data._assetIds = await this.computeAssetIds(data)
    }
    if (!data._summary) {
      data._summary = await this.computeSummary(data)
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
    if ('_parentId' in data && data._parentId) await this.validateParent(data)
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
    // Recompute the display-only _summary from the full merged document. It is never
    // queried, so a plain value comparison is enough to skip no-op writes.
    const newSummary = await this.computeSummary(doc)
    if (JSON.stringify(newSummary) !== JSON.stringify(doc._summary ?? [])) {
      await this.mongodb.getCollection(this.collectionName).updateOne({ _id: doc._id }, { $set: { _summary: newSummary } })
      doc._summary = newSummary
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
    // bulk-delete descendants via raw mongodb to avoid per-item memory overhead and hook storms;
    // postDeleteHook is invoked once below with the full descendants list
    if (descendants.length > 0) {
      const mongodb = await this.app.waitForModule('mongodb')
      await mongodb.deleteMany(this.collectionName, { _id: { $in: descendants.map(d => d._id) } }, mongoOptions)
    }
    // delete target via super.delete to trigger deleteHook middleware (e.g. multilang)
    await super.delete({ _id: targetDoc._id }, options, mongoOptions)
    if (descendants.length > 0 && options.invokePostHook !== false) {
      await this.postDeleteHook.invoke(descendants)
    }
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
    // type → { ids, next } — bundle the cursor with the array so the payload loop is O(n) (Array#shift would be O(n²))
    const friendlyIds = new Map()
    await Promise.all([...typeCounts].map(async ([_type, count]) => {
      friendlyIds.set(_type, { ids: await this.generateFriendlyIds(_type, newCourseId, count), next: 0 })
    }))

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
      else {
        const queue = friendlyIds.get(item._type)
        friendlyId = queue?.ids[queue.next++]
      }

      return stringifyValues({
        ...item,
        _id: newId,
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
      if (payload.createdBy) payload.createdBy = new ObjectId(payload.createdBy)
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
    // place the clone at its requested _sortOrder and renumber siblings (no-op for course/config)
    await this.updateSortOrder(payloads[0], payloads[0])

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
    // empty update re-validates to apply new defaults; ignoreRequired because some plugins
    // declare top-level required properties with no default (e.g. adapt-contrib-glossary)
    if (affectedTypes.size > 0) {
      const toUpdate = await super.find({ _courseId, _type: { $in: [...affectedTypes] } }, {}, { projection: { _id: 1 } })
      return Promise.all(toUpdate.map(c => super.update({ _id: c._id }, {}, { ...parentOptions, ignoreRequired: true }, parentMongoOptions)))
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
        { projection: { updatedAt: 1, _type: 1, createdBy: 1, _access: 1, _isShared: 1, _shareWithUsers: 1, userGroups: 1 } }
      )
      if (!course) {
        throw this.app.errors.NOT_FOUND.setData({ type: 'content', id: _courseId })
      }
      // this custom handler bypasses the standard per-item access check, so apply it
      // here via the shared additive check (grants on any _access dimension: public /
      // owner / users / groups). 404 (not 403) so we don't leak the course's
      // existence. Supers are exempt.
      if (!req.auth.isSuper) {
        try {
          await this.checkAccess(req, course)
        } catch (e) {
          throw this.app.errors.NOT_FOUND.setData({ type: 'content', id: _courseId })
        }
      }
      const treeFields = [
        '_id',
        '_parentId',
        '_courseId',
        '_type',
        '_sortOrder',
        'title',
        'displayTitle',
        '_friendlyId',
        '_component',
        '_layout',
        '_menu',
        '_theme',
        '_enabledPlugins',
        '_colorLabel',
        '_language',
        'heroImage',
        '_summary',
        'updatedAt'
      ]
      // ETag (not Last-Modified): folds the projected field list into the
      // validator so the cache busts when the response shape changes, not just
      // when the course data does — otherwise an added field stays missing for
      // unedited courses whose updatedAt never moves.
      const etag = treeEtag(course.updatedAt, treeFields)
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end()
      }
      const items = await this.find(
        { _courseId },
        { validate: false },
        { projection: fieldsToProjection(treeFields) }
      )
      const tree = new ContentTree(items)
      res.set('ETag', etag)
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
