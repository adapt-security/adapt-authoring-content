import AbstractApiModule from 'adapt-authoring-api';
/**
 * Module which handles course content
 * @memberof content
 * @extends {AbstractApiModule}
 */
class ContentModule extends AbstractApiModule {
  /** @override */
  async setValues() {
    const server = await this.app.waitForModule('server');
    /** @ignore */ this.root = 'content';
    /** @ignore */ this.collectionName = 'content';
    /** @ignore */ this.schemaName = 'content';
    /** @ignore */ this.router = server.api.createChildRouter('content');
    this.useDefaultRouteConfig();
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
      ...this.routes,
    ];
  }
  /** @override */
  async init() {
    await super.init();

    const [authored, jsonschema, mongodb, tags] = await this.app.waitForModule("authored", "jsonschema", "mongodb", "tags");
    /**
     * The current MongoDBModule instance for quick reference
     * @type {MongoDBModule}
     */
    this.db = mongodb;
    /**
     * The current JsonSchemaModule instance for quick reference
     * @type {JsonSchemaModule}
     */
    this.schema = jsonschema;

    await authored.registerModule(this);
    await tags.registerModule(this);
    /**
     * we extend config specifically here because it doesn't use the default content schema
     */
    jsonschema.extendSchema('config', authored.schemaName);
    jsonschema.extendSchema('config', tags.schemaExtensionName);

    this.router.addHandlerMiddleware(this.schemaNameMiddleware.bind(this));

    await mongodb.setIndex(this.collectionName, { _courseId: 1, _parentId: 1, _type: 1 });
  }
  /** @override */
  async handleValidation(data, options) {
    if(!options.validate) {
      return data;
    }
    const schema = await this.getSchema(options.schemaName, { _courseId : data._type === 'course' ? data._id : data._courseId });
    return schema.validate(data, options);
  }
  /** @override */
  async sanitiseRequestDataMiddleware(req, res, next) {
    this.schemaNameMiddleware(req, res, () => {
      super.sanitiseRequestDataMiddleware(req, res, next);
    });
  }
  /** @override */
  async getSchema(schemaName, data) {
    try { // try and determine a more specific schema
      schemaName = await this.getContentSchemaName(data);
    } catch(e) {}
    const contentplugin = await this.app.waitForModule('contentplugin');
    const [config] = await this.find({ _type: 'config', _courseId: data._courseId });
    let enabledPluginSchemas = [];
    try {
      enabledPluginSchemas = config._enabledPlugins.reduce((m, p) => [...m, ...contentplugin.getPluginSchemas(p)], []);
    } catch(e) {}
    return this.schema.getSchema(schemaName, {
      useCache: false,
      extensionFilter: s => contentplugin.isPluginSchema(s) ? enabledPluginSchemas.includes(s) : true
    });
  }
  /**
   * Recursively clones a content item
   * @param {String} userId The user performing the action
   * @param {String} _id ID of the object to clone
   * @param {String} _parentId The intended parent object (if this is not passed, no parent will be set)
   * @param {Object} customData Data to be applied to the content item
   * @return {Promise}
   */
  async clone(userId, _id, _parentId, customData) {
    const [originalDoc] = await this.find({ _id });
    if(!_id || !originalDoc) {
      throw this.app.errors.NOT_FOUND
        .setData({ type: originalDoc?._type, id: _id });
    }
    if(originalDoc._type === 'course') {
      return this.cloneCourse(userId, _id, customData);
    }
    const [parent] = await this.find({ _id: _parentId });

    if(!_parentId || !parent) {
      throw this.app.errors.INVALID_PARENT.setData({ parentId: _parentId });
    }
    const cloneData = Object.assign({}, originalDoc, { ...customData, _courseId: parent._courseId, _parentId, createdBy: userId });
    delete cloneData._id;
    if(!cloneData._parentId) delete cloneData._parentId;
    // need the below stringify for validation to work on ObjectIds
    const schemaName = cloneData._type === 'menu' || cloneData._type === 'page' ? 'contentobject' : cloneData._type;
    const newData = await this.insert(JSON.parse(JSON.stringify(cloneData)), { schemaName });
    const children = await this.find({ _parentId: _id });
    await Promise.all(children.map(({ _id }) => this.clone(userId, _id, newData._id)));
    return newData;
  }
  /**
   * Duplicates an existing course
   * @param {String} userId 
   * @param {String} _id 
   * @param {Object} customData Data to be applied to the course
   * @return {Promise}
   */
  async cloneCourse(userId, _id, customData) {
    const existingContent = await this.find({ _courseId: _id });
    const insert = (type, data = {}) => this.insert(JSON.parse(JSON.stringify({
        ...existingContent.find(i => i._type === type), 
        ...data, 
        createdBy: userId 
      })), { schemaName: type });
    // insert course and config objects
    const newCourse = await insert('course', customData);
    await insert('config', { _courseId: newCourse._id.toString() });
    // insert top-level content objects (clone function handles children)
    await Promise.all(existingContent
      .filter(i => i._parentId === _id)
      .map(co => this.clone(userId, co._id.toString(), newCourse._id.toString()))
    );
    return newCourse;
  }
  /** @override */
  async insert(data, options, mongoOptions) {
    const doc = await super.insert(data, options, mongoOptions);

    if(doc._type === 'course') { // add the _courseId to a new course to make querying easier
      return this.update({ _id: doc._id }, { _courseId: doc._id.toString() });
    }
    if(options.updateSortOrder !== false) await this.updateSortOrder(doc, data);
    if(options.updateEnabledPlugins !== false) await this.updateEnabledPlugins(doc);

    return doc;
  }
  /** @override */
  async update(query, data, options, mongoOptions) {
    const doc = await super.update(query, data, options, mongoOptions);
    await Promise.all([this.updateSortOrder(doc, data), this.updateEnabledPlugins(doc)]);
    return doc;
  }
  /** @override */
  async delete(query, options, mongoOptions, rootId) {
    this.setDefaultOptions(options);

    const [targetDoc] = await this.find(query);

    if(!targetDoc) {
      throw this.app.errors.NOT_FOUND.setData({ type: options.schemaName, id: JSON.stringify(query) });
    }
    if(targetDoc._type !== 'course') {
      return this.deleteChildren(targetDoc._id, options, mongoOptions, rootId);
    }
    await this.updateEnabledPlugins(targetDoc);
    const mongodb = await this.app.waitForModule('mongodb');
    // this find is needed for the event data later
    const courseDocs = await this.find({ _courseId: targetDoc._id });
    await mongodb.getCollection(options.collectionName).deleteMany({ _courseId: targetDoc._id }, mongoOptions);
    if(options.invokePostHook) await this.postDeleteHook.invoke(courseDocs);
    await this.updateSortOrder(targetDoc);
    return courseDocs;
  }
  /**
   * Recalculates the _sortOrder values for all content items affected by an update
   * @param {Object} item The existing item data
   * @param {Object} updateData The update data
   * @return {Promise} 
   */
  async updateSortOrder(item, updateData) {
    // some exceptions which don't need a _sortOrder
    if(item._type === 'config' || item._type === 'course' || !item._parentId) {
      return;
    }
    const siblings = await this.find({ _parentId: item._parentId, _id: { $ne: item._id } }, {}, { sort: { _sortOrder: 1 } });
    if(updateData) {
      const newSO = item._sortOrder-1 > -1 ? item._sortOrder-1 : siblings.length;
      siblings.splice(newSO, 0, item);
    }
    return Promise.all(siblings.map(async (s,i) => {
      const _sortOrder = i+1;
      if(s._sortOrder !== _sortOrder) super.update({ _id: s._id }, { _sortOrder });
    }));
  }
  /**
   * Recursive deletion applied to each child content item
   * @param {String} _id Target _id
   * @param {Object} options
   * @param {Object} mongoOptions
   * @param {String} rootId The initiating content item
   */
  async deleteChildren(_id, options, mongoOptions, rootId) {
    try {
      _id = this.db.ObjectId.parse(_id);
    } catch(e) {} // let the DB handle this one
    const children = await this.find({ _parentId: _id });

    const data = (await Promise.all([
      super.delete({ _id }, {...options, invokePostHook: false }, mongoOptions),
      ...children.map(c => this.delete({ _id: c._id }, options, mongoOptions, rootId || _id))
    ])).reduce((m, d) => m.concat(Array.isArray(d) ? d : [d]), []);

    if(options.invokePostHook) await this.postDeleteHook.invoke(data[0]);
    return data.length > 1 ? data : data[0];
  }
  /**
   * Maintains the list of plugins used in the current course
   * @param {Object} item The updated item 
   * @return {Promise} 
   */
  async updateEnabledPlugins({ _courseId, _type }) {
    if(_type !== 'component') {
      return;
    }
    const contentItems = await this.find({ _courseId });
    const config = contentItems.find(c => c._type === 'config');

    if(!config) {
      return; // can't continue if there's no config to update
    }
    const componentNames = (contentItems.filter(c => c._type === 'component')).map(c => c._component);
    const _enabledPlugins = Array.from(new Set([ // generate unique list of used plugins
      ...config._enabledPlugins, 
      ...componentNames, 
      config._menu, 
      config._theme
    ]));
    if(_enabledPlugins.length === config._enabledPlugins.every(p => _enabledPlugins.includes(p))) {
      return; // return early if the lists already match
    }
    const [contentplugin, jsonschema] = await this.app.waitForModule('contentplugin', 'jsonschema');
    // generate $or list with content types which need defaults applied
    let $or = _enabledPlugins
      .filter(p => !config._enabledPlugins.includes(p))
      .reduce((m, p) => m.concat(contentplugin.getPluginSchemas(p)), [])
      .reduce((types, pluginSchemaName) => {
        Object.keys(jsonschema.schemaExtensions).forEach(sourceName => {
          const include = jsonschema.schemaExtensions[sourceName] === pluginSchemaName &&
            sourceName !== 'component' &&
            !types.includes(sourceName);
          if(include) types.push(sourceName);
        });
        return types;
      }, [])
      .map(t => Object.create({ _type: t }));

    if(!$or.length) $or = undefined;
      
    return Promise.all([ // update list of enabled plugins & apply defaults
      super.update({ _id: config._id }, { _enabledPlugins }, { validate: false }),
      super.update({ _courseId, $or }, {}, { validate: false, schemaName: 'course', useDefaults: true })
    ]);
  }
  /**
   * Gets the correct schema name for a given content item
   * @param {Object} item Content item to be checked
   * @return {Promise} Resolves with the schema name 
   */
  async getContentSchemaName({ _component, _id, _type }) {
    const error = this.app.errors.UNKNOWN_SCHEMA_NAME.setData({ _id, _type, _component });
    let type = _type;
    let componentName = _component;
    
    if(_id && (!type || !componentName)) { // no explicit type, so look for record in the DB
      const [item] = await this.find({ _id });
      if(item) {
        type = item._type;
        componentName = item._component;
      }
    }
    if(!type && !componentName) {
      throw error;
    }
    if(type !== 'component') {
      return type === 'page' || type === 'menu' ? 'contentobject' : type;
    }
    const [component] = await (await this.app.waitForModule('contentplugin')).find({ name: componentName });
    if(!component) {
      throw error;
    }
    return `${component.targetAttribute.slice(1)}-component`;
  }
  /**
   * Middleware to store the content schemaName on client request (content works slightly differently to the standard APIs)
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   */
  async schemaNameMiddleware(req, res, next) {
    try {
      req.apiData.schemaName = await this.getContentSchemaName({ ...req.apiData.query, ...req.apiData.data });
    } catch(e) {
      req.apiData.schemaName = this.schemaName;
    }
    next();
  }
  /**
   * Creates a new parent content type, along with any necessary children
   * @param {external:ExpressRequest} req
   */
  async insertRecursive(req) {
    const rootId = req.apiData.query.rootId;
    const createdBy = req.auth.user._id.toString();
    let childTypes = ['course', 'page', 'article', 'block', 'component'];
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
    };
    const newItems = [];
    let parent;
    try {
      // figure out which children need creating
      if(rootId === undefined) { // new course
        parent = await this.insert({ _type: 'course', createdBy, ...req.apiData.data }, { schemaName: 'course' });
        newItems.push(parent);
        childTypes.splice(0, 1, 'config');
      } else {
        parent = (await this.find({ _id: rootId }))[0];
        // special case for menus
        req.body?._type === 'menu' ? 
          childTypes.splice(0, 1, 'menu') : 
          childTypes = childTypes.slice(childTypes.indexOf(parent._type)+1);
      }
      for(let _type of childTypes) {
        const data = Object.assign({ _type,  createdBy }, defaultData[_type]);
        if(parent) {
          Object.assign(data, { 
            _parentId: parent._id.toString(), 
            _courseId: parent._courseId.toString() 
          });
        }
        const item = await this.insert(data, { schemaName: await this.getContentSchemaName(data) });
        newItems.push(item);
        if(_type !== 'config') parent = item;
      }
    } catch(e) {
      await Promise.all(newItems.map(({ _id }) => super.delete({ _id }, { invokePostHook: false })));
      throw e;
    }
    // return the topmost new item
    return newItems[0];
  }
  /**
   * Special request handler for bootstrapping a new content object with dummy content
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   */
  async handleInsertRecursive(req, res, next) {
    try {
      res.status(201).json(await this.insertRecursive(req));
    } catch(e) {
      return next(e);
    }
  }
  /**
   * Request handler for cloning content items
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   * @return {Promise} Resolves with the cloned data
   */
  async handleClone(req, res, next) {
    try {
      await this.checkAccess(req, req.apiData.query);
      const { _id, _parentId } = req.body;
      
      const customData = { ...req.body };
      delete customData._id;
      delete customData._parentId;

      const newData = await this.clone(req.auth.user._id, _id, _parentId, customData);
      res.status(201).json(newData);
    } catch(e) {
      return next(e);
    }
  }
  /** @override */
  async serveSchema(req, res, next) {
    try {
      const { schema } = await this.getSchema(req.apiData.query.type, { _courseId: req.apiData.query.courseId });
      if(!schema) {
        return next(this.app.errors.NOT_FOUND.setData({ type: 'schema', id: req.apiData.query.type }));
      }
      res.type('application/schema+json').json(schema);
    } catch(e) {
      return next(e);
    }
  }
}

export default ContentModule;