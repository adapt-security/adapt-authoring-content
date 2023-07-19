import { AbstractApiModule, AbstractApiUtils } from 'adapt-authoring-api'
import _ from 'lodash'

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
      {
        route: '/languages',
        handlers: { get: this.handleLanguages.bind(this) }
      },
      {
        route: '/language',
        handlers: { post: this.handleLanguage.bind(this) },
        permissions: { post: ['write:content'] }
      },
      {
        route: '/check',
        handlers: { get: this.handleCheck.bind(this) },
        permissions: { get: ['read:content'] }
      },
      ...this.routes
    ]
  }

  /** @override */
  async init () {
    await super.init()

    const [authored, jsonschema, lang, mongodb, tags] = await this.app.waitForModule('authored', 'jsonschema', 'lang', 'mongodb', 'tags')

    await authored.registerModule(this)
    await tags.registerModule(this)
    /**
     * we extend config specifically here because it doesn't use the default content schema
     */
    jsonschema.extendSchema('config', authored.schemaName)
    jsonschema.extendSchema('config', tags.schemaExtensionName)

    await mongodb.setIndex(this.collectionName, { _courseId: 1, _parentId: 1, _type: 1 })

    // await this.checkPeerStructures()

    this._defaultLanguage = lang.getConfig('defaultLang')
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
    const _courseId = data._courseId ??
      (data._id ? (await this.find({ _id: data._id }, { validate: false }))[0]?._courseId : undefined)
    let enabledPluginSchemas = []
    if (_courseId) {
      try {
        const [config] = await this.find({ _type: 'config', _courseId }, { validate: false })
        enabledPluginSchemas = config._enabledPlugins.reduce((m, p) => [...m, ...contentplugin.getPluginSchemas(p)], [])
      } catch (e) {}
    }
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
    await Promise.all([
      options.updateSortOrder !== false && this.updateSortOrder(doc, data),
      options.updateEnabledPlugins !== false && this.updateEnabledPlugins(doc)
    ])
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
    const descendants = await this.getDescendants(targetDoc)

    await Promise.all([...descendants, targetDoc].map(d => {
      return super.delete({ _id: d._id }, { invokePostHook: false })
    }))
    await Promise.all([
      this.updateEnabledPlugins(targetDoc),
      this.updateSortOrder(targetDoc)
    ])
    return [targetDoc, ...descendants]
  }

  /**
   * Finds all descendant content items for a given root
   * @param {Object} rootItem The root item document
   * @returns {Array<Object>} Array of content items
   */
  async getDescendants (rootItem) {
    const courseItems = await this.find({ _courseId: rootItem._courseId })
    const descendants = []
    let items = [rootItem]
    do {
      items = items.reduce((m, i) => [...m, ...courseItems.filter(c => c._parentId?.toString() === i._id.toString())], [])
      descendants.push(...items)
    } while (items.length)
    return descendants
  }

  async descendToType (node, type) {
    const [lastChild] = (await this.find({ _parentId: node._id })).slice(-1)
    if (!lastChild) return node
    if (lastChild._type === type) return lastChild
    return await this.descendToType(lastChild, type)
  }

  async ascendToType (node, type) {
    const [parent] = (await this.find({ _id: node._parentId })).slice(-1)
    if (!parent) throw this.app.errors.INVALID_PARENT.setData({ parentId: node._parentId })
    if (parent._type === type) return parent
    return await this.ascendToType(parent, type)
  }

  async constructToType (node, type, userId, lang) {
    const typeHierarchy = ['course', 'page', 'article', 'block', 'component']
    const filteredTypes = typeHierarchy.slice(typeHierarchy.indexOf(node._type) + 1, typeHierarchy.indexOf(type) + 1)
    return await this.insertRecursive(node._id, userId.toString(), null, false, filteredTypes, lang)
  }

  async appendToBlock (block, component, userId, lang, isCut) {
    const children = await this.find({ _parentId: block._id })

    const leftChild = children.find(child => child._layout === 'left')
    const rightChild = children.find(child => child._layout === 'right')

    if (leftChild && !rightChild) {
      component._layout = 'right'
    } else if (!leftChild && rightChild) {
      component._layout = 'left'
    } else if (children.length > 0) {
      [block] = await this.insertRecursive(block._parentId, userId.toString(), { _sortOrder: block._sortOrder + 1 }, false, ['block'], lang)
    }

    if (isCut) return await this.cut(block, component)

    return await this.append(block, component, isCut)
  }

  async append (parent, child, isCut) {
    if (isCut) return await this.cut(parent, child, child._sortOrder)

    child._courseId = parent?._courseId
    child._parentId = parent._id

    const schemaName = child._type === 'menu' || child._type === 'page' ? 'contentobject' : child._type

    return await this.insert(AbstractApiUtils.stringifyValues(child), { schemaName })
  }

  async cut (parent, child, sortOrder) {
    const courseId = parent?._type === 'course' ? parent?._id : parent?._courseId
    const isMovingCourse = courseId.toString() !== child._courseId.toString()

    const newData = await this.update({ _id: child._id }, {
      _courseId: courseId.toString(),
      _parentId: parent._id.toString(),
      _sortOrder: sortOrder
    })

    const updateRecursive = async (parentId) => {
      const children = await this.find({ _parentId: parentId })
      return await Promise.all(children.map(async ({ title, _id, _courseId }) => {
        await this.update({ _id }, { _courseId: courseId.toString() })
        return await updateRecursive(_id)
      }))
    }

    // update subtree of child if cutting from one course to another
    if (isMovingCourse) updateRecursive(child._id)

    return newData
  }

  /**
   * Recursively clones a content item
   * @param {String} userId The user performing the action
   * @param {String} _id ID of the object to clone
   * @param {String} _parentId The intended parent object (if this is not passed, no parent will be set)
   * @param {Object} customData Data to be applied to the content being cloned
   * @param {Object} globalData Data to be applied to the content being cloned and its descendants
   * @return {Promise}
   */
  async clone (userId, _id, _parentId, customData = {}, globalData = {}, lang, isCut) {
    const [originalDoc] = await this.find({ _id })
    if (!originalDoc) {
      throw this.app.errors.NOT_FOUND
        .setData({ type: originalDoc?._type, id: _id })
    }
    const [parent] = _parentId ? await this.find({ _id: _parentId }) : []

    if (!parent && originalDoc._type !== 'course' && originalDoc._type !== 'config') {
      throw this.app.errors.INVALID_PARENT.setData({ parentId: _parentId })
    }

    let newData

    if (parent) {
      // clone menu, page, article, block, component
      const typeHierarchy = ['course', 'menu', 'page', 'article', 'block', 'component']
      const sourceType = originalDoc._type
      const indexOfType = type => typeHierarchy.indexOf(type)
      const indexOfSourceType = indexOfType(originalDoc._type)
      const indexOfMenuType = indexOfType('menu')
      const indexOfPageType = indexOfType('page')
      const indexOfGivenTargetType = indexOfType(parent._type)
      const requiredTargetType = typeHierarchy[indexOfSourceType - 1]
      const isGivenTargetGrandparentType = indexOfGivenTargetType < indexOfSourceType - 1

      const proposedData = {
        ...originalDoc,
        _trackingId: undefined,
        createdBy: userId,
        ...customData,
        ...globalData
      }

      if (!isCut) proposedData._id = undefined

      const isSourceMenu = indexOfSourceType === indexOfMenuType
      const isSourcePage = indexOfSourceType === indexOfPageType
      const isGivenTargetMenu = indexOfGivenTargetType === indexOfMenuType
      const isCloneMenuIntoMenu = isSourceMenu && isGivenTargetMenu
      const isClonePageIntoAncestor = isSourcePage && indexOfGivenTargetType < indexOfPageType
      const isCloneChildIntoParent = indexOfGivenTargetType === indexOfSourceType - 1

      if (isCloneMenuIntoMenu || isClonePageIntoAncestor || isCloneChildIntoParent) {
        // scenario 1: expected usage (paste component into block, block into article etc)

        newData = originalDoc._type === 'component'
          ? await this.appendToBlock(parent, proposedData, userId, lang, isCut)
          : await this.append(parent, proposedData, isCut)
      } else if (isGivenTargetGrandparentType) {
        // scenario 2: paste component directly into article/page or block directly into page

        let node

        if (customData._sortOrder) {
          // interpret _sortOrder as (i) new container is required and (ii) position of new container
          delete proposedData._sortOrder;
          // create the top level container with specified order
          [node] = await this.insertRecursive(_parentId, userId.toString(), { _sortOrder: customData._sortOrder }, false, [typeHierarchy[indexOfGivenTargetType + 1]], lang)
        } else {
          // order not given so append as last descendant
          node = await this.descendToType(parent, requiredTargetType)
        }

        if (node._type !== requiredTargetType) {
          // construct remainder of subtree
          [node] = (await this.constructToType(node, requiredTargetType, userId, lang)).slice(-1)
          newData = await this.append(node, proposedData, isCut)
        } else {
          // complete subtree already exists
          newData = originalDoc._type === 'component'
            ? await this.appendToBlock(node, proposedData, userId, lang, isCut)
            : await this.append(node, proposedData, isCut)
        }
      } else {
        // scenario 3: paste component into component, block into component etc

        const ancestorOfSourceType = await this.ascendToType(parent, sourceType)
        const node = await this.ascendToType(parent, requiredTargetType)

        newData = originalDoc._type === 'component' ? await this.appendToBlock(node, proposedData, userId, lang, isCut) : await this.append(node, { ...proposedData, _sortOrder: ancestorOfSourceType._sortOrder + 1 }, isCut)
      }
    } else {
      // clone course/config
      const schemaName = originalDoc._type === 'menu' || originalDoc._type === 'page' ? 'contentobject' : originalDoc._type
      // const newData = await this.insert(Object.assign(originalDoc, {
      newData = await this.insert(AbstractApiUtils.stringifyValues({
        ...originalDoc,
        _id: undefined,
        _trackingId: undefined,
        _courseId: parent?._type === 'course' ? parent?._id : parent?._courseId,
        _parentId,
        createdBy: userId,
        ...customData,
        ...globalData
      }), { schemaName })
    }

    if (originalDoc._type === 'course') {
      const [config] = await this.find({ _type: 'config', _courseId: originalDoc._courseId })
      await this.clone(userId, config._id, undefined, { _courseId: newData._id.toString() }, globalData, lang)
    }

    // re-parent the source
    if (isCut) return newData

    // clone subtree of source
    // ($ne condition ensures correct operation for cloning a menu into itself)
    const children = await this.find({ _parentId: _id, _id: { $ne: newData._id } })
    await Promise.all(children.map(({ _id }) => this.clone(userId, _id, newData._id, undefined, globalData, lang)))
    return newData
  }

  /**
   * Creates a new parent content type, along with any necessary children
   * @param {String} rootId ID of the root node into which the content hierarchy will be created
   * @param {String} userId The user performing the action
   * @param {Object} customData Data to be applied to the each item created
   * @param {Boolean} isMenu Whether a menu is to be created
   * @param {Array} childTypes The hierarchically ordered content types to be created
   * @param lang The language into which to translate default content strings
   * @return {Array} List of hierarchically ordered content models that were created
   */
  async insertRecursive (rootId, createdBy, customData, isMenu = false, childTypes, lang) {
    const defaultData = {
      page: { title: this.app.lang.translate(lang, 'app.newpagetitle') },
      article: { title: this.app.lang.translate(lang, 'app.newarticletitle') },
      block: { title: this.app.lang.translate(lang, 'app.newblocktitle') },
      component: {
        _component: 'adapt-contrib-text',
        _layout: 'full',
        title: this.app.lang.translate(lang, 'app.newtextcomponenttitle'),
        body: this.app.lang.translate(lang, 'app.newtextcomponentbody')
      }
    }
    const newItems = []

    let parent
    try {
      // if no root assume a new course should be created
      if (!rootId) {
        parent = await this.insert({ _type: 'course', createdBy, ...customData }, { schemaName: 'course' })
        newItems.push(parent)
        childTypes = ['config', 'page', 'article', 'block', 'component']
      } else {
        parent = (await this.find({ _id: rootId }))[0]
        // if hierarchy isn't specified then infer what to create
        if (!childTypes) {
          childTypes = ['course', 'menu', 'page', 'article', 'block', 'component']
          if (isMenu) {
            // remove 'course' so that we will create ['menu', 'page'...]
            childTypes.splice(0, 1)
          } else {
            // if inserting into course remove 'menu' so that we have ['course', 'page'...]
            if (parent._type === 'course') childTypes.splice(1, 1)
            // select the appropriate starting point in the hierarchy
            childTypes = childTypes.slice(childTypes.indexOf(parent._type) + 1)
          }
        }
      }
      for (const _type of childTypes) {
        const data = Object.assign({ _type, createdBy }, defaultData[_type])
        if (!parent) {
          Object.assign(data, customData)
        } else {
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
    return newItems
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
      const rootId = req.apiData.query.rootId
      const createdBy = req.auth.user._id.toString()
      const isMenu = req.apiData.data?._type === 'menu'
      res.status(201).json(await this.insertRecursive(rootId, createdBy, req.apiData.data, isMenu, undefined, req.acceptsLanguages(this.supportedLanguages)))
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
      const { _id, _parentId, isCut } = req.body

      const customData = { ...req.body }
      delete customData._id
      delete customData._parentId

      const newData = await this.clone(req.auth.user._id, _id, _parentId, customData, undefined, req.acceptsLanguages(this.supportedLanguages), isCut)
      res.status(201).json(newData)
    } catch (e) {
      return next(e)
    }
  }

  // return languages used in given course
  async handleLanguages (req, res, next) {
    try {
      const { courseId } = req.body
      const languages = await this.getLanguagesForCourse(courseId)
      const defaultLanguage = languages.includes(this._defaultLanguage)
        ? this._defaultLanguage
        : languages[0]
      res.status(200).json({ languages, defaultLanguage })
    } catch (e) {
      res.sendError(e)
      throw e
    }
  }

  async handleLanguage (req, res, next) {
    // try {
    const { courseId, lang } = req.body
    await this.addLanguage(req.auth.user._id, courseId, lang)
    res.status(201).json(['en'])
    /* } catch (e) {
      return res.sendError(e)
    } */
  }

  async handleCheck (req, res, next) {
    try {
      await this.checkPeerStructures()
      res.status(200)
    } catch (e) {
      return res.sendError(e)
    }
  }

  async checkPeerStructures () {
    const courses = await this.find({ _type: 'course' })
    const masterCourses = courses.filter(course => course._id.toString() === course._courseId.toString())

    await Promise.all(masterCourses.map(course => this.checkPeerStructure(course._courseId)))
  }

  async checkPeerStructure (masterCourseId) {
    const content = await this.getContentModels(masterCourseId)
    const languages = await this.getLanguagesForCourse(masterCourseId)

    if (languages.length <= 1) return

    // get the original course (before additional languages were added)
    const masterCourse = content.find(item => item._type === 'course' && item._id.toString() === item._courseId.toString())
    const masterLang = masterCourse._lang
    const masterContent = _.filter(content, { _lang: masterLang })

    // ensure the master language has no missing Friendly IDs
    const missing = this.getMissingFriendlyIds(masterContent)
    if (missing.length) {
      throw this.app.errors.FRIENDLY_ID_MISSING.setData({ list: missing })
    }

    // ensure the master language has no duplicate Friendly IDs
    const duplicates = this.getDuplicateFriendlyIds(masterContent)
    if (duplicates.length) {
      throw this.app.errors.FRIENDLY_ID_DUPLICATE.setData({ list: duplicates })
    }

    const groups = _.groupBy(content, '_lang')
    const peerless = languages.reduce((acc, curr) => { acc[curr] = []; return acc }, {})
    const extraneous = languages.reduce((acc, curr) => { acc[curr] = []; return acc }, {})

    Object.entries(groups).forEach(([lang, content]) => {
      const matched = []
      masterContent.forEach(item => {
        const peer = _.find(content, { _friendlyId: item._friendlyId })
        if (peer) {
          matched.push(peer)
        } else {
          peerless[lang].push(item)
        }
      })

      if (matched.length !== content.length) {
        extraneous[lang] = _.difference(content, matched)
      }
    })

    const hasPeerless = _.some(peerless, _.size)
    const hasExtraneous = _.some(extraneous, _.size)

    if (hasPeerless || hasExtraneous) {
      const peerlessData = _.reduce(peerless, (memo, items, lang) => {
        memo[lang] = _.map(items, '_friendlyId')
        return memo
      }, {})

      const extraneousData = _.reduce(extraneous, (memo, items, lang) => {
        memo[lang] = _.map(items, '_id')
        return memo
      }, {})

      const data = {
        courseId: masterCourseId,
        friendlyId: masterCourse._friendlyId,
        courseTitle: masterCourse.title || masterCourse.displayTitle,
        peerless: peerlessData,
        extraneous: extraneousData
      }

      throw this.app.errors.PEER_STRUCTURE.setData({ data: JSON.stringify(data) })
    }
  }

  async getContentModels (courseId) {
    return await this.find({ $and: [{ $or: [{ _courseId: courseId }, { _id: courseId }] }, { _type: { $ne: 'config' } }] })
  }

  async getLanguagesForCourse (courseId) {
    const content = await this.getContentModels(courseId)
    return _.uniq(_.map(content, '_lang'))
  }

  getMissingFriendlyIds (content) {
    return content.filter(item => !this.hasFriendlyId(item))
  }

  getDuplicateFriendlyIds (content) {
    const friendlyContent = content.filter(this.hasFriendlyId)
    const ids = _.map(friendlyContent, '_friendlyId')
    return _.filter(ids, (val, i, list) => _.includes(list, val, i + 1))
  }

  async addLanguage (userId, courseId, lang) {
    const content = await this.getContentModels(courseId)
    const duplicates = this.getDuplicateFriendlyIds(content)

    // if one language check for missing and duplicates
    // else check peer structure

    if (duplicates.length) {
      throw this.app.errors.FRIENDLY_ID_DUPLICATE.setData({ list: duplicates })
    }

    const course = content.find(item => item._id.toString() === courseId)
    const types = ['contentobject', 'article', 'block', 'component']

    await this.populateFriendlyIds('course', [course])

    await Promise.all(types.map(type => {
      const pred = type === 'contentobject'
        ? item => /page|menu/.test(item._type)
        : item => item._type === type
      const filtered = content.filter(pred)
      return this.populateFriendlyIds(type, filtered)
    }))

    const [originalDoc] = await this.find({ _id: courseId })
    const clonedCourseModel = await this.insert(AbstractApiUtils.stringifyValues({
      ...originalDoc,
      _id: undefined,
      _courseId: courseId, // identify peer course models
      createdBy: userId,
      _lang: lang
    }), { schemaName: 'course' })

    // reverse change to _courseId made by insert()
    this.update({ _id: clonedCourseModel._id }, { _courseId: courseId })

    const children = await this.find({ _parentId: courseId })
    await Promise.all(children.map(({ _id }) => this.clone(userId, _id, clonedCourseModel._id, undefined, { _courseId: courseId, _lang: lang }, this._defaultLanguage)))
  }

  async populateFriendlyIds (type, content) {
    let prefix

    switch (type) {
      case 'course': prefix = 'm'; break
      case 'contentobject': prefix = 'co-'; break
      case 'article': prefix = 'a-'; break
      case 'block': prefix = 'b-'; break
      case 'component': prefix = 'c-'; break
    }

    let digit = 5

    await Promise.all(content.map(item => {
      if (this.hasFriendlyId(item)) return Promise.resolve()

      let proposal

      proposal = `${prefix}0${digit}`

      while (content.find(item => item._friendlyId === proposal)) {
        digit += 5
        proposal = `${prefix}${digit}`
      }

      return this.update({ _id: item._id }, { _friendlyId: proposal })
    }))
  }

  getChildren (parent, content) {
    return content.filter(item => item._parentId && item._parentId.toString() === parent._id.toString())
  }

  getAllDescendantModels (parent, content, isParentFirst) {
    const descendants = []

    const children = this.getChildren(parent, content)

    if (!children) return descendants

    children.forEach(child => {
      const subDescendants = this.getAllDescendantModels(child, content, isParentFirst)
      if (isParentFirst === true) {
        descendants.push(child)
      }

      descendants.push(...subDescendants)

      if (isParentFirst !== true) {
        descendants.push(child)
      }
    })

    return descendants
  }

  hasFriendlyId (content) {
    const id = content._friendlyId
    return id !== null && id !== undefined && id !== '' && !/^\s+$/.test(id)
  }

  getPrintableContent (content) {
    return content.map(item => {
      const title = item.displayTitle || item.title || '<untitled>'
      return `${title} [${item._type}] [${item._id}]`
    })
  }
}

export default ContentModule
