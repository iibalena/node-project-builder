const ejs = require('ejs');
const path = require('path');
const FileUtils = require('./FileUtils');

/**
 * TemplateEngine - Handles template rendering using EJS
 */
class TemplateEngine {
  /**
   * Render a template with provided data
   * @param {string} templatePath - Path to the template file
   * @param {Object} data - Data to pass to the template
   * @returns {Promise<string>} Rendered content
   */
  static async render(templatePath, data = {}) {
    try {
      const templateContent = await FileUtils.readFile(templatePath);
      return ejs.render(templateContent, data);
    } catch (error) {
      throw new Error(`Failed to render template ${templatePath}: ${error.message}`);
    }
  }

  /**
   * Render a template string with provided data
   * @param {string} templateString - Template string
   * @param {Object} data - Data to pass to the template
   * @returns {string} Rendered content
   */
  static renderString(templateString, data = {}) {
    try {
      return ejs.render(templateString, data);
    } catch (error) {
      throw new Error(`Failed to render template string: ${error.message}`);
    }
  }

  /**
   * Render a template and write to file
   * @param {string} templatePath - Path to the template file
   * @param {string} outputPath - Path to write the rendered content
   * @param {Object} data - Data to pass to the template
   */
  static async renderToFile(templatePath, outputPath, data = {}) {
    const content = await this.render(templatePath, data);
    await FileUtils.writeFile(outputPath, content);
  }
}

module.exports = TemplateEngine;
