// Local dev-only HTTP proxy that forwards requests to an upstream LLM endpoint.
// Run manually with: `node scripts/dev-http-proxy.js`
// The API key is loaded from the environment; never hard-code credentials here.

const http = require('http');
const https = require('https');

const PORT = process.env.PROXY_PORT ? Number(process.env.PROXY_PORT) : 8010;
const TARGET_HOST =
  process.env.PROXY_TARGET_HOST ?? 'llm.satsandsports.cash';
const API_KEY = process.env.PROXY_API_KEY;

if (!API_KEY) {
  console.error(
    'PROXY_API_KEY is not set. Export it before starting the proxy, e.g.\n' +
      '  PROXY_API_KEY=sk-... node scripts/dev-http-proxy.js'
  );
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = `https://${TARGET_HOST}${req.url}`;
  
  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      'Host': TARGET_HOST,
      'Authorization': `Bearer ${API_KEY}`
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err);
    res.writeHead(502);
    res.end('Proxy error: ' + err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Forwarding to https://${TARGET_HOST}`);
});
