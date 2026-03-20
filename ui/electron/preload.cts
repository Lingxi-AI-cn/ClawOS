const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  mtime: number;
  permissions: string;
}

interface SystemInfo {
  hostname: string;
  platform: string;
  kernel: string;
  arch: string;
  cpuUsage: number;
  cpuModel: string;
  cpuCores: number;
  memTotal: number;
  memUsed: number;
  uptime: number;
  ip: string;
  netRxBytes: number;
  netTxBytes: number;
}

function getSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // CPU usage: average across cores (idle ratio)
  let cpuUsage = 0;
  try {
    const loadavg = os.loadavg();
    cpuUsage = Math.min(100, (loadavg[0] / cpus.length) * 100);
  } catch {
    cpuUsage = 0;
  }

  // Get kernel version
  let kernel = os.release();
  try {
    kernel = execSync('uname -r', { encoding: 'utf-8' }).trim();
  } catch { /* use os.release() */ }

  // Get platform name
  let platform = os.type();
  try {
    const pretty = execSync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME', { encoding: 'utf-8' });
    const match = pretty.match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (match) platform = match[1];
  } catch { /* use os.type() */ }

  // Get IP address
  let ip = '127.0.0.1';
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ip = iface.address;
        break;
      }
    }
    if (ip !== '127.0.0.1') break;
  }

  // Read network bytes from /proc/net/dev (Linux)
  let netRxBytes = 0;
  let netTxBytes = 0;
  try {
    const procNet = fs.readFileSync('/proc/net/dev', 'utf-8');
    for (const line of procNet.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('lo:') || !trimmed.includes(':')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 10) {
        netRxBytes += parseInt(parts[1], 10) || 0;
        netTxBytes += parseInt(parts[9], 10) || 0;
      }
    }
  } catch { /* non-Linux */ }

  return {
    hostname: os.hostname(),
    platform,
    kernel,
    arch: os.arch(),
    cpuUsage: Math.round(cpuUsage * 10) / 10,
    cpuModel: cpus[0]?.model || 'Unknown',
    cpuCores: cpus.length,
    memTotal: totalMem,
    memUsed: totalMem - freeMem,
    uptime: os.uptime(),
    ip,
    netRxBytes,
    netTxBytes,
  };
}

function listDirectory(dirPath: string): { path: string; entries: FileEntry[] } {
  const resolved = path.resolve(dirPath);
  const names = fs.readdirSync(resolved);
  const entries: FileEntry[] = [];

  for (const name of names) {
    // Skip hidden files starting with .
    if (name.startsWith('.')) continue;

    try {
      const fullPath = path.join(resolved, name);
      const stat = fs.lstatSync(fullPath);
      let type: FileEntry['type'] = 'other';
      if (stat.isDirectory()) type = 'directory';
      else if (stat.isFile()) type = 'file';
      else if (stat.isSymbolicLink()) type = 'symlink';

      const mode = stat.mode;
      const perms =
        ((mode & 0o400) ? 'r' : '-') +
        ((mode & 0o200) ? 'w' : '-') +
        ((mode & 0o100) ? 'x' : '-') +
        ((mode & 0o040) ? 'r' : '-') +
        ((mode & 0o020) ? 'w' : '-') +
        ((mode & 0o010) ? 'x' : '-') +
        ((mode & 0o004) ? 'r' : '-') +
        ((mode & 0o002) ? 'w' : '-') +
        ((mode & 0o001) ? 'x' : '-');

      entries.push({
        name,
        type,
        size: stat.size,
        mtime: stat.mtimeMs,
        permissions: perms,
      });
    } catch {
      // Skip entries we can't stat
    }
  }

  // Sort: directories first, then files, alphabetical within each group
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return { path: resolved, entries };
}

const { ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clawos', {
  quit: () => ipcRenderer.send('app-quit'),
  readConfig: (): string | null => {
    try {
      const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      return fs.readFileSync(configPath, 'utf-8');
    } catch {
      return null;
    }
  },
  getSystemInfo: (): SystemInfo => getSystemInfo(),
  listDirectory: (dirPath: string): { path: string; entries: FileEntry[] } => listDirectory(dirPath),
  platform: process.platform,
  isElectron: true,
});
