import { AbstractApiModule, AbstractApiUtils } from 'adapt-authoring-api'
import _ from 'lodash'

import apidefs from './apidefs.js'

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
        permissions: { post: ['write:content'] },
        meta: apidefs.insertrecursive
      },
      {
        route: '/clone',
        handlers: { post: this.handleClone.bind(this) },
        permissions: { post: ['write:content'] },
        meta: apidefs.clone
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
    const isCourse = data._type === 'course'
    const isConfig = data._type === 'config'

    if (!isCourse && !isConfig) {
      const [parent] = await this.find({ _id: data._parentId })

      if (!parent) throw Error()
    }

    const doc = await super.insert(data, options, mongoOptions)

    if (isCourse) {
      return await this.update({ _id: doc._id }, { _courseId: doc._id.toString() }, options, mongoOptions)
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
  async delete (query, options = {}, mongoOptions) {
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

    if (rootItem._type === 'course') {
      descendants.push(courseItems.find(c => c._type === 'config'))
    }
    return descendants
  }

  /**
   * Traverse the descendants of the given content until the required type is found
   * @param {Object} node the location from which to begin the search
   * @param {String} type the level in the descendants to locate
   * @returns {Promise} resolves with the last-sorted descendant of the required type or the last-sorted descendant of the nearest type
   */
  async descendToType (node, type) {
    const children = await this.find({ _parentId: node._id })
    if (!children.length) return node
    const [lastChild] = _.sortBy(children, '_sortOrder').slice(-1)
    if (lastChild._type === type) return lastChild
    return await this.descendToType(lastChild, type)
  }

  /**
   * Traverse the ancestry of the given content until the required type is found
   * @param {Object} node the location from which to begin the search
   * @param {String} type the level in the ancestry to locate
   * @returns {Promise} resolves with the ancestor of the required type
   */
  async ascendToType (node, type) {
    const [parent] = (await this.find({ _id: node._parentId })).slice(-1)
    if (!parent) throw this.app.errors.INVALID_PARENT.setData({ parentId: node._parentId })
    if (parent._type === type) return parent
    return await this.ascendToType(parent, type)
  }

  /**
   * Creates the required descendant hierarchy under the given location. For example, calling this function by passing it a page as the first argument and 'block' for the second argument would create an article with a single empty block inside the given page.
   * @param {Object} node the location at which to create the descendant hierarchy
   * @param {String} type the level in the descendant hierarchy at which to stop
   * @param {String} userId the user performing the action
   * @param {Object} options optional settings
   * @returns {Promise} resolves with a list of hierarchically ordered content models that were created
   */
  async constructToType (node, type, userId, options) {
    const typeHierarchy = ['course', 'page', 'article', 'block', 'component']
    const filteredTypes = typeHierarchy.slice(typeHierarchy.indexOf(node._type) + 1, typeHierarchy.indexOf(type) + 1)
    return await this.insertRecursive(node._id, userId.toString(), null, false, filteredTypes, options)
  }

  /**
   * Helper function for appending a component to a block
   * @param {Object} block the content to which [component] should be appended
   * @param {Object} component the content to be appended
   * @param {String} userId the user performing the action
   * @param {Boolean} isCut whether [component] is to be cut from its current location
   * @param {Object} options optional settings
   * @returns {Promise} resolves with the component that was appended
   */
  async appendToBlock (block, component, userId, isCut, options) {
    const children = await this.find({ _parentId: block._id })

    const leftChild = children.find(child => child._layout === 'left')
    const rightChild = children.find(child => child._layout === 'right')

    if (leftChild && !rightChild) {
      component._layout = 'right'
    } else if (!leftChild && rightChild) {
      component._layout = 'left'
    } else if (children.length > 0) {
      [block] = await this.insertRecursive(block._parentId, userId.toString(), { _sortOrder: block._sortOrder + 1 }, false, ['block'], options)
    }

    if (isCut) return await this.cut(block, component, options)

    return await this.append(block, component, isCut, options)
  }

  /**
   * Helper function for appending a child to a parent
   * @param {Object} parent the content to which [child] should be appended
   * @param {Object} child the content to be appended
   * @param {Boolean} isCut whether [child] is to be cut from its current location
   * @param {Object} options optional settings
   * @returns {Promise} resolves with the content that was appended
   */
  async append (parent, child, isCut, options) {
    if (isCut) return await this.cut(parent, child, child._sortOrder)

    child._courseId = parent?._courseId
    child._parentId = parent._id

    const schemaName = child._type === 'menu' || child._type === 'page' ? 'contentobject' : child._type

    return await this.insert(AbstractApiUtils.stringifyValues(child), Object.assign({ schemaName }, options))
  }

  /**
   * Helper function for cutting and pasting content
   * @param {Object} parent the location in which to paste [child]
   * @param {Object} child the content being cut
   * @param {Number} sortOrder the position in [parent] at which to paste [child]
   * @param {Object} options optional settings
   * @returns {Promise} resolves with the content that was cut
   */
  async cut (parent, child, sortOrder, options) {
    const newData = await this.update({ _id: child._id }, {
      /* _courseId: courseId.toString(), */
      _parentId: parent._id.toString(),
      _sortOrder: sortOrder
    }, options)

    return newData
  }

  /**
   * Attempts to recursively clone a content item into a given location
   * Walks tree to find appropriate location and constructs any model hierarchy as required
   * @param {String} userId The user performing the action
   * @param {String} _id ID of the object to clone
   * @param {String} _parentId The intended parent object (if this is not passed, no parent will be set)
   * @param {Object} customData Data to be applied to the content being cloned
   * @param {Object} globalData Data to be applied to the content being cloned and its descendants
   * @param {Boolean} isCut whether the content is to be cut from its current location
   * @param {Object} options optional settings
   * @return {Promise}
   */
  async clone (userId, _id, _parentId, customData = {}, globalData = {}, isCut, options) {
    const [originalDoc] = await this.find({ _id })

    if (!originalDoc) {
      throw this.app.errors.NOT_FOUND.setData({ type: originalDoc?._type, id: _id })
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
          ? await this.appendToBlock(parent, proposedData, userId, isCut, options)
          : await this.append(parent, proposedData, isCut, options)
      } else if (isGivenTargetGrandparentType) {
        // scenario 2: paste component directly into article/page or block directly into page

        let node

        if (customData._sortOrder) {
          // interpret _sortOrder as (i) new container is required and (ii) position of new container
          delete proposedData._sortOrder;
          // create the top level container with specified order
          [node] = await this.insertRecursive(_parentId, userId.toString(), { _sortOrder: customData._sortOrder }, false, [typeHierarchy[indexOfGivenTargetType + 1]], options)
        } else {
          // order not given so append as last descendant
          node = await this.descendToType(parent, requiredTargetType)
        }

        if (node._type !== requiredTargetType) {
          // construct remainder of subtree
          [node] = (await this.constructToType(node, requiredTargetType, userId, options)).slice(-1)
          newData = await this.append(node, proposedData, isCut, options)
        } else {
          // complete subtree already exists
          newData = originalDoc._type === 'component'
            ? await this.appendToBlock(node, proposedData, userId, isCut, options)
            : await this.append(node, proposedData, isCut, options)
        }
      } else {
        // scenario 3: paste component into component, block into component etc

        const ancestorOfSourceType = await this.ascendToType(parent, sourceType)
        const node = await this.ascendToType(parent, requiredTargetType)

        newData = originalDoc._type === 'component'
          ? await this.appendToBlock(node, proposedData, userId, isCut, options)
          : await this.append(node, { ...proposedData, _sortOrder: ancestorOfSourceType._sortOrder + 1 }, isCut, options)
      }
    } else {
      // clone course/config
      const schemaName = originalDoc._type === 'menu' || originalDoc._type === 'page' ? 'contentobject' : originalDoc._type
      newData = await this.insert(AbstractApiUtils.stringifyValues({
        ...originalDoc,
        _id: undefined,
        _trackingId: undefined,
        _courseId: parent?._type === 'course' ? parent?._id : parent?._courseId, // TODO: needed? parent is falsy here..
        _parentId,
        createdBy: userId,
        ...customData,
        ...globalData
      }), Object.assign({ schemaName }, options))
    }

    // re-parent the source
    if (isCut) return newData

    // clone subtree of source
    let children = await this.find({ _parentId: _id })
    // ensure correct operation when cloning a menu into itself
    children = children.filter(i => i._id !== newData._id)
    for (let i = 0; i < children.length; i++) {
      // run sequentially
      await this.clone(userId, children[i]._id, newData._id, undefined, globalData, false, options)
    }
    return newData
  }

  /**
   * Creates a new parent content type, along with any necessary children
   * @param {String} rootId ID of the root node into which the content hierarchy will be created
   * @param {String} userId The user performing the action
   * @param {Object} customData Data to be applied to the created root item
   * @param {Boolean} isMenu Whether a menu is to be created
   * @param {Array} childTypes The hierarchically ordered content types to be created
   * @param {Object} options optional settings
   * @return {Promise} resovles with the list of hierarchically ordered content models that were created
   */
  async insertRecursive (rootId, createdBy, customData = {}, isMenu = false, childTypes, options = {}) {
    const { stringLocalisation = this._defaultLanguage } = options
    const defaultData = {
      page: { title: this.app.lang.translate(stringLocalisation, 'app.newpagetitle') },
      article: { title: this.app.lang.translate(stringLocalisation, 'app.newarticletitle') },
      block: { title: this.app.lang.translate(stringLocalisation, 'app.newblocktitle') },
      component: {
        _component: 'adapt-contrib-text',
        _layout: 'full',
        title: this.app.lang.translate(stringLocalisation, 'app.newtextcomponenttitle'),
        body: this.app.lang.translate(stringLocalisation, 'app.newtextcomponentbody')
      }
    }
    const newItems = []

    let parent
    const shouldCreateCourse = !rootId

    if (shouldCreateCourse) {
      parent = await this.insert({ _type: 'course', createdBy, ...customData }, { schemaName: 'course' })
      newItems.push(parent)
      childTypes = ['config', 'page', 'article', 'block', 'component']
      customData = undefined // only apply customData to root item
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
      Object.assign(data, {
        _parentId: parent._id.toString(),
        _courseId: parent._courseId.toString(),
        _lang: parent._lang,
        ...customData
      })
      if (_type === 'config') data._defaultLanguage = parent._lang || this._defaultLanguage
      const item = await this.insert(data, options)
      newItems.push(item)
      if (_type !== 'config') parent = item
      customData = undefined // only apply customData to root item
    }

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

    const [parent] = await this.find({ _id: item._parentId })

    let siblings

    if (updateData) {
      // insert or update

      siblings = await this.findSiblings(item._parentId, item._id)

      const newSO = item._sortOrder - 1 > -1 ? item._sortOrder - 1 : siblings.length
      siblings.splice(newSO, 0, item)
    } else {
      // deletion

      siblings = await this.findSiblings(parent._id)
    }

    for (let s = 0; s < siblings.length; s++) {
      const sibling = siblings[s]
      const _sortOrder = s + 1

      if (sibling._sortOrder !== _sortOrder) {
        await super.update({ _id: sibling._id }, { _sortOrder })
      }
    }
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

      const lang = await this.app.waitForModule('lang')
      const opts = { stringLocalisation: req.acceptsLanguages(lang.supportedLanguages) }
      res.status(201).json(await this.insertRecursive(rootId, createdBy, req.apiData.data, isMenu, undefined, opts))
    } catch (e) {
      return next(e)
    }
  }

  async cloneCourse (courseId, userId, customData) {
    const [sourceConfig] = await this.find({ _type: 'config', _courseId: courseId })
    const { title } = customData

    let referenceCourse

    const doClone = async (courseObject) => {
      // clone a specific language course object
      const clonedCourseModel = await this.insert(AbstractApiUtils.stringifyValues({
        ...courseObject,
        title,
        displayTitle: title,
        _id: undefined,
        createdBy: userId
      }), { schemaName: 'course', validate: false })

      if (referenceCourse) {
        // reverse change to _courseId made by insert()
        await this.update(
          { _id: clonedCourseModel._id },
          { _courseId: referenceCourse._courseId.toString() }
        )
      } else {
        referenceCourse = clonedCourseModel
      }

      const children = await this.find({ _parentId: courseObject._id })

      // clone the content for the specific language
      for (let i = 0; i < children.length; i++) {
        await this.clone(
          userId,
          children[i]._id,
          clonedCourseModel._id,
          undefined,
          { _courseId: referenceCourse._courseId.toString() },
          false,
          { validate: false }
        )
      }

      return clonedCourseModel
    }

    const [courseObject] = await this.find({ _courseId: courseId, _type: 'course' })

    // the clone will provide the new course ID
    referenceCourse = await doClone(courseObject)

    // now clone the config
    await this.insert(AbstractApiUtils.stringifyValues({
      ...sourceConfig,
      _id: undefined,
      _courseId: referenceCourse._courseId,
      createdBy: userId
    }), { schemaName: 'config', validate: false })

    return referenceCourse
  }

  async crossCourseCut (userId, _id, _parentId, customData) {
    const newData = await this.clone(userId, _id, _parentId, customData, undefined, false)
    // delete the source content
    await this.delete({ _id })

    return newData
  }

  /**
   * Request handler for cloning content items
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   * @return {Promise} Resolves with the cloned data
   */
  async handleClone (req, res, next) {
    let sourceCourseId, targetCourseId
    const userId = req.auth.user._id.toString()
    try {
      await this.checkAccess(req, req.apiData.query)
      const { _id, _parentId, isCut } = req.body

      const [source] = await this.find({ _id })
      const [target] = await this.find({ _id: _parentId })

      sourceCourseId = source._courseId
      targetCourseId = target._courseId

      const isCrossCourse = !this.isIdEqual(sourceCourseId, targetCourseId)
      const isCloneCourse = !_parentId

      const customData = { ...req.body }
      delete customData._id
      delete customData._parentId

      let newData

      if (isCrossCourse) {
        newData = await this.crossCourseCut(userId, _id, _parentId, customData)
      } else if (isCloneCourse) {
        newData = await this.cloneCourse(sourceCourseId, userId, customData)
      } else {
        newData = await this.clone(userId, _id, _parentId, customData, undefined, isCut)
      }

      res.status(201).json(newData)
    } catch (e) {
      return next(e)
    }
  }

  async getContentModels (courseId) {
    return await this.find({ _courseId: courseId, _type: { $ne: 'config' } })
  }

  isIdEqual (a, b) {
    return a?.toString() === b?.toString()
  }

  // given an item find its siblings
  async findSiblings (parentId, excludeId = null, shouldSort = true) {
    const query = {
      _parentId: parentId,
      ...(excludeId && { _id: { $ne: excludeId } })
    }
    const mongoOptions = {
      ...(shouldSort && { sort: { _sortOrder: 1 } })
    }
    return this.find(query, {}, mongoOptions)
  }
}

export default ContentModule
