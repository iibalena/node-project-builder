/**
 * PluginManager - Manages plugin registration and lifecycle
 * Enables extensibility through a plugin-based architecture
 */
class PluginManager {
  constructor() {
    this.plugins = new Map();
  }

  /**
   * Register a plugin
   * @param {string} name - Plugin name
   * @param {Object} plugin - Plugin instance
   */
  register(name, plugin) {
    if (this.plugins.has(name)) {
      throw new Error(`Plugin '${name}' is already registered`);
    }

    if (!plugin.scaffold || typeof plugin.scaffold !== 'function') {
      throw new Error(`Plugin '${name}' must implement a 'scaffold' method`);
    }

    this.plugins.set(name, plugin);
  }

  /**
   * Get a plugin by name
   * @param {string} name - Plugin name
   * @returns {Object} Plugin instance
   */
  get(name) {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins
   * @returns {Array} Array of plugin names
   */
  list() {
    return Array.from(this.plugins.keys());
  }

  /**
   * Check if a plugin exists
   * @param {string} name - Plugin name
   * @returns {boolean} True if plugin exists
   */
  has(name) {
    return this.plugins.has(name);
  }

  /**
   * Execute a plugin's scaffold method
   * @param {string} name - Plugin name
   * @param {Object} options - Options to pass to the plugin
   * @returns {Promise} Plugin execution result
   */
  async execute(name, options) {
    const plugin = this.get(name);
    if (!plugin) {
      throw new Error(`Plugin '${name}' not found`);
    }

    return await plugin.scaffold(options);
  }
}

module.exports = PluginManager;
