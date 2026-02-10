const BasePlugin = require('../../src/core/BasePlugin');

describe('BasePlugin', () => {
  test('should create a plugin with name and description', () => {
    const plugin = new BasePlugin('test-plugin', 'A test plugin');
    expect(plugin.name).toBe('test-plugin');
    expect(plugin.description).toBe('A test plugin');
  });

  test('should throw error when scaffold is not implemented', async () => {
    const plugin = new BasePlugin('test-plugin', 'A test plugin');
    await expect(plugin.scaffold({})).rejects.toThrow(
      'scaffold() method must be implemented by plugin'
    );
  });

  test('should return metadata', () => {
    const plugin = new BasePlugin('test-plugin', 'A test plugin');
    const metadata = plugin.getMetadata();
    expect(metadata).toEqual({
      name: 'test-plugin',
      description: 'A test plugin'
    });
  });
});
