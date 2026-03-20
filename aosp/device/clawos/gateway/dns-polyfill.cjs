// DNS polyfill for Android devices where /etc/resolv.conf is unavailable.
// c-ares (used by dns.resolve) falls back to 127.0.0.1:53 which doesn't work
// on Android. This polyfill reads our custom resolv.conf and sets DNS servers
// via dns.setServers() so that both dns.lookup (libc) and dns.resolve (c-ares)
// work correctly.

const fs = require('fs');
const dns = require('dns');

const RESOLV_PATHS = [
  '/etc/resolv.conf',
  '/data/local/tmp/clawos/net/resolv.conf',
  '/product/etc/clawos/resolv.conf',
];

function parseNameservers(content) {
  return content
    .split('\n')
    .filter(line => line.trim().startsWith('nameserver'))
    .map(line => line.trim().split(/\s+/)[1])
    .filter(Boolean);
}

let configured = false;
for (const p of RESOLV_PATHS) {
  try {
    if (fs.existsSync(p)) {
      if (p === '/etc/resolv.conf') {
        configured = true;
        break;
      }
      const servers = parseNameservers(fs.readFileSync(p, 'utf8'));
      if (servers.length > 0) {
        dns.setServers(servers);
        configured = true;
        break;
      }
    }
  } catch { /* ignore */ }
}

if (!configured) {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  } catch { /* ignore */ }
}
