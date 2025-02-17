import assert from 'node:assert';
import _ from 'lodash';
import sortKeys from 'sort-keys';

/**
 * Proxy handler for Storage
 */
const proxyHandler = {
  get(storage, property) {
    return storage.get(property);
  },
  set(storage, property, value) {
    storage.set(property, value);
    return true;
  },
  ownKeys(storage) {
    return Reflect.ownKeys(storage._store);
  },
  has(target, prop) {
    return target.get(prop) !== undefined;
  },
  getOwnPropertyDescriptor(target, key) {
    return {
      get: () => this.get(target, key),
      enumerable: true,
      configurable: true,
    };
  },
};

/**
 * Storage instances handle a json file where Generator authors can store data.
 *
 * The `Generator` class instantiate the storage named `config` by default.
 *
 * @constructor
 * @param {String} [name]     The name of the new storage (this is a namespace)
 * @param {mem-fs-editor} fs  A mem-fs editor instance
 * @param {String} configPath The filepath used as a storage.
 * @param {Object} [options] Storage options.
 * @param {Boolean} [options.lodashPath=false] Set true to treat name as a lodash path.
 * @param {Boolean} [options.disableCache=false] Set true to disable json object cache.
 * @param {Boolean} [options.disableCacheByFile=false] Set true to cleanup cache for every fs change.
 * @param {Boolean} [options.sorted=false] Set true to write sorted json.
 *
 * @example
 * class extend Generator {
 *   writing: function() {
 *     this.config.set('coffeescript', false);
 *   }
 * }
 */
class Storage {
  constructor(name, fs, configPath, options = {}) {
    if (name !== undefined && typeof name !== 'string') {
      configPath = fs;
      fs = name;
      name = undefined;
    }

    if (typeof options === 'boolean') {
      options = { lodashPath: options };
    }

    _.defaults(options, {
      lodashPath: false,
      disableCache: false,
      disableCacheByFile: false,
      sorted: false,
    });

    assert(configPath, 'A config filepath is required to create a storage');

    this.path = configPath;
    this.name = name;
    this.fs = fs;
    this.indent = 2;
    this.lodashPath = options.lodashPath;
    this.disableCache = options.disableCache;
    this.disableCacheByFile = options.disableCacheByFile;
    this.sorted = options.sorted;

    this.existed = Object.keys(this._store).length > 0;

    this.fs.store.on('change', filename => {
      // At mem-fs 1.1.3 filename is not passed to the event.
      if (this.disableCacheByFile || (filename && filename !== this.path)) {
        return;
      }

      delete this._cachedStore;
    });
  }

  /**
   * @protected
   * @return {Object} the store content
   */
  readContent() {
    return this.fs.readJSON(this.path, {});
  }

  /**
   * @protected
   * @return {Object} the store content
   */
  writeContent(fullStore) {
    return this.fs.writeJSON(this.path, fullStore, null, this.indent);
  }

  /**
   * Return the current store as JSON object
   * @return {Object} the store content
   * @private
   */
  get _store() {
    const store = this._cachedStore || this.readContent();
    if (!this.disableCache) {
      this._cachedStore = store;
    }

    if (!this.name) {
      return store || {};
    }

    return (this.lodashPath ? _.get(store, this.name) : store[this.name]) || {};
  }

  /**
   * Persist a configuration to disk
   * @param {Object} val - current configuration values
   * @private
   */
  _persist(value) {
    if (this.sorted) {
      value = sortKeys(value, { deep: true });
    }

    let fullStore;
    if (this.name) {
      fullStore = this.readContent();
      if (this.lodashPath) {
        _.set(fullStore, this.name, value);
      } else {
        fullStore[this.name] = value;
      }
    } else {
      fullStore = value;
    }

    this.writeContent(fullStore);
  }

  /**
   * Save a new object of values
   */
  save() {
    this._persist(this._store);
  }

  /**
   * Get a stored value
   * @param  {String} key  The key under which the value is stored.
   * @return {*}           The stored value. Any JSON valid type could be returned
   */
  get(key) {
    return this._store[key];
  }

  /**
   * Get a stored value from a lodash path
   * @param  {String} path  The path under which the value is stored.
   * @return {*}           The stored value. Any JSON valid type could be returned
   */
  getPath(path) {
    return _.get(this._store, path);
  }

  /**
   * Get all the stored values
   * @return {Object}  key-value object
   */
  getAll() {
    return _.cloneDeep(this._store);
  }

  /**
   * Assign a key to a value and schedule a save.
   * @param {String} key  The key under which the value is stored
   * @param {*} val  Any valid JSON type value (String, Number, Array, Object).
   * @return {*} val  Whatever was passed in as val.
   */
  set(key, value) {
    assert(!_.isFunction(value), "Storage value can't be a function");

    const store = this._store;

    if (_.isObject(key)) {
      value = _.assignIn(store, key);
    } else {
      store[key] = value;
    }

    this._persist(store);
    return value;
  }

  /**
   * Assign a lodash path to a value and schedule a save.
   * @param {String} path  The key under which the value is stored
   * @param {*} val  Any valid JSON type value (String, Number, Array, Object).
   * @return {*} val  Whatever was passed in as val.
   */
  setPath(path, value) {
    assert(!_.isFunction(value), "Storage value can't be a function");

    const store = this._store;
    _.set(store, path, value);
    this._persist(store);
    return value;
  }

  /**
   * Delete a key from the store and schedule a save.
   * @param  {String} key  The key under which the value is stored.
   */
  delete(key) {
    const store = this._store;
    delete store[key];
    this._persist(store);
  }

  /**
   * Setup the store with defaults value and schedule a save.
   * If keys already exist, the initial value is kept.
   * @param  {Object} defaults  Key-value object to store.
   * @return {*} val  Returns the merged options.
   */
  defaults(defaults) {
    assert(
      _.isObject(defaults),
      'Storage `defaults` method only accept objects',
    );
    const store = _.defaults({}, this._store, defaults);
    this._persist(store);
    return this.getAll();
  }

  /**
   * @param  {Object} defaults  Key-value object to store.
   * @return {*} val  Returns the merged object.
   */
  merge(source) {
    assert(_.isObject(source), 'Storage `merge` method only accept objects');
    const value = _.merge({}, this._store, source);
    this._persist(value);
    return this.getAll();
  }

  /**
   * Create a child storage.
   * @param  {String} path - relative path of the key to create a new storage.
   *                         Some paths need to be escaped. Eg: ["dotted.path"]
   * @return {Storage} Returns a new Storage.
   */
  createStorage(path) {
    const childName = this.name ? `${this.name}.${path}` : path;
    return new Storage(childName, this.fs, this.path, true);
  }

  /**
   * Creates a proxy object.
   * @return {Object} proxy.
   */
  createProxy() {
    return new Proxy(this, proxyHandler);
  }
}

export default Storage;
