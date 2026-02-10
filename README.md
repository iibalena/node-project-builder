# Node Project Builder

A modular CLI to scaffold Node.js projects using a plugin-based architecture, designed to evolve into a multi-stack project builder (Node, Angular, and beyond).

## Features

- 🔌 **Plugin-Based Architecture**: Extensible system that allows adding new project types through plugins
- 🚀 **Interactive CLI**: User-friendly command-line interface with interactive prompts
- 📦 **Node.js Scaffolding**: Built-in support for scaffolding Node.js projects with Express
- 🎨 **Template Engine**: EJS-based templating for flexible project generation
- 🛠️ **Modular Design**: Clean separation of concerns with core, plugins, and utilities

## Installation

### Local Development

```bash
# Clone the repository
git clone https://github.com/iibalena/node-project-builder.git
cd node-project-builder

# Install dependencies
npm install

# Link the CLI globally (for development)
npm link
```

### NPM (when published)

```bash
npm install -g project-builder
```

## Usage

### Create a New Project (Interactive)

```bash
project-builder new
```

This will prompt you for:
- Project type (nodejs)
- Project name
- Description
- Author

### Create a New Project (Command Line)

```bash
project-builder new --type nodejs --name my-app --description "My awesome app" --author "Your Name"
```

### List Available Project Types

```bash
project-builder list
```

### CLI Options

```
project-builder new [options]

Options:
  -t, --type <type>              Project type (nodejs)
  -n, --name <name>              Project name
  -d, --description <description> Project description
  -a, --author <author>          Project author
  -p, --path <path>              Target path (default: current directory)
  -h, --help                     Display help for command
```

## Architecture

### Core Components

```
src/
├── cli/              # Command-line interface
│   └── CLI.js        # Main CLI implementation
├── core/             # Core plugin system
│   ├── BasePlugin.js    # Abstract base plugin class
│   └── PluginManager.js # Plugin registration and execution
├── plugins/          # Plugin implementations
│   └── NodeJSPlugin.js  # Node.js project scaffolding
├── templates/        # Project templates
│   └── nodejs/       # Node.js templates
├── utils/            # Utility modules
│   ├── FileUtils.js     # File system operations
│   └── TemplateEngine.js # EJS template rendering
```

### Plugin System

The plugin architecture allows easy extension with new project types:

```javascript
const BasePlugin = require('./src/core/BasePlugin');

class MyPlugin extends BasePlugin {
  constructor() {
    super('my-plugin', 'Description of my plugin');
  }

  async scaffold(options) {
    // Implementation
    return {
      success: true,
      message: 'Project created successfully',
      path: '/path/to/project'
    };
  }
}
```

## Testing

Run the test suite:

```bash
npm test
```

Run tests with coverage:

```bash
npm test -- --coverage
```

## Development

### Project Structure

- `bin/` - CLI executable
- `src/` - Source code
  - `cli/` - Command-line interface
  - `core/` - Core plugin system
  - `plugins/` - Plugin implementations
  - `templates/` - Project templates
  - `utils/` - Utility modules
- `tests/` - Test files
  - `unit/` - Unit tests
  - `integration/` - Integration tests

### Adding a New Plugin

1. Create a new plugin class extending `BasePlugin`
2. Implement the `scaffold` method
3. Add templates in `src/templates/<plugin-name>/`
4. Register the plugin in `src/cli/CLI.js`
5. Add tests in `tests/unit/`

## Future Plans

- 🅰️ **Angular Support**: Plugin for scaffolding Angular applications
- ⚛️ **React Support**: Plugin for React projects
- 🎯 **TypeScript Support**: TypeScript project templates
- 🐍 **Python Support**: Extend beyond Node.js ecosystem
- 🔧 **Custom Templates**: Allow users to define custom templates
- 📝 **Configuration Files**: Support for project configuration presets

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
