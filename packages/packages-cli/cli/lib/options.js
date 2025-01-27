const fs = require('fs')
const cloneDeep = require('lodash.clonedeep')
const { getRcPath } = require('./util/rcPath')
const { exit } = require('../../cli-shared-utils/lib/exit')
const { error } = require('../../cli-shared-utils/lib/logger')
const { createSchema, validate } = require('../../cli-shared-utils/lib/validate')

const rcPath = exports.rcPath = getRcPath('.vuerc')

const presetSchema = createSchema(joi => joi.object().keys({
  bare: joi.boolean(),
  useConfigFiles: joi.boolean(),
  // TODO: Use warn for router and vuex once @hapi/joi v16 releases
  router: joi.boolean(),
  routerHistoryMode: joi.boolean(),
  vuex: joi.boolean(),
  cssPreprocessor: joi.string().only(['sass', 'dart-sass', 'node-sass', 'less', 'stylus']),
  plugins: joi.object().required(),
  configs: joi.object()
}))

const schema = createSchema(joi => joi.object().keys({
  latestVersion: joi.string().regex(/^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/),
  lastChecked: joi.date().timestamp(),
  packageManager: joi.string().only(['yarn', 'npm', 'pnpm']),
  useTaobaoRegistry: joi.boolean(),
  presets: joi.object().pattern(/^/, presetSchema)
}))

exports.validatePreset = preset => validate(preset, presetSchema, msg => {
  error(`invalid preset options: ${msg}`)
})

exports.defaultPreset = {
  useConfigFiles: false,
  cssPreprocessor: undefined,
  plugins: {
    '@vue/cli-plugin-babel': {},
    '@vue/cli-plugin-eslint': {
      config: 'base',
      lintOn: ['save']
    }
  }
}

exports.defaults = {
  lastChecked: undefined,
  latestVersion: undefined,

  packageManager: undefined,
  useTaobaoRegistry: undefined,
  presets: {
    default: exports.defaultPreset
  }
}

let cachedOptions

exports.loadOptions = () => {
  if (cachedOptions) {
    return cachedOptions
  }
  if (fs.existsSync(rcPath)) {
    try {
      cachedOptions = JSON.parse(fs.readFileSync(rcPath, 'utf-8'))
    } catch (e) {
      error(
        'Error loading saved preferences: ' +
        '~/.vuerc may be corrupted or have syntax errors. ' +
        'Please fix/delete it and re-run vue-cli in manual mode.\n' +
        `(${e.message})`
      )
      exit(1)
    }
    validate(cachedOptions, schema, () => {
      error(
        '~/.vuerc may be outdated. ' +
        'Please delete it and re-run vue-cli in manual mode.'
      )
    })
    return cachedOptions
  } else {
    return {}
  }
}

exports.saveOptions = toSave => {
  const options = Object.assign(cloneDeep(exports.loadOptions()), toSave)
  for (const key in options) {
    if (!(key in exports.defaults)) {
      delete options[key]
    }
  }
  cachedOptions = options
  try {
    fs.writeFileSync(rcPath, JSON.stringify(options, null, 2))
  } catch (e) {
    error(
      'Error saving preferences: ' +
      `make sure you have write access to ${rcPath}.\n` +
      `(${e.message})`
    )
  }
}

exports.savePreset = (name, preset) => {
  const presets = cloneDeep(exports.loadOptions().presets || {})
  presets[name] = preset
  exports.saveOptions({ presets })
}
