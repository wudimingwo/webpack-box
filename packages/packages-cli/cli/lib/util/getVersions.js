const { semver } = require('../../../cli-shared-utils')
const PackageManager = require('./ProjectPackageManager')
const { loadOptions, saveOptions } = require('../options')

let sessionCached
const pm = new PackageManager()

module.exports = async function getVersions () {
  if (sessionCached) {
    return sessionCached
  }

  let latest
  const local = require('../../../package.json').version
  if (process.env.VUE_CLI_TEST || process.env.VUE_CLI_DEBUG) {
    return (sessionCached = {
      current: local,
      latest: local
    })
  }

  // should also check for prerelease versions if the current one is a prerelease
  const includePrerelease = !!semver.prerelease(local)

  const { latestVersion = local, lastChecked = 0 } = loadOptions()
  const cached = latestVersion
  const daysPassed = (Date.now() - lastChecked) / (60 * 60 * 1000 * 24)

  let error
  if (daysPassed > 1) {
    // if we haven't check for a new version in a day, wait for the check
    // before proceeding
    try {
      latest = await getAndCacheLatestVersion(cached, includePrerelease)
    } catch (e) {
      latest = cached
      error = e
    }
  } else {
    // Otherwise, do a check in the background. If the result was updated,
    // it will be used for the next 24 hours.
    // don't throw to interrupt the user if the background check failed
    getAndCacheLatestVersion(cached, includePrerelease).catch(() => {})
    latest = cached
  }

  return (sessionCached = {
    current: local,
    latest,
    error
  })
}

async function getAndCacheLatestVersion (cached, includePrerelease) {
  let version = await pm.getRemoteVersion('@jijiang/packages-box', 'latest')
  if (includePrerelease) {
    const next = await pm.getRemoteVersion('@jijiang/packages-box', 'next')
    version = semver.gt(next, version) ? next : version
  }

  if (semver.valid(version) && version !== cached) {
    saveOptions({ latestVersion: version, lastChecked: Date.now() })
    return version
  }
  return cached
}
