const PluginManager = require('./src/core/PluginManager');
const BasePlugin = require('./src/core/BasePlugin');
const NodeJSPlugin = require('./src/plugins/NodeJSPlugin');
const FileUtils = require('./src/utils/FileUtils');
const TemplateEngine = require('./src/utils/TemplateEngine');
const CLI = require('./src/cli/CLI');

module.exports = {
  PluginManager,
  BasePlugin,
  NodeJSPlugin,
  FileUtils,
  TemplateEngine,
  CLI
};
