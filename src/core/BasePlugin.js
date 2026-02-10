/**
 * BasePlugin - Abstract base class for all plugins
 * Provides common functionality and interface definition
 */
class BasePlugin {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }

  /**
   * Scaffold method - must be implemented by subclasses
   * @param {Object} options - Configuration options
   * @returns {Promise} Scaffolding result
   */
  async scaffold(options) {
    throw new Error('scaffold() method must be implemented by plugin');
  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description
    };
  }
}

module.exports = BasePlugin;
