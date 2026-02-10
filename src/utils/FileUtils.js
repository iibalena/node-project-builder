const fs = require('fs').promises;
const path = require('path');
const ejs = require('ejs');

/**
 * FileUtils - Utility functions for file operations
 */
class FileUtils {
  /**
   * Create a directory recursively
   * @param {string} dirPath - Directory path
   */
  static async createDirectory(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
    }
  }

  /**
   * Write content to a file
   * @param {string} filePath - File path
   * @param {string} content - File content
   */
  static async writeFile(filePath, content) {
    try {
      const dir = path.dirname(filePath);
      await this.createDirectory(dir);
      await fs.writeFile(filePath, content, 'utf8');
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Read a file
   * @param {string} filePath - File path
   * @returns {Promise<string>} File content
   */
  static async readFile(filePath) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Check if a path exists
   * @param {string} path - Path to check
   * @returns {Promise<boolean>} True if path exists
   */
  static async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Copy a file
   * @param {string} source - Source file path
   * @param {string} destination - Destination file path
   */
  static async copyFile(source, destination) {
    try {
      const dir = path.dirname(destination);
      await this.createDirectory(dir);
      await fs.copyFile(source, destination);
    } catch (error) {
      throw new Error(`Failed to copy file from ${source} to ${destination}: ${error.message}`);
    }
  }
}

module.exports = FileUtils;
