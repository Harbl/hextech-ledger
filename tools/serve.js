// Minimal static server for local testing. No dependencies.
//   node tools/serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

// The relay fetches Riot's page, and Node decompresses Brotli responses on its
// own -- the path Node2Shell (CVE-2026-111497) exploits. Refuse to run on a Node
// without the 2026-10-21 security release, which fixed it and nine other CVEs.
// Odd-numbered lines are short-lived and get no backports.
{
  const [maj, min, pat] = process.versions.node.split('.').map(Number);
  const fixed = { 22: [23, 4], 24: [22, 1], 26: [12, 1] }[maj];
  const ok = maj > 26 ? maj % 2 === 0 : fixed && (min > fixed[0] || (min === fixed[0] && pat >= fixed[1]));
  if (!ok) {
    console.error(`\n  Node.js ${process.version} has known security holes (incl. Node2Shell).`);
    console.error('  Use the portable package (it brings its own Node.js), or update Node.js from https://nodejs.org (LTS).\n');
    process.exit(1);
  }
}

const ROOT = path.join(__dirname, '..');
const PORT = +process.argv[2] || 8080;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

http.createServer(async (req, res) => {
  // Relay a public Riot event page; the browser can't fetch it itself (no CORS).
  const ev = /^\/riot\/events\/(\d+)$/.exec(req.url);
  if (ev) {
    try {
      const up = await fetch(`https://playriftbound.com/en-US/events/${ev[1]}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Hextech Ledger)' } });
      res.writeHead(up.status, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(await up.text());
    } catch { res.writeHead(502).end('playriftbound.com unreachable'); }
    return;
  }

  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);

  // Don't serve anything outside the project directory.
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('Forbidden'); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + rel); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
// Loopback only -- this runs on shop wifi and nothing off the machine needs it.
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Hextech Ledger running at  http://localhost:${PORT}\n`);
  console.log('  Signup import relays the public playriftbound.com event page.');
  console.log('  Press Ctrl+C to stop.\n');
});
