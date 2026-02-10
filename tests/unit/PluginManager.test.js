const PluginManager = require('../../src/core/PluginManager');
const BasePlugin = require('../../src/core/BasePlugin');

describe('PluginManager', () => {
  let pluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  test('should create a new plugin manager instance', () => {
    expect(pluginManager).toBeInstanceOf(PluginManager);
    expect(pluginManager.plugins).toBeInstanceOf(Map);
  });

  test('should register a valid plugin', () => {
    const mockPlugin = {
      scaffold: jest.fn()
    };

    pluginManager.register('test-plugin', mockPlugin);
    expect(pluginManager.has('test-plugin')).toBe(true);
  });

  test('should throw error when registering duplicate plugin', () => {
    const mockPlugin = {
      scaffold: jest.fn()
    };

    pluginManager.register('test-plugin', mockPlugin);
    expect(() => pluginManager.register('test-plugin', mockPlugin)).toThrow(
      "Plugin 'test-plugin' is already registered"
    );
  });

  test('should throw error when plugin lacks scaffold method', () => {
    const invalidPlugin = {};

    expect(() => pluginManager.register('invalid-plugin', invalidPlugin)).toThrow(
      "Plugin 'invalid-plugin' must implement a 'scaffold' method"
    );
  });

  test('should get a registered plugin', () => {
    const mockPlugin = {
      scaffold: jest.fn()
    };

    pluginManager.register('test-plugin', mockPlugin);
    const retrieved = pluginManager.get('test-plugin');
    expect(retrieved).toBe(mockPlugin);
  });

  test('should return undefined for non-existent plugin', () => {
    expect(pluginManager.get('non-existent')).toBeUndefined();
  });

  test('should list all registered plugins', () => {
    const plugin1 = { scaffold: jest.fn() };
    const plugin2 = { scaffold: jest.fn() };

    pluginManager.register('plugin1', plugin1);
    pluginManager.register('plugin2', plugin2);

    const list = pluginManager.list();
    expect(list).toEqual(['plugin1', 'plugin2']);
  });

  test('should execute a plugin successfully', async () => {
    const mockPlugin = {
      scaffold: jest.fn().mockResolvedValue({ success: true })
    };

    pluginManager.register('test-plugin', mockPlugin);
    const result = await pluginManager.execute('test-plugin', { option: 'value' });

    expect(mockPlugin.scaffold).toHaveBeenCalledWith({ option: 'value' });
    expect(result).toEqual({ success: true });
  });

  test('should throw error when executing non-existent plugin', async () => {
    await expect(pluginManager.execute('non-existent', {})).rejects.toThrow(
      "Plugin 'non-existent' not found"
    );
  });
});
