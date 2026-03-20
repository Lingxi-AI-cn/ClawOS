#!/product/bin/node
// ClawOS OTA Gateway Update Script
//
// Modes:
//   --check   : query npm registry, compare with installed version, output JSON
//   --apply   : download + stage new bundle for next restart
//   --rollback: restore gateway.bak if available
//   --version : print installed version
//
// Output: always JSON to stdout for machine parsing.
// Zero external dependencies — uses only Node.js built-in modules.

import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import dns from 'node:dns'
import { pipeline } from 'node:stream/promises'

// Android DNS fix: Node.js http(s).get() lookup option doesn't work reliably
// on Android (untrusted_app SELinux domain). Instead, manually resolve
// hostnames via c-ares (dns.promises.Resolver) and connect to IPs directly
// with proper Host header and TLS servername.
const dnsServers = (() => {
  const resolvPaths = ['/etc/resolv.conf', '/data/local/tmp/clawos/net/resolv.conf']
  for (const p of resolvPaths) {
    try {
      const content = fs.readFileSync(p, 'utf8')
      const ns = content.match(/^nameserver\s+(\S+)/gm)
      if (ns?.length) return ns.map(l => l.split(/\s+/)[1])
    } catch { /* skip */ }
  }
  return ['8.8.8.8', '1.1.1.1']
})()
try { dns.setServers(dnsServers) } catch { /* best-effort */ }

const { Resolver } = dns.promises
const resolver = new Resolver()
try { resolver.setServers(dnsServers) } catch { /* best-effort */ }

const dnsCache = new Map()
async function resolveHost(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname
  if (dnsCache.has(hostname)) return dnsCache.get(hostname)
  try {
    const addrs = await resolver.resolve4(hostname)
    if (addrs?.length) { dnsCache.set(hostname, addrs[0]); return addrs[0] }
  } catch { /* try fallback */ }
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { family: 4 }, (err, addr) => {
      if (!err && addr) { dnsCache.set(hostname, addr); resolve(addr) }
      else reject(err || new Error(`Cannot resolve ${hostname}`))
    })
  })
}

const BASE_DIR = '/data/local/tmp/clawos'
const GATEWAY_DIR = path.join(BASE_DIR, 'gateway')
const GATEWAY_BAK = path.join(BASE_DIR, 'gateway.bak')
const OTA_PENDING = process.env.OTA_PENDING_DIR || path.join(BASE_DIR, 'ota-pending')
const VERSION_FILE = path.join(GATEWAY_DIR, '.version')

const NPM_REGISTRY = 'https://registry.npmjs.org'
const PACKAGE_NAME = 'openclaw'

function output(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function readVersion(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split('\n')[0].trim()
  } catch {
    return null
  }
}

function parseNodeVersion(ver) {
  const [major = 0, minor = 0] = ver.split('.').map(Number)
  return { major, minor }
}

function checkNodeCompat(extractedDir) {
  const mjsPath = path.join(extractedDir, 'openclaw.mjs')
  if (!fs.existsSync(mjsPath)) return null
  const src = fs.readFileSync(mjsPath, 'utf8')
  const majorMatch = src.match(/MIN_NODE_MAJOR\s*=\s*(\d+)/)
  const minorMatch = src.match(/MIN_NODE_MINOR\s*=\s*(\d+)/)
  if (!majorMatch) return null
  const reqMajor = Number(majorMatch[1])
  const reqMinor = minorMatch ? Number(minorMatch[1]) : 0
  const cur = parseNodeVersion(process.versions.node)
  const compatible = cur.major > reqMajor ||
    (cur.major === reqMajor && cur.minor >= reqMinor)
  return { required: `${reqMajor}.${reqMinor}`, current: process.versions.node, compatible }
}

async function httpGet(url) {
  const parsed = new URL(url)
  const ip = await resolveHost(parsed.hostname)
  const mod = parsed.protocol === 'https:' ? https : http
  const opts = {
    hostname: ip,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers: { 'Accept': 'application/json', 'Host': parsed.hostname },
    ...(parsed.protocol === 'https:' ? { servername: parsed.hostname } : {}),
  }
  return new Promise((resolve, reject) => {
    mod.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve, reject)
      }
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    }).on('error', reject)
  })
}

async function downloadBuffer(url) {
  const parsed = new URL(url)
  const ip = await resolveHost(parsed.hostname)
  const mod = parsed.protocol === 'https:' ? https : http
  const opts = {
    hostname: ip,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers: { 'Host': parsed.hostname },
    ...(parsed.protocol === 'https:' ? { servername: parsed.hostname } : {}),
  }
  return new Promise((resolve, reject) => {
    mod.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// Pure-JS tar extraction (POSIX/UStar format)
// Handles the npm tarball structure: package/<files>
function extractTarGz(tgzBuffer, destDir, stripPrefix = '') {
  const tarBuffer = zlib.gunzipSync(tgzBuffer)
  let offset = 0

  while (offset < tarBuffer.length) {
    // Each tar entry = 512-byte header + ceil(size/512)*512 data
    if (offset + 512 > tarBuffer.length) break

    const header = tarBuffer.subarray(offset, offset + 512)
    // Check for empty block (end of archive)
    if (header.every(b => b === 0)) break

    const nameRaw = header.subarray(0, 100).toString('utf8').replace(/\0/g, '')
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0/g, '').trim()
    const typeFlag = header[156]
    // UStar prefix field (bytes 345-500)
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0/g, '')

    let entryName = prefix ? prefix + '/' + nameRaw : nameRaw
    const size = parseInt(sizeOctal, 8) || 0

    offset += 512

    // Strip prefix (e.g. "package/")
    if (stripPrefix && entryName.startsWith(stripPrefix)) {
      entryName = entryName.slice(stripPrefix.length)
    }

    if (!entryName || entryName === '.' || entryName === './') {
      offset += Math.ceil(size / 512) * 512
      continue
    }

    const fullPath = path.join(destDir, entryName)

    // Security: prevent path traversal
    if (!fullPath.startsWith(destDir)) {
      offset += Math.ceil(size / 512) * 512
      continue
    }

    if (typeFlag === 53 || entryName.endsWith('/')) {
      // Directory
      fs.mkdirSync(fullPath, { recursive: true })
    } else if (typeFlag === 0 || typeFlag === 48) {
      // Regular file
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      const data = tarBuffer.subarray(offset, offset + size)
      fs.writeFileSync(fullPath, data)
    }
    // Skip symlinks and other types

    offset += Math.ceil(size / 512) * 512
  }
}

// Repackage a directory into .tar.gz using pure JS.
// `items` can be directory names (recursed) or file names (added as-is).
function createTarGz(srcDir, items) {
  const entries = []

  function addDir(dirPath, archivePath) {
    if (!fs.existsSync(dirPath)) return
    const children = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const child of children) {
      const childPath = path.join(dirPath, child.name)
      const childArchive = archivePath + '/' + child.name
      if (child.isDirectory()) {
        addDir(childPath, childArchive)
      } else if (child.isFile()) {
        const data = fs.readFileSync(childPath)
        entries.push({ name: childArchive, data })
      }
    }
  }

  for (const item of items) {
    const itemPath = path.join(srcDir, item)
    if (!fs.existsSync(itemPath)) continue
    if (fs.statSync(itemPath).isDirectory()) {
      addDir(itemPath, item)
    } else {
      entries.push({ name: item, data: fs.readFileSync(itemPath) })
    }
  }

  // Build tar buffer
  const blocks = []
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const header = Buffer.alloc(512, 0)

    // Name (0-100) — split into prefix + name if > 100 chars
    if (nameBytes.length <= 100) {
      nameBytes.copy(header, 0)
    } else {
      const lastSlash = entry.name.lastIndexOf('/', 155)
      if (lastSlash > 0) {
        Buffer.from(entry.name.slice(lastSlash + 1), 'utf8').copy(header, 0)
        Buffer.from(entry.name.slice(0, lastSlash), 'utf8').copy(header, 345)
      } else {
        nameBytes.subarray(0, 100).copy(header, 0)
      }
    }

    // Mode (100-108)
    Buffer.from('0000644\0', 'ascii').copy(header, 100)
    // UID (108-116)
    Buffer.from('0001000\0', 'ascii').copy(header, 108)
    // GID (116-124)
    Buffer.from('0001000\0', 'ascii').copy(header, 116)
    // Size (124-136)
    Buffer.from(entry.data.length.toString(8).padStart(11, '0') + '\0', 'ascii').copy(header, 124)
    // Mtime (136-148)
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')
    Buffer.from(mtime + '\0', 'ascii').copy(header, 136)
    // Type flag (156) = '0' (regular file)
    header[156] = 48
    // Magic (257-263) = "ustar\0"
    Buffer.from('ustar\0', 'ascii').copy(header, 257)
    // Version (263-265) = "00"
    Buffer.from('00', 'ascii').copy(header, 263)

    // Checksum (148-156): sum of all header bytes with checksum field as spaces
    Buffer.from('        ', 'ascii').copy(header, 148)
    let cksum = 0
    for (let i = 0; i < 512; i++) cksum += header[i]
    Buffer.from(cksum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(header, 148)

    blocks.push(header)
    blocks.push(entry.data)
    // Pad to 512-byte boundary
    const remainder = entry.data.length % 512
    if (remainder > 0) {
      blocks.push(Buffer.alloc(512 - remainder, 0))
    }
  }

  // End-of-archive: two empty 512-byte blocks
  blocks.push(Buffer.alloc(1024, 0))

  return zlib.gzipSync(Buffer.concat(blocks))
}

async function fetchPackageInfo(packageName) {
  const encoded = packageName.replace('/', '%2F')
  const res = await httpGet(`${NPM_REGISTRY}/${encoded}/latest`)
  if (res.status !== 200) throw new Error(`npm registry: ${packageName} returned ${res.status}`)
  return JSON.parse(res.body)
}

async function installNpmPackage(name, nodeModulesDir, visited) {
  if (visited.has(name)) return 0
  visited.add(name)

  const pkgDir = name.startsWith('@')
    ? path.join(nodeModulesDir, ...name.split('/'))
    : path.join(nodeModulesDir, name)

  if (fs.existsSync(pkgDir)) return 0

  let pkg
  try { pkg = await fetchPackageInfo(name) }
  catch { return 0 }

  const tarball = pkg.dist?.tarball
  if (!tarball) return 0

  let buf
  try { buf = await downloadBuffer(tarball) }
  catch { return 0 }

  fs.mkdirSync(pkgDir, { recursive: true })
  try { extractTarGz(buf, pkgDir, 'package/') }
  catch { return 0 }

  let count = 1
  const subDeps = pkg.dependencies || {}
  for (const dep of Object.keys(subDeps)) {
    count += await installNpmPackage(dep, nodeModulesDir, visited)
  }
  return count
}

async function installMissingDeps(packageDir, nodeModulesDir) {
  const pkgPath = path.join(packageDir, 'package.json')
  if (!fs.existsSync(pkgPath)) return 0
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = pkg.dependencies || {}
  const visited = new Set()
  let total = 0

  for (const name of Object.keys(deps)) {
    const depDir = name.startsWith('@')
      ? path.join(nodeModulesDir, ...name.split('/'))
      : path.join(nodeModulesDir, name)

    if (!fs.existsSync(depDir)) {
      output({ progress: 'installing_dep', name })
      total += await installNpmPackage(name, nodeModulesDir, visited)
    }
  }
  return total
}

async function fetchLatestInfo() {
  const res = await httpGet(`${NPM_REGISTRY}/${PACKAGE_NAME}/latest`)
  if (res.status !== 200) {
    throw new Error(`npm registry returned ${res.status}`)
  }
  const pkg = JSON.parse(res.body)
  return {
    version: pkg.version,
    tarball: pkg.dist?.tarball,
    shasum: pkg.dist?.shasum,
    integrity: pkg.dist?.integrity,
  }
}

async function cmdCheck() {
  const installed = readVersion(VERSION_FILE)
  try {
    const latest = await fetchLatestInfo()
    const updateAvailable = installed !== latest.version
    output({
      installed: installed || 'unknown',
      latest: latest.version,
      updateAvailable,
      nodeVersion: process.versions.node,
    })
  } catch (e) {
    output({
      installed: installed || 'unknown',
      latest: null,
      updateAvailable: false,
      error: e.message,
      nodeVersion: process.versions.node,
    })
    process.exit(1)
  }
}

async function cmdApply() {
  const installed = readVersion(VERSION_FILE)
  let latest
  try {
    latest = await fetchLatestInfo()
  } catch (e) {
    output({ success: false, error: 'registry_fetch_failed', message: e.message })
    process.exit(1)
  }

  if (installed === latest.version) {
    output({ success: true, message: 'already_up_to_date', version: installed })
    return
  }

  // Prepare staging directory
  fs.rmSync(OTA_PENDING, { recursive: true, force: true })
  fs.mkdirSync(OTA_PENDING, { recursive: true })

  const bundlePath = path.join(OTA_PENDING, 'gateway-bundle.tar.gz')

  // Download npm tarball into memory
  let tgzBuffer
  try {
    output({ progress: 'downloading', version: latest.version })
    tgzBuffer = await downloadBuffer(latest.tarball)
  } catch (e) {
    fs.rmSync(OTA_PENDING, { recursive: true, force: true })
    output({ success: false, error: 'download_failed', message: e.message })
    process.exit(1)
  }

  // Verify shasum of the npm tarball
  if (latest.shasum) {
    const actual = crypto.createHash('sha1').update(tgzBuffer).digest('hex')
    if (actual !== latest.shasum) {
      fs.rmSync(OTA_PENDING, { recursive: true, force: true })
      output({ success: false, error: 'integrity_check_failed', expected: latest.shasum, actual })
      process.exit(1)
    }
  }

  // Extract npm tarball (contains package/ prefix)
  const extractDir = path.join(OTA_PENDING, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    output({ progress: 'extracting' })
    extractTarGz(tgzBuffer, extractDir, 'package/')
  } catch (e) {
    fs.rmSync(OTA_PENDING, { recursive: true, force: true })
    output({ success: false, error: 'extract_failed', message: e.message })
    process.exit(1)
  }

  // Validate: entry.js must exist
  if (!fs.existsSync(path.join(extractDir, 'dist', 'entry.js'))) {
    fs.rmSync(OTA_PENDING, { recursive: true, force: true })
    output({ success: false, error: 'invalid_package', message: 'dist/entry.js not found in npm package' })
    process.exit(1)
  }

  // Node.js version compatibility check
  const compat = checkNodeCompat(extractDir)
  if (compat && !compat.compatible) {
    fs.rmSync(OTA_PENDING, { recursive: true, force: true })
    output({
      success: false,
      error: 'node_version_incompatible',
      message: `Gateway ${latest.version} requires Node.js >= ${compat.required}, current: v${compat.current}`,
      requiredNode: compat.required,
      currentNode: compat.current,
    })
    process.exit(1)
  }

  // npm tarballs don't include node_modules/. Try to carry forward the current
  // installation's node_modules. If this fails (e.g., DAC permissions when
  // running as app user), start-gateway.sh handles it during deployment.
  let nmCopied = false
  const currentNM = path.join(GATEWAY_DIR, 'node_modules')
  const extractNM = path.join(extractDir, 'node_modules')
  if (fs.existsSync(currentNM) && !fs.existsSync(extractNM)) {
    try {
      output({ progress: 'copying_node_modules' })
      fs.cpSync(currentNM, extractNM, { recursive: true })
      nmCopied = true
    } catch (e) {
      output({ progress: 'skipping_node_modules', reason: e.message })
    }
  } else if (fs.existsSync(extractNM)) {
    nmCopied = true
  }

  if (nmCopied) {
    try {
      const installed = await installMissingDeps(extractDir, extractNM)
      if (installed > 0) {
        output({ progress: 'deps_installed', count: installed })
      }
    } catch (e) {
      output({ progress: 'deps_warning', message: e.message })
    }
  }

  // Repackage into gateway-bundle.tar.gz with all items.
  const skipItems = new Set(['.', '..', 'package.json'])
  const bundleItems = fs.readdirSync(extractDir)
    .filter(item => !skipItems.has(item) && !item.startsWith('.'))

  try {
    output({ progress: 'repackaging' })
    const bundleBuffer = createTarGz(extractDir, bundleItems)
    fs.writeFileSync(bundlePath, bundleBuffer)
  } catch (e) {
    fs.rmSync(OTA_PENDING, { recursive: true, force: true })
    output({ success: false, error: 'repackage_failed', message: e.message })
    process.exit(1)
  }

  // Write version and shasum for start-gateway.sh to verify
  fs.writeFileSync(path.join(OTA_PENDING, '.version'), latest.version + '\n')
  const bundleHash = crypto.createHash('sha1').update(fs.readFileSync(bundlePath)).digest('hex')
  fs.writeFileSync(path.join(OTA_PENDING, '.shasum'), bundleHash + '\n')

  // Clean up intermediates
  fs.rmSync(extractDir, { recursive: true, force: true })

  // start-gateway.sh runs as user=shell; make staged files world-writable
  // so that shell user can clean them up after deployment
  try {
    fs.chmodSync(OTA_PENDING, 0o777)
    for (const f of fs.readdirSync(OTA_PENDING)) {
      fs.chmodSync(path.join(OTA_PENDING, f), 0o666)
    }
  } catch { /* best-effort */ }

  output({
    success: true,
    message: 'staged',
    oldVersion: installed || 'unknown',
    newVersion: latest.version,
    note: 'Restart Gateway to apply the update',
  })
}

async function cmdRollback() {
  if (!fs.existsSync(GATEWAY_BAK) || !fs.existsSync(path.join(GATEWAY_BAK, 'dist', 'entry.js'))) {
    output({ success: false, error: 'no_backup', message: 'No backup version available' })
    process.exit(1)
  }

  const currentVer = readVersion(VERSION_FILE)
  const backupVer = readVersion(path.join(GATEWAY_BAK, '.version'))

  fs.rmSync(GATEWAY_DIR, { recursive: true, force: true })
  fs.renameSync(GATEWAY_BAK, GATEWAY_DIR)

  output({
    success: true,
    message: 'rolled_back',
    oldVersion: currentVer || 'unknown',
    restoredVersion: backupVer || 'unknown',
    note: 'Restart Gateway to apply',
  })
}

async function cmdVersion() {
  const installed = readVersion(VERSION_FILE)
  const romVer = readVersion('/product/etc/clawos/gateway-version.txt')
  const hasBackup = fs.existsSync(path.join(GATEWAY_BAK, 'dist', 'entry.js'))
  const backupVer = hasBackup ? readVersion(path.join(GATEWAY_BAK, '.version')) : null
  const hasPending = fs.existsSync(path.join(OTA_PENDING, '.version'))
  const pendingVer = hasPending ? readVersion(path.join(OTA_PENDING, '.version')) : null

  output({
    installed: installed || 'unknown',
    rom: romVer || 'unknown',
    backup: backupVer,
    pending: pendingVer,
  })
}

async function cmdFixDeps() {
  const nmDir = path.join(GATEWAY_DIR, 'node_modules')
  if (!fs.existsSync(nmDir)) {
    fs.mkdirSync(nmDir, { recursive: true })
  }

  // Read the entry point to discover imported packages, then check package.json
  // files inside dist/ for dependency declarations
  const distDir = path.join(GATEWAY_DIR, 'dist')
  const deps = new Set()

  // Scan dist/*.js for bare module imports (import ... from "@scope/pkg" or "pkg")
  if (fs.existsSync(distDir)) {
    for (const f of fs.readdirSync(distDir)) {
      if (!f.endsWith('.js')) continue
      try {
        const src = fs.readFileSync(path.join(distDir, f), 'utf8')
        const matches = src.matchAll(/from\s+["'](@[^/"']+\/[^/"']+|[^./"'][^/"']*)/g)
        for (const m of matches) {
          const pkg = m[1]
          if (!pkg.startsWith('node:') && !pkg.startsWith('$') && !pkg.includes('{') && !/\d{6,}/.test(pkg)) deps.add(pkg)
        }
      } catch { /* skip */ }
    }
  }

  // Filter to packages not already installed
  const missing = []
  for (const name of deps) {
    const depDir = name.startsWith('@')
      ? path.join(nmDir, ...name.split('/'))
      : path.join(nmDir, name)
    if (!fs.existsSync(depDir)) missing.push(name)
  }

  if (missing.length === 0) {
    output({ success: true, message: 'all_deps_present', count: deps.size })
    return
  }

  output({ progress: 'installing_missing', packages: missing })
  const visited = new Set()
  let total = 0
  for (const name of missing) {
    output({ progress: 'installing_dep', name })
    total += await installNpmPackage(name, nmDir, visited)
  }

  output({ success: true, message: 'deps_fixed', installed: total, checked: missing.length })
}

const mode = process.argv[2]
switch (mode) {
  case '--check':
    cmdCheck().catch(e => { output({ error: e.message }); process.exit(1) })
    break
  case '--apply':
    cmdApply().catch(e => { output({ success: false, error: 'unexpected', message: e.message }); process.exit(1) })
    break
  case '--rollback':
    cmdRollback().catch(e => { output({ success: false, error: 'unexpected', message: e.message }); process.exit(1) })
    break
  case '--version':
    cmdVersion().catch(e => { output({ error: e.message }); process.exit(1) })
    break
  case '--fix-deps':
    cmdFixDeps().catch(e => { output({ success: false, error: 'unexpected', message: e.message }); process.exit(1) })
    break
  default:
    output({ error: 'usage', message: 'Usage: ota-update.mjs --check|--apply|--rollback|--version|--fix-deps' })
    process.exit(1)
}
