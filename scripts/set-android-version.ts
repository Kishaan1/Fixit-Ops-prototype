/**
 * Syncs the Android app version from package.json into android/app/build.gradle.
 *
 * package.json is the single source of truth (semver). versionCode is derived
 * monotonically as major*1_000_000 + minor*1_000 + patch so every patch release
 * installs cleanly over the previous one.
 *
 * Run:  npx tsx scripts/set-android-version.ts   (after `npx cap add android`)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version: string }
const version = pkg.version
const parts = version.split('.').map((p) => Number.parseInt(p, 10))

if (parts.length !== 3 || parts.some((n) => Number.isNaN(n) || n < 0)) {
  throw new Error(`package.json version "${version}" is not valid semver (major.minor.patch).`)
}

const [major, minor, patch] = parts
const versionCode = major * 1_000_000 + minor * 1_000 + patch
if (versionCode > 2_100_000_000) {
  throw new Error(`versionCode ${versionCode} exceeds the Android limit (2 100 000 000).`)
}

const gradleFile = path.resolve('android/app/build.gradle')
const gradle = readFileSync(gradleFile, 'utf8')

if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+"[^"]+"/.test(gradle)) {
  throw new Error('android/app/build.gradle does not contain versionCode/versionName — has the template changed?')
}

const updated = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`)

writeFileSync(gradleFile, updated)
console.log(`[android-version] ${version} → versionName "${version}", versionCode ${versionCode}`)
