/** Two origins on port 3000, plus a proxy for /api to the Next.js app. Not a person's site. */
import http from 'node:http';

const upstream = process.env.SAUTI_E2E_WEB || 'http://127.0.0.1:3010';

function page(title, marker) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font:20px sans-serif}#spacer{height:1800px}</style></head><body>
<h1 id="marker">${marker}</h1>
<p>${title} is a local test page. It is not a recording and not a personal story.</p>
<div id="spacer"></div>
<p id="end">End of ${title}</p>
</body></html>`;
}

const alpha = page('Alpha site', 'ALPHA-SITE');
const beta = page('Beta site', 'BETA-SITE');

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers, host: new URL(upstream).host };
      delete headers.origin;
      delete headers.cookie;
      const forwarded = http.request(upstream + req.url, { method: req.method, headers }, (proxied) => {
        res.writeHead(proxied.statusCode || 502, proxied.headers);
        proxied.pipe(res);
      });
      forwarded.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end('proxy failed');
      });
      forwarded.end(body);
    });
    return;
  }
  const host = String(req.headers.host || '');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(host.startsWith('localhost') ? beta : alpha);
});

server.listen(3000, '127.0.0.1', () => {
  console.log('listening');
});
