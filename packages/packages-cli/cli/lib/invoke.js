const fs = require('fs-extra')
const path = require('path')
const inquirer = require('inquirer')
const {
  chalk,
  execa,
  log,
  error,
  logWithSpinner,
  stopSpinner,
  hasProjectGit,
  resolvePluginId,
  loadModule
} = require('../../cli-shared-utils')

const Generator = require('./Generator')

const confirmIfGitDirty = require('./util/confirmIfGitDirty')
const readFiles = require('./util/readFiles')
const PackageManager = require('./util/ProjectPackageManager')

function getPkg (context) {
  const pkgPath = path.resolve(context, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${chalk.yellow(context)}`)
  }
  const pkg = fs.readJsonSync(pkgPath)
  if (pkg.vuePlugins && pkg.vuePlugins.resolveFrom) {
    return getPkg(path.resolve(context, pkg.vuePlugins.resolveFrom))
  }
  return pkg
}

async function invoke (pluginName, options = {}, context = process.cwd()) {
  if (!(await confirmIfGitDirty(context))) {
    return
  }

  delete options._
  const pkg = getPkg(context)

  const findPlugin = deps => {
    if (!deps) return
    let name
    if (deps[(name = `box-cli-plugin-${pluginName}`)]) {
      return name
    }
    if (deps[(name = `@vue/cli-plugin-${pluginName}`)]) {
      return name
    }
    if (deps[(name = resolvePluginId(pluginName))]) {
      return name
    }
  }

  const id = findPlugin(pkg.devDependencies) || findPlugin(pkg.dependencies)

  if (!id) {
    throw new Error(
      `Cannot resolve plugin ${chalk.yellow(pluginName)} from package.json. ` +
        'Did you forget to install it?'
    )
  }

  const pluginGenerator = loadModule(`${id}/generator`, context)
  if (!pluginGenerator) {
    throw new Error(`Plugin ${id} does not have a generator.`)
  }

  // resolve options if no command line options (other than --registry) are passed,
  // and the plugin contains a prompt module.
  // eslint-disable-next-line prefer-const
  let { registry, $inlineOptions, ...pluginOptions } = options
  if ($inlineOptions) {
    try {
      pluginOptions = JSON.parse($inlineOptions)
    } catch (e) {
      throw new Error(`Couldn't parse inline options JSON: ${e.message}`)
    }
  } else if (!Object.keys(pluginOptions).length) {
    let pluginPrompts = loadModule(`${id}/prompts`, context)
    if (pluginPrompts) {
      if (typeof pluginPrompts === 'function') {
        pluginPrompts = pluginPrompts(pkg)
      }
      if (typeof pluginPrompts.getPrompts === 'function') {
        pluginPrompts = pluginPrompts.getPrompts(pkg)
      }
      pluginOptions = await inquirer.prompt(pluginPrompts)
    }
  }

  const plugin = {
    id,
    apply: pluginGenerator,
    options: {
      registry,
      ...pluginOptions
    }
  }

  await runGenerator(context, plugin, pkg)
}

async function runGenerator (context, plugin, pkg = getPkg(context)) {
  const isTestOrDebug = process.env.VUE_CLI_TEST || process.env.VUE_CLI_DEBUG
  const afterInvokeCbs = []
  const afterAnyInvokeCbs = []

  const generator = new Generator(context, {
    pkg,
    plugins: [plugin],
    files: await readFiles(context),
    afterInvokeCbs,
    afterAnyInvokeCbs,
    invoking: true
  })

  log()
  log(`🚀  Invoking generator for ${plugin.id}...`)
  await generator.generate({
    extractConfigFiles: true,
    checkExisting: true
  })

  const newDeps = generator.pkg.dependencies
  const newDevDeps = generator.pkg.devDependencies
  const depsChanged =
    JSON.stringify(newDeps) !== JSON.stringify(pkg.dependencies) ||
    JSON.stringify(newDevDeps) !== JSON.stringify(pkg.devDependencies)

  if (!isTestOrDebug && depsChanged) {
    log('📦  Installing additional dependencies...')
    log()
    const pm = new PackageManager({ context })
    await pm.install()
  }

  if (afterInvokeCbs.length || afterAnyInvokeCbs.length) {
    logWithSpinner('⚓', 'Running completion hooks...')
    for (const cb of afterInvokeCbs) {
      await cb()
    }
    for (const cb of afterAnyInvokeCbs) {
      await cb()
    }
    stopSpinner()
    log()
  }

  log(`${chalk.green('✔')}  Successfully invoked generator for plugin: ${chalk.cyan(plugin.id)}`)
  if (!process.env.VUE_CLI_TEST && hasProjectGit(context)) {
    const { stdout } = await execa('git', [
      'ls-files',
      '--exclude-standard',
      '--modified',
      '--others'
    ], {
      cwd: context
    })
    if (stdout.trim()) {
      log('   The following files have been updated / added:\n')
      log(
        chalk.red(
          stdout
            .split(/\r?\n/g)
            .map(line => `     ${line}`)
            .join('\n')
        )
      )
      log()
      log(
        `   You should review these changes with ${chalk.cyan(
          'git diff'
        )} and commit them.`
      )
      log()
    }
  }

  generator.printExitLogs()
}

module.exports = (...args) => {
  return invoke(...args).catch(err => {
    error(err)
    if (!process.env.VUE_CLI_TEST) {
      process.exit(1)
    }
  })
}

module.exports.runGenerator = runGenerator
