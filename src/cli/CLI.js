const { Command } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const path = require('path');
const PluginManager = require('../core/PluginManager');
const NodeJSPlugin = require('../plugins/NodeJSPlugin');

/**
 * CLI - Main command-line interface
 */
class CLI {
  constructor() {
    this.program = new Command();
    this.pluginManager = new PluginManager();
    this.setupPlugins();
    this.setupCommands();
  }

  /**
   * Register all available plugins
   */
  setupPlugins() {
    // Register Node.js plugin
    this.pluginManager.register('nodejs', new NodeJSPlugin());
  }

  /**
   * Setup CLI commands
   */
  setupCommands() {
    this.program
      .name('project-builder')
      .description('A modular CLI to scaffold projects using a plugin-based architecture')
      .version('1.0.0');

    // New command - create a new project
    this.program
      .command('new')
      .description('Create a new project')
      .option('-t, --type <type>', 'Project type (nodejs)')
      .option('-n, --name <name>', 'Project name')
      .option('-d, --description <description>', 'Project description')
      .option('-a, --author <author>', 'Project author')
      .option('-p, --path <path>', 'Target path', process.cwd())
      .action(async (options) => {
        await this.handleNewCommand(options);
      });

    // List command - show available project types
    this.program
      .command('list')
      .description('List available project types')
      .action(() => {
        this.handleListCommand();
      });
  }

  /**
   * Handle 'new' command
   */
  async handleNewCommand(options) {
    try {
      let { type, name, description, author, path: targetPath } = options;

      // Interactive prompts if options not provided
      if (!type) {
        const typeAnswer = await inquirer.prompt([
          {
            type: 'list',
            name: 'type',
            message: 'Select project type:',
            choices: this.pluginManager.list()
          }
        ]);
        type = typeAnswer.type;
      }

      if (!name) {
        const nameAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Project name:',
            validate: (input) => input.trim() !== '' || 'Project name is required'
          }
        ]);
        name = nameAnswer.name;
      }

      if (!description) {
        const descAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'description',
            message: 'Project description:',
            default: 'A new project'
          }
        ]);
        description = descAnswer.description;
      }

      if (!author) {
        const authorAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'author',
            message: 'Author name:',
            default: ''
          }
        ]);
        author = authorAnswer.author;
      }

      console.log(chalk.blue('\n🚀 Creating project...\n'));

      const result = await this.pluginManager.execute(type, {
        projectName: name,
        description,
        author,
        targetPath
      });

      if (result.success) {
        console.log(chalk.green('✓ ' + result.message));
        console.log(chalk.yellow('\nNext steps:'));
        console.log(chalk.white(`  cd ${name}`));
        console.log(chalk.white('  npm install'));
        console.log(chalk.white('  npm start\n'));
      }
    } catch (error) {
      console.error(chalk.red('✗ Error: ' + error.message));
      process.exit(1);
    }
  }

  /**
   * Handle 'list' command
   */
  handleListCommand() {
    console.log(chalk.blue('\nAvailable project types:\n'));
    const plugins = this.pluginManager.list();
    
    plugins.forEach(pluginName => {
      const plugin = this.pluginManager.get(pluginName);
      const metadata = plugin.getMetadata();
      console.log(chalk.green(`  • ${metadata.name}`) + chalk.gray(` - ${metadata.description}`));
    });
    
    console.log();
  }

  /**
   * Run the CLI
   */
  run() {
    this.program.parse(process.argv);
  }
}

module.exports = CLI;
