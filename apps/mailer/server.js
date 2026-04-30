const http = require('http');
const fs = require('fs');
const path = require('path');

const adminBetaCodesHandler = require('./api/admin-beta-codes');
const adminSessionHandler = require('./api/admin-session');
const adminUsersHandler = require('./api/admin-users');
const healthHandler = require('./api/health');
const issueBetaCodeHandler = require('./api/issue-beta-code');
const sendReminderHandler = require('./api/send-reminder');

const PORT = Number(process.env.PORT || 8787);

const routes = new Map([
  ['/api/admin/beta-codes', adminBetaCodesHandler],
  ['/api/admin/session', adminSessionHandler],
  ['/api/admin/users', adminUsersHandler],
  ['/api/health', healthHandler],
  ['/api/issue-beta-code', issueBetaCodeHandler],
  ['/api/send-reminder', sendReminderHandler]
]);

function loadLocalEnv() {
  const files = ['.env.local', '.env.beta.local', '.env'];
  for (const file of files) {
    try {
      fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;
          const index = trimmed.indexOf('=');
          if (index <= 0) return;
          const key = trimmed.slice(0, index).trim();
          const value = trimmed.slice(index + 1).trim();
          if (key && process.env[key] === undefined) {
            process.env[key] = value;
          }
        });
    } catch {
      // Production installs can provide env vars through launchd, PM2, or shell.
    }
  }
}

function createResponseAdapter(res) {
  return {
    setHeader: (name, value) => res.setHeader(name, value),
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(payload) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
    },
    end(payload) {
      res.end(payload);
    }
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  function serveHtml(filename) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none';"
    );
    res.end(fs.readFileSync(path.join(__dirname, filename), 'utf8'));
  }

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    serveHtml('admin.html');
    return;
  }

  if (url.pathname === '/admin/dashboard' || url.pathname === '/admin/dashboard/') {
    serveHtml('admin-dashboard.html');
    return;
  }

  if (url.pathname === '/admin-logo.png' || url.pathname === '/favicon.png') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(fs.readFileSync(path.join(__dirname, 'admin-logo.png')));
    return;
  }

  if (url.pathname === '/admin-logo.svg' || url.pathname === '/favicon.svg') {
    res.statusCode = 301;
    res.setHeader('Location', '/admin-logo.png');
    res.end();
    return;
  }

  const handler = routes.get(url.pathname);

  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Not found.' }));
    return;
  }

  try {
    req.query = Object.fromEntries(url.searchParams.entries());
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      req.body = await readJsonBody(req);
    }
    await handler(req, createResponseAdapter(res));
  } catch (error) {
    res.statusCode = error.statusCode || 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

loadLocalEnv();

http.createServer(handleRequest).listen(PORT, '127.0.0.1', () => {
  console.log(`Crush LeetCode official mailer listening on http://127.0.0.1:${PORT}`);
});
