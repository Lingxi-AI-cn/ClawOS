#!/system/bin/node
/**
 * ClawOS Gateway - Placeholder
 *
 * This file will be replaced by the bundled OpenClaw Gateway code.
 * For now, it starts a minimal WebSocket server on port 18789
 * that responds to health checks.
 */

const http = require('http');

const PORT = 18789;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'clawos-gateway',
      version: '0.1.0-placeholder',
      platform: 'android',
      uptime: process.uptime(),
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ClawOS Gateway] Listening on ws://127.0.0.1:${PORT}`);
  console.log(`[ClawOS Gateway] Node.js ${process.version} on ${process.platform}/${process.arch}`);
});

// Handle signals gracefully
process.on('SIGTERM', () => {
  console.log('[ClawOS Gateway] Received SIGTERM, shutting down...');
  server.close(() => process.exit(0));
});
