// backend/utils/onlyoffice_proxy.js
// Высокопроизводительный обратный прокси для ONLYOFFICE Docs
// Позволяет работать онлайн-редактору через один порт (включая туннели, HTTPS и обратные прокси без проброса порта 28083)

const http = require('http');
const net = require('net');
const url = require('url');

function getOnlyofficeTarget() {
  const targetStr = process.env.ONLYOFFICE_INTERNAL_URL ||
                    (process.env.DOCKER_ENV ? 'http://docflow_onlyoffice:80' : 'http://docflow_onlyoffice:80');
  try {
    return new url.URL(targetStr);
  } catch (e) {
    return new url.URL('http://docflow_onlyoffice:80');
  }
}

// Fallback host list to try if docker hostname fails
const TARGET_HOSTS = [
  { host: process.env.ONLYOFFICE_INTERNAL_HOST || 'docflow_onlyoffice', port: parseInt(process.env.ONLYOFFICE_INTERNAL_PORT || '80', 10) },
  { host: 'onlyoffice', port: 80 },
  { host: '127.0.0.1', port: 28083 },
  { host: 'localhost', port: 28083 }
];

let cachedWorkingTarget = null;
let lastTargetCheck = 0;

async function resolveWorkingTarget() {
  const now = Date.now();
  if (cachedWorkingTarget && (now - lastTargetCheck < 30000)) {
    return cachedWorkingTarget;
  }

  for (const t of TARGET_HOSTS) {
    const isUp = await testTarget(t.host, t.port, 1500);
    if (isUp) {
      cachedWorkingTarget = t;
      lastTargetCheck = now;
      return t;
    }
  }

  // Default fallback
  return TARGET_HOSTS[0];
}

function testTarget(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(timeoutMs);
    s.on('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => {
      s.destroy();
      resolve(false);
    });
    s.on('timeout', () => {
      s.destroy();
      resolve(false);
    });
    s.connect(port, host);
  });
}

function isBlockedOnlyofficePath(subPath) {
  const cleanPath = String(subPath || '').split('?')[0].toLowerCase();
  return (
    cleanPath.includes('commandservice.ashx') ||
    cleanPath.includes('convertservice.ashx') ||
    cleanPath === '/info' ||
    cleanPath.startsWith('/info/')
  );
}

function stripCrlf(value) {
  return String(value || '').replace(/[\r\n]/g, '');
}

// Express HTTP Proxy Middleware
async function onlyofficeProxyMiddleware(req, res, next) {
  if (!req.url.startsWith('/onlyoffice')) {
    return next();
  }

  const subPath = req.url.replace(/^\/onlyoffice/, '') || '/';
  if (isBlockedOnlyofficePath(subPath)) {
    return res.status(403).json({ error: 'Внешний доступ к сервисным эндпоинтам ONLYOFFICE запрещён' });
  }

  const target = await resolveWorkingTarget();

  const clientProto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const clientHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';

  const proxyHeaders = {
    ...req.headers,
    host: `${target.host}:${target.port}`,
    'x-forwarded-for': req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${req.socket.remoteAddress}` : req.socket.remoteAddress,
    'x-forwarded-host': clientHost,
    'x-forwarded-proto': clientProto,
    'x-forwarded-prefix': '/onlyoffice'
  };

  const proxyReq = http.request({
    hostname: target.host,
    port: target.port,
    path: subPath,
    method: req.method,
    headers: proxyHeaders,
    timeout: 30000
  }, (proxyRes) => {
    const outHeaders = { ...proxyRes.headers };
    if (typeof outHeaders.location === 'string' && outHeaders.location.startsWith('/') && !outHeaders.location.startsWith('/onlyoffice/')) {
      outHeaders.location = `/onlyoffice${outHeaders.location}`;
    }
    res.writeHead(proxyRes.statusCode, outHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[ONLYOFFICE Proxy] Error forwarding to ${target.host}:${target.port}${subPath}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Сервер ONLYOFFICE Docs временно недоступен',
        target: `${target.host}:${target.port}`,
        details: err.message
      });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Таймаут обращения к ONLYOFFICE Docs' });
    }
  });

  // Pipe request body if any
  if (req.body && Object.keys(req.body).length > 0 && !req.readableEnded) {
    const bodyData = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    proxyReq.write(bodyData);
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

// WebSocket Upgrade Handler
async function handleWebSocketUpgrade(req, clientSocket, head) {
  if (!req.url.startsWith('/onlyoffice')) {
    return;
  }

  const rawSubPath = req.url.replace(/^\/onlyoffice/, '') || '/';
  const subPath = stripCrlf(rawSubPath);
  if (isBlockedOnlyofficePath(subPath)) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const target = await resolveWorkingTarget();
  const clientProto = stripCrlf(req.headers['x-forwarded-proto'] || 'http');
  const clientHost = stripCrlf(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');

  const targetSocket = net.connect(target.port, target.host, () => {
    // Reconstruct HTTP upgrade request to ONLYOFFICE
    let upgradeReq = `${stripCrlf(req.method)} ${subPath} HTTP/1.1\r\n`;
    const lowerKeys = new Set();
    for (const [k, v] of Object.entries(req.headers)) {
      const safeK = stripCrlf(k);
      const lk = safeK.toLowerCase();
      lowerKeys.add(lk);
      if (lk === 'host') {
        upgradeReq += `host: ${target.host}:${target.port}\r\n`;
      } else {
        upgradeReq += `${safeK}: ${stripCrlf(Array.isArray(v) ? v.join(', ') : v)}\r\n`;
      }
    }
    if (!lowerKeys.has('x-forwarded-host')) upgradeReq += `x-forwarded-host: ${clientHost}\r\n`;
    if (!lowerKeys.has('x-forwarded-proto')) upgradeReq += `x-forwarded-proto: ${clientProto}\r\n`;
    if (!lowerKeys.has('x-forwarded-prefix')) upgradeReq += `x-forwarded-prefix: /onlyoffice\r\n`;
    upgradeReq += '\r\n';

    targetSocket.write(upgradeReq);
    if (head && head.length > 0) {
      targetSocket.write(head);
    }

    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  targetSocket.on('error', (err) => {
    console.error('[ONLYOFFICE WS Proxy] Error:', err.message);
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    targetSocket.destroy();
  });
}

// Healthcheck Function
async function checkOnlyofficeHealth() {
  const startTime = Date.now();
  const target = await resolveWorkingTarget();

  return new Promise((resolve) => {
    const req = http.request({
      hostname: target.host,
      port: target.port,
      path: '/healthcheck',
      method: 'GET',
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const latencyMs = Date.now() - startTime;
        const isOk = res.statusCode === 200 && data.trim() === 'true';
        resolve({
          ok: isOk,
          status: isOk ? 'healthy' : 'degraded',
          httpStatus: res.statusCode,
          response: data.trim(),
          targetHost: `${target.host}:${target.port}`,
          latencyMs,
          proxyPath: '/onlyoffice',
          tunnelCompatible: true,
          directPort: 28083
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        status: 'unreachable',
        error: err.message,
        targetHost: `${target.host}:${target.port}`,
        latencyMs: Date.now() - startTime,
        proxyPath: '/onlyoffice',
        tunnelCompatible: true,
        troubleshooting: [
          'Убедитесь, что контейнер docflow_onlyoffice запущен (docker ps)',
          'Проверьте доступность порта 28083 на хосте или http://docflow_onlyoffice в docker сети',
          'При работе через туннель используйте встроенный прокси /onlyoffice без проброса отдельного порта'
        ]
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        status: 'timeout',
        error: 'Превышено время ожидания ответа от ONLYOFFICE',
        targetHost: `${target.host}:${target.port}`
      });
    });

    req.end();
  });
}

module.exports = {
  onlyofficeProxyMiddleware,
  handleWebSocketUpgrade,
  checkOnlyofficeHealth,
  resolveWorkingTarget
};
