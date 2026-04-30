const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const WEEKLY_EMAIL_CARD_LIMIT = 3;
const WEEKLY_PAYLOAD_LIMIT_BYTES = 30000;
const DEFAULT_BETA_CODE_TTL_DAYS = 180;
const ADMIN_SESSION_COOKIE = 'crush_admin_session';
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
const RATE_LIMITS = {
  mailer: { windowMs: 60 * 1000, max: 30 },
  adminAuth: { windowMs: 5 * 60 * 1000, max: 10 },
  adminApi: { windowMs: 60 * 1000, max: 120 }
};

let betaDb;
const rateLimitBuckets = new Map();

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Crush-Secret, X-Admin-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handleOptions(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function requirePost(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return false;
  }
  return true;
}

function clientIp(req) {
  const forwardedFor = Array.isArray(req.headers['x-forwarded-for'])
    ? req.headers['x-forwarded-for'][0]
    : req.headers['x-forwarded-for'];
  if (forwardedFor && typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0].trim() || 'unknown';
  }
  const cfConnectingIp = Array.isArray(req.headers['cf-connecting-ip'])
    ? req.headers['cf-connecting-ip'][0]
    : req.headers['cf-connecting-ip'];
  if (cfConnectingIp && typeof cfConnectingIp === 'string') {
    return cfConnectingIp.trim() || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
}

function rateLimitConfig(scope) {
  const config = RATE_LIMITS[scope];
  if (!config) {
    throw new Error(`Unknown rate limit scope: ${scope}`);
  }
  return config;
}

function pruneRateLimitBuckets(now = Date.now()) {
  if (rateLimitBuckets.size < 1000) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function checkRateLimit(req, res, scope) {
  const config = rateLimitConfig(scope);
  const now = Date.now();
  pruneRateLimitBuckets(now);

  const key = `${scope}:${clientIp(req)}`;
  const current = rateLimitBuckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + config.windowMs };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  const remaining = Math.max(0, config.max - bucket.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader('X-RateLimit-Limit', String(config.max));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > config.max) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      ok: false,
      error: 'Too many requests. Please retry later.'
    });
    return false;
  }

  return true;
}

function requireSecret(req, res) {
  const expected = process.env.REMINDER_SHARED_SECRET;
  const provided = Array.isArray(req.headers['x-crush-secret'])
    ? req.headers['x-crush-secret'][0]
    : req.headers['x-crush-secret'];

  if (!expected) {
    res.status(500).json({ ok: false, error: 'Server configuration missing (REMINDER_SHARED_SECRET).' });
    return false;
  }

  if (!provided || typeof provided !== 'string') {
    res.status(401).json({ ok: false, error: 'Missing mailer secret.' });
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    res.status(401).json({ ok: false, error: 'Invalid mailer secret.' });
    return false;
  }

  return true;
}

function safeEqualString(expected, provided) {
  if (!expected || !provided || typeof expected !== 'string' || typeof provided !== 'string') {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function parseCookies(req) {
  const raw = Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie;
  if (!raw || typeof raw !== 'string') {
    return {};
  }

  return Object.fromEntries(raw.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) {
      return [part.trim(), ''];
    }
    let value = part.slice(index + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      value = '';
    }
    return [
      part.slice(0, index).trim(),
      value
    ];
  }).filter(([key]) => key));
}

function adminUsername() {
  return process.env.BETA_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin';
}

function adminPassword() {
  return process.env.BETA_ADMIN_PASSWORD || process.env.BETA_ADMIN_SECRET;
}

function adminSessionSecret() {
  return process.env.BETA_ADMIN_SESSION_SECRET || process.env.BETA_ADMIN_SECRET;
}

function adminSessionSignature(encodedPayload) {
  const secret = adminSessionSecret();
  if (!secret) {
    throw new Error('Server configuration missing (BETA_ADMIN_SECRET).');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function createAdminSessionToken(username) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    type: 'crush-mailer-admin',
    username,
    iat: now,
    exp: now + ADMIN_SESSION_TTL_SECONDS
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${adminSessionSignature(encodedPayload)}`;
}

function verifyAdminSessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'Missing admin session.' };
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: 'Invalid admin session.' };
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = adminSessionSignature(encodedPayload);
  if (!safeEqualString(expectedSignature, providedSignature)) {
    return { ok: false, error: 'Invalid admin session.' };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return { ok: false, error: 'Invalid admin session payload.' };
  }

  if (payload?.type !== 'crush-mailer-admin') {
    return { ok: false, error: 'Invalid admin session type.' };
  }

  if (payload?.username !== adminUsername()) {
    return { ok: false, error: 'Invalid admin user.' };
  }

  if (!Number.isFinite(payload?.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, error: 'Admin session expired.' };
  }

  return { ok: true, payload };
}

function getAdminSession(req) {
  const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
  return verifyAdminSessionToken(token);
}

function isSecureCookieRequest(req) {
  const host = String(req.headers.host || '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '');
  return forwardedProto === 'https' ||
    (!host.startsWith('127.0.0.1') && !host.startsWith('localhost'));
}

function createAdminSessionCookie(username, req) {
  const token = createAdminSessionToken(username);
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`
  ];
  if (isSecureCookieRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function clearAdminSessionCookie(req) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (isSecureCookieRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function verifyAdminCredentials(username, password) {
  const expectedUsername = adminUsername();
  const expectedPassword = adminPassword();
  if (!expectedPassword) {
    return { ok: false, error: 'Server configuration missing (BETA_ADMIN_PASSWORD or BETA_ADMIN_SECRET).' };
  }

  if (!safeEqualString(expectedUsername, String(username || '').trim())) {
    return { ok: false, error: 'Invalid username or password.' };
  }

  if (!safeEqualString(expectedPassword, String(password || ''))) {
    return { ok: false, error: 'Invalid username or password.' };
  }

  return { ok: true, username: expectedUsername };
}

function requireAdminSecret(req, res) {
  const session = getAdminSession(req);
  if (session.ok) {
    return true;
  }

  const expected = process.env.BETA_ADMIN_SECRET;
  const provided = Array.isArray(req.headers['x-admin-secret'])
    ? req.headers['x-admin-secret'][0]
    : req.headers['x-admin-secret'];

  if (!expected) {
    res.status(500).json({ ok: false, error: 'Server configuration missing (BETA_ADMIN_SECRET).' });
    return false;
  }

  if (!provided || typeof provided !== 'string') {
    res.status(401).json({ ok: false, error: 'Missing admin credentials.' });
    return false;
  }

  if (!safeEqualString(expected, provided)) {
    res.status(401).json({ ok: false, error: 'Invalid admin credentials.' });
    return false;
  }

  return true;
}

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isWeeklySummaryPayload(body) {
  return Number.isFinite(body?.totalProblems) &&
    Number.isFinite(body?.dueCount) &&
    Number.isFinite(body?.overdueCount) &&
    Number.isFinite(body?.reviewedProblemsThisWeekCount) &&
    Number.isFinite(body?.acceptedProblemsThisWeekCount) &&
    Array.isArray(body?.dailyReviewPoints);
}

function validatePayload(body) {
  const errors = [];

  if (!isEmail(body?.recipientEmail)) {
    errors.push('recipientEmail must be a valid email.');
  }
  
  // Strict size check to prevent large payload attacks
  if (JSON.stringify(body || {}).length > WEEKLY_PAYLOAD_LIMIT_BYTES) {
    errors.push('Payload too large.');
    return errors;
  }

  if (isWeeklySummaryPayload(body)) {
    return errors;
  }

  if (typeof body?.problemTitle !== 'string' || body.problemTitle.trim().length === 0) {
    errors.push('problemTitle is required.');
  }
  if (typeof body?.problemUrl !== 'string' || !/^https?:\/\//.test(body.problemUrl)) {
    errors.push('problemUrl must be a valid URL.');
  }

  return errors;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function betaSigningSecret() {
  return process.env.BETA_CODE_SIGNING_SECRET;
}

function normalizeBetaCode(code) {
  return typeof code === 'string' ? code.replace(/\s+/g, '') : '';
}

function betaCodeHash(code) {
  const secret = betaSigningSecret();
  if (!secret) {
    throw new Error('Server configuration missing (BETA_CODE_SIGNING_SECRET).');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(normalizeBetaCode(code))
    .digest('hex');
}

function betaDbPath() {
  return process.env.BETA_DB_PATH || path.join(process.cwd(), '.data', 'mailer.sqlite');
}

function getBetaDb() {
  if (betaDb) {
    return betaDb;
  }

  const { DatabaseSync } = require('node:sqlite');
  const dbPath = betaDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  betaDb = new DatabaseSync(dbPath);
  betaDb.exec(`
    CREATE TABLE IF NOT EXISTS official_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      github_username TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_official_users_status
      ON official_users(status);
    CREATE TABLE IF NOT EXISTS beta_access_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      code_hash TEXT NOT NULL UNIQUE,
      recipient_email TEXT NOT NULL,
      github_username TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_beta_access_codes_recipient_email
      ON beta_access_codes(recipient_email);
    CREATE INDEX IF NOT EXISTS idx_beta_access_codes_expires_at
      ON beta_access_codes(expires_at);
  `);
  ensureBetaDbMigrations(betaDb);
  return betaDb;
}

function betaDbHasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function rowToOfficialUser(row) {
  return row ? {
    id: row.id,
    email: row.email,
    githubUsername: row.github_username || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at || undefined
  } : undefined;
}

function upsertOfficialUser(input, db = getBetaDb()) {
  const email = normalizeEmail(input.recipientEmail || input.email);
  if (!isEmail(email)) {
    throw new Error('recipientEmail must be a valid email.');
  }

  const githubUsername = input.githubUsername ? String(input.githubUsername).trim() : undefined;
  const now = new Date().toISOString();
  const existing = db.prepare(`
    SELECT id, email, github_username, status, created_at, updated_at, last_seen_at
    FROM official_users
    WHERE email = ?
  `).get(email);

  if (existing) {
    if (githubUsername && githubUsername !== existing.github_username) {
      db.prepare(`
        UPDATE official_users
        SET github_username = ?, updated_at = ?
        WHERE id = ?
      `).run(githubUsername, now, existing.id);
    }

    return rowToOfficialUser(db.prepare(`
      SELECT id, email, github_username, status, created_at, updated_at, last_seen_at
      FROM official_users
      WHERE id = ?
    `).get(existing.id));
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO official_users (
      id,
      email,
      github_username,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?)
  `).run(id, email, githubUsername || null, now, now);

  return rowToOfficialUser(db.prepare(`
    SELECT id, email, github_username, status, created_at, updated_at, last_seen_at
    FROM official_users
    WHERE id = ?
  `).get(id));
}

function ensureBetaDbMigrations(db) {
  if (!betaDbHasColumn(db, 'beta_access_codes', 'user_id')) {
    db.exec(`
      ALTER TABLE beta_access_codes ADD COLUMN user_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_beta_access_codes_user_id
        ON beta_access_codes(user_id);
    `);
  }

  const orphanCodes = db.prepare(`
    SELECT id, recipient_email, github_username
    FROM beta_access_codes
    WHERE user_id IS NULL OR user_id = ''
  `).all();

  for (const code of orphanCodes) {
    const user = upsertOfficialUser({
      recipientEmail: code.recipient_email,
      githubUsername: code.github_username
    }, db);
    db.prepare(`
      UPDATE beta_access_codes
      SET user_id = ?
      WHERE id = ?
    `).run(user.id, code.id);
  }
}

function signBetaPayload(encodedPayload) {
  const secret = betaSigningSecret();
  if (!secret) {
    throw new Error('Server configuration missing (BETA_CODE_SIGNING_SECRET).');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function issueLegacySignedBetaCode(input) {
  const now = new Date();
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(now.getTime() + 1000 * 60 * 60 * 24 * DEFAULT_BETA_CODE_TTL_DAYS);

  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error('expiresAt must be a future date.');
  }

  const payload = {
    type: 'official-digest-beta',
    recipientEmail: String(input.recipientEmail).trim().toLowerCase(),
    githubUsername: input.githubUsername ? String(input.githubUsername).trim() : undefined,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return {
    code: `${encodedPayload}.${signBetaPayload(encodedPayload)}`,
    payload
  };
}

function issueBetaCode(input) {
  const now = new Date();
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(now.getTime() + 1000 * 60 * 60 * 24 * DEFAULT_BETA_CODE_TTL_DAYS);

  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error('expiresAt must be a future date.');
  }

  const recipientEmail = normalizeEmail(input.recipientEmail);
  const githubUsername = input.githubUsername ? String(input.githubUsername).trim() : undefined;
  const user = upsertOfficialUser({ recipientEmail, githubUsername });
  const code = `clcb_${crypto.randomBytes(32).toString('base64url')}`;
  const payload = {
    id: crypto.randomUUID(),
    userId: user.id,
    type: 'official-digest-beta',
    recipientEmail,
    githubUsername,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  getBetaDb().prepare(`
    INSERT INTO beta_access_codes (
      id,
      user_id,
      code_hash,
      recipient_email,
      github_username,
      issued_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.id,
    user.id,
    betaCodeHash(code),
    recipientEmail,
    githubUsername || null,
    payload.issuedAt,
    payload.expiresAt
  );

  return { code, payload };
}

function betaCodeStatus(row, now = Date.now()) {
  if (row.revoked_at) {
    return 'revoked';
  }

  const expiresAt = new Date(row.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    return 'expired';
  }

  return 'active';
}

function listBetaCodes(options = {}) {
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
  const rows = getBetaDb().prepare(`
    SELECT
      b.id,
      b.user_id,
      b.recipient_email,
      COALESCE(u.github_username, b.github_username) AS github_username,
      u.status AS user_status,
      b.issued_at,
      b.expires_at,
      b.revoked_at,
      b.last_used_at,
      b.usage_count
    FROM beta_access_codes b
    LEFT JOIN official_users u ON u.id = b.user_id
    ORDER BY b.issued_at DESC
    LIMIT ?
  `).all(limit);

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id || undefined,
    recipientEmail: row.recipient_email,
    githubUsername: row.github_username || undefined,
    userStatus: row.user_status || 'active',
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || undefined,
    lastUsedAt: row.last_used_at || undefined,
    usageCount: Number(row.usage_count || 0),
    status: betaCodeStatus(row, now)
  }));
}

function listOfficialUsers(options = {}) {
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
  const now = new Date().toISOString();
  const rows = getBetaDb().prepare(`
    SELECT
      u.id,
      u.email,
      u.github_username,
      u.status,
      u.created_at,
      u.updated_at,
      u.last_seen_at,
      COUNT(b.id) AS code_count,
      COALESCE(SUM(CASE WHEN b.id IS NOT NULL AND b.revoked_at IS NULL AND b.expires_at > ? THEN 1 ELSE 0 END), 0) AS active_code_count,
      COALESCE(SUM(CASE WHEN b.revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS revoked_code_count,
      COALESCE(SUM(b.usage_count), 0) AS total_usage_count,
      MAX(b.last_used_at) AS latest_code_used_at
    FROM official_users u
    LEFT JOIN beta_access_codes b ON b.user_id = u.id
    GROUP BY
      u.id,
      u.email,
      u.github_username,
      u.status,
      u.created_at,
      u.updated_at,
      u.last_seen_at
    ORDER BY u.created_at DESC
    LIMIT ?
  `).all(now, limit);

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    githubUsername: row.github_username || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at || undefined,
    codeCount: Number(row.code_count || 0),
    activeCodeCount: Number(row.active_code_count || 0),
    revokedCodeCount: Number(row.revoked_code_count || 0),
    totalUsageCount: Number(row.total_usage_count || 0),
    latestCodeUsedAt: row.latest_code_used_at || undefined
  }));
}

function setOfficialUserStatus(idOrEmail, status) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!['active', 'suspended'].includes(normalizedStatus)) {
    throw new Error('status must be active or suspended.');
  }

  const identifier = String(idOrEmail || '').trim();
  if (!identifier) {
    throw new Error('id or email is required.');
  }

  const now = new Date().toISOString();
  const db = getBetaDb();
  const result = db.prepare(`
    UPDATE official_users
    SET status = ?, updated_at = ?
    WHERE id = ? OR email = ?
  `).run(normalizedStatus, now, identifier, normalizeEmail(identifier));

  if (result.changes < 1) {
    return { ok: false };
  }

  return {
    ok: true,
    user: rowToOfficialUser(db.prepare(`
      SELECT id, email, github_username, status, created_at, updated_at, last_seen_at
      FROM official_users
      WHERE id = ? OR email = ?
    `).get(identifier, normalizeEmail(identifier)))
  };
}

function revokeBetaCode(id) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) {
    throw new Error('id is required.');
  }

  const revokedAt = new Date().toISOString();
  const result = getBetaDb().prepare(`
    UPDATE beta_access_codes
    SET revoked_at = COALESCE(revoked_at, ?)
    WHERE id = ?
  `).run(revokedAt, normalizedId);

  return {
    ok: result.changes > 0,
    revokedAt
  };
}

function verifyLegacySignedBetaCode(code, recipientEmail) {
  const normalizedCode = normalizeBetaCode(code);
  if (!normalizedCode || !normalizedCode.includes('.')) {
    return { ok: false, error: 'Invalid beta access code format.' };
  }

  const parts = normalizedCode.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'Invalid beta access code format.' };
  }

  const [encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) {
    return { ok: false, error: 'Invalid beta access code format.' };
  }

  const expectedSignature = signBetaPayload(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return { ok: false, error: 'Invalid beta access code.' };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (error) {
    return { ok: false, error: 'Invalid beta access code payload.' };
  }

  if (payload?.type !== 'official-digest-beta') {
    return { ok: false, error: 'Invalid beta access code type.' };
  }

  const expectedRecipient = String(payload.recipientEmail || '').trim().toLowerCase();
  const actualRecipient = String(recipientEmail || '').trim().toLowerCase();
  if (!expectedRecipient || expectedRecipient !== actualRecipient) {
    return { ok: false, error: 'Beta access code does not match recipient email.' };
  }

  const expiresAt = new Date(payload.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: 'Beta access code has expired.' };
  }

  return { ok: true, payload };
}

function verifyStoredBetaCode(code, recipientEmail) {
  const normalizedCode = normalizeBetaCode(code);
  if (!normalizedCode) {
    return { ok: false, error: 'Invalid beta access code format.' };
  }

  const row = getBetaDb().prepare(`
    SELECT
      b.id,
      b.user_id,
      b.recipient_email,
      COALESCE(u.github_username, b.github_username) AS github_username,
      u.status AS user_status,
      b.issued_at,
      b.expires_at,
      b.revoked_at,
      b.usage_count
    FROM beta_access_codes b
    LEFT JOIN official_users u ON u.id = b.user_id
    WHERE b.code_hash = ?
  `).get(betaCodeHash(normalizedCode));

  if (!row) {
    return { ok: false, error: 'Invalid beta access code.' };
  }

  const expectedRecipient = String(row.recipient_email || '').trim().toLowerCase();
  const actualRecipient = String(recipientEmail || '').trim().toLowerCase();
  if (!expectedRecipient || expectedRecipient !== actualRecipient) {
    return { ok: false, error: 'Beta access code does not match recipient email.' };
  }

  if (row.revoked_at) {
    return { ok: false, error: 'Beta access code has been revoked.' };
  }

  if (row.user_status === 'suspended') {
    return { ok: false, error: 'Official digest beta user is suspended.' };
  }

  const expiresAt = new Date(row.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: 'Beta access code has expired.' };
  }

  const usedAt = new Date().toISOString();
  getBetaDb().prepare(`
    UPDATE beta_access_codes
    SET last_used_at = ?, usage_count = usage_count + 1
    WHERE id = ?
  `).run(usedAt, row.id);

  if (row.user_id) {
    getBetaDb().prepare(`
      UPDATE official_users
      SET last_seen_at = ?, updated_at = ?
      WHERE id = ?
    `).run(usedAt, usedAt, row.user_id);
  }

  return {
    ok: true,
    payload: {
      id: row.id,
      userId: row.user_id || undefined,
      type: 'official-digest-beta',
      recipientEmail: expectedRecipient,
      githubUsername: row.github_username || undefined,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      usageCount: Number(row.usage_count || 0) + 1,
      lastUsedAt: usedAt
    }
  };
}

function verifyBetaCode(code, recipientEmail) {
  const storedResult = verifyStoredBetaCode(code, recipientEmail);
  if (storedResult.ok) {
    return storedResult;
  }

  const normalizedCode = normalizeBetaCode(code);
  if (normalizedCode.includes('.')) {
    return verifyLegacySignedBetaCode(normalizedCode, recipientEmail);
  }

  return storedResult;
}

function betaCodeLogContext(body) {
  const normalizedCode = typeof body?.betaAccessCode === 'string'
    ? normalizeBetaCode(body.betaAccessCode)
    : '';
  return {
    recipientEmail: typeof body?.recipientEmail === 'string' ? body.recipientEmail.trim().toLowerCase() : undefined,
    eventId: typeof body?.eventId === 'string' ? body.eventId : undefined,
    codeLength: normalizedCode.length,
    codeParts: normalizedCode ? normalizedCode.split('.').length : 0,
    codeFingerprint: normalizedCode
      ? crypto.createHash('sha256').update(normalizedCode).digest('hex').slice(0, 12)
      : undefined
  };
}

function requireBetaAccess(body, res) {
  if (!isWeeklySummaryPayload(body)) {
    return true;
  }

  if (!body?.betaAccessCode || typeof body.betaAccessCode !== 'string') {
    console.warn('[BetaAccess] Missing beta access code.', betaCodeLogContext(body));
    res.status(403).json({ ok: false, error: 'Official digest beta access code is required.' });
    return false;
  }

  try {
    const result = verifyBetaCode(body.betaAccessCode, body.recipientEmail);
    if (!result.ok) {
      console.warn('[BetaAccess] Rejected beta access code.', {
        ...betaCodeLogContext(body),
        reason: result.error
      });
      res.status(403).json({ ok: false, error: result.error });
      return false;
    }
    console.info('[BetaAccess] Accepted beta access code.', betaCodeLogContext(body));
  } catch (error) {
    console.error('[BetaAccess] Failed to validate beta access code.', {
      ...betaCodeLogContext(body),
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    return false;
  }

  return true;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatPercent(value) {
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100)));
}

function problemUrlForLocale(titleSlug, locale) {
  const host = locale === 'zh-CN' ? 'https://leetcode.cn' : 'https://leetcode.com';
  return `${host}/problems/${encodeURIComponent(String(titleSlug || ''))}/`;
}

function displayProblemTitle(problem, locale) {
  if (locale === 'zh-CN') {
    return problem?.titleZh || problem?.title || problem?.titleSlug || 'Unknown problem';
  }
  return problem?.title || problem?.titleZh || problem?.titleSlug || 'Unknown problem';
}

function labelForDifficulty(difficulty, locale) {
  if (locale !== 'zh-CN') {
    return difficulty || 'Unknown';
  }
  return {
    Easy: '简单',
    Medium: '中等',
    Hard: '困难',
    Unknown: '未知'
  }[difficulty] || '未知';
}

function difficultyColor(difficulty) {
  return {
    Easy: '#059669',
    Medium: '#d97706',
    Hard: '#dc2626',
    Unknown: '#737373'
  }[difficulty] || '#737373';
}

function labelForMastery(tier, locale) {
  const labels = {
    new: locale === 'zh-CN' ? '新题' : 'New',
    familiar: locale === 'zh-CN' ? '熟悉' : 'Familiar',
    proficient: locale === 'zh-CN' ? '熟练' : 'Proficient',
    mastered: locale === 'zh-CN' ? '掌握' : 'Mastered'
  };
  return labels[tier] || labels.new;
}

function renderWeeklyChart(points, locale) {
  const safePoints = safeArray(points);
  const maxCount = Math.max(1, ...safePoints.map((point) => Number(point.reviewCount) || 0));
  const total = safePoints.reduce((sum, point) => sum + (Number(point.reviewCount) || 0), 0);
  const activeDays = safePoints.filter((point) => (Number(point.reviewCount) || 0) > 0).length;
  const totalLabel = locale === 'zh-CN' ? `${total} 次复习` : `${total} reviews`;
  const activeLabel = locale === 'zh-CN' ? `${activeDays}/7 天有练习` : `${activeDays}/7 active days`;

  return `
    <div style="margin-top:14px;border-radius:20px;background:linear-gradient(180deg,#fff7ed,#ffffff);border:1px solid #fed7aa;padding:16px;">
      <div style="display:flex;align-items:flex-end;gap:8px;height:136px;margin:4px 0 10px;">
        ${safePoints
          .map((point) => {
            const reviewCount = Number(point.reviewCount) || 0;
            const height = Math.max(10, Math.round((reviewCount / maxCount) * 112));
            const opacity = reviewCount > 0 ? 1 : 0.42;
            return `
              <div style="flex:1;min-width:0;text-align:center;">
                <div style="height:112px;display:flex;align-items:flex-end;justify-content:center;">
                  <div style="width:100%;max-width:34px;height:${height}px;border-radius:999px;background:${reviewCount > 0 ? 'linear-gradient(180deg,#fbbf24,#f97316)' : '#e7e5e4'};box-shadow:${reviewCount > 0 ? '0 10px 18px rgba(249,115,22,.22)' : 'none'};opacity:${opacity};"></div>
                </div>
                <div style="margin-top:8px;font-size:10px;color:#78716c;white-space:nowrap;">${escapeHtml(point.label)}</div>
                <div style="margin-top:2px;font-size:12px;color:#1c1917;font-weight:800;">${reviewCount}</div>
              </div>
            `;
          })
          .join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <span style="display:inline-block;border-radius:999px;background:#ffedd5;color:#9a3412;padding:6px 10px;font-size:12px;font-weight:800;">${escapeHtml(totalLabel)}</span>
        <span style="display:inline-block;border-radius:999px;background:#fef3c7;color:#92400e;padding:6px 10px;font-size:12px;font-weight:800;">${escapeHtml(activeLabel)}</span>
      </div>
    </div>
  `;
}

function renderWeeklyProblemCard(problem, locale, tone) {
  const title = displayProblemTitle(problem, locale);
  const tags = safeArray(problem?.tags).slice(0, 3);
  const strength = formatPercent(problem?.retrievability);
  const difficulty = labelForDifficulty(problem?.difficulty, locale);
  const difficultyTone = difficultyColor(problem?.difficulty);
  const mastery = labelForMastery(problem?.masteryTier, locale);
  const accent = tone === 'accepted' ? '#2563eb' : tone === 'reviewed' ? '#059669' : '#f97316';
  const reviewLabel = locale === 'zh-CN' ? '复习' : 'Reviews';
  const nextLabel = locale === 'zh-CN' ? '下次' : 'Next';
  const strengthLabel = locale === 'zh-CN' ? '记忆强度' : 'Memory';
  const openLabel = locale === 'zh-CN' ? '打开题目' : 'Open';
  const overdueLabel = locale === 'zh-CN' ? `${Number(problem?.daysOverdue) || 0} 天逾期` : `${Number(problem?.daysOverdue) || 0}d overdue`;
  const nextReviewAt = String(problem?.nextReviewAt || '').slice(0, 10) || '-';

  return `
    <div style="border:1px solid #e7e5e4;border-radius:18px;background:#ffffff;padding:14px 15px;margin-bottom:10px;box-shadow:0 8px 24px rgba(28,25,23,.04);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div style="min-width:0;">
          <div style="margin-bottom:8px;">
            <span style="display:inline-block;border:1px solid ${difficultyTone}33;background:${difficultyTone}12;color:${difficultyTone};border-radius:8px;padding:3px 7px;font-size:10px;font-weight:900;">${escapeHtml(difficulty)}</span>
            <span style="display:inline-block;border:1px solid #d6d3d1;background:#fafaf9;color:#57534e;border-radius:8px;padding:3px 7px;font-size:10px;font-weight:900;">${escapeHtml(mastery)}</span>
            ${
              (Number(problem?.daysOverdue) || 0) > 0
                ? `<span style="display:inline-block;background:#7c3aed;color:white;border-radius:8px;padding:4px 7px;font-size:10px;font-weight:900;">${escapeHtml(overdueLabel)}</span>`
                : ''
            }
          </div>
          <div style="font-size:15px;line-height:1.35;font-weight:900;color:#1c1917;">${escapeHtml(title)}</div>
          <div style="margin-top:8px;">
            ${tags
              .map((tag) => `<span style="display:inline-block;margin:0 5px 5px 0;border-radius:999px;background:#f5f5f4;color:#57534e;padding:4px 8px;font-size:11px;font-weight:700;">${escapeHtml(tag)}</span>`)
              .join('')}
          </div>
        </div>
        <a href="${escapeHtml(problemUrlForLocale(problem?.titleSlug, locale))}" style="flex:0 0 auto;border-radius:10px;background:${accent};color:#ffffff;text-decoration:none;font-size:11px;font-weight:900;padding:8px 10px;">${openLabel}</a>
      </div>
      <div style="margin-top:12px;height:7px;border-radius:999px;background:#f5f5f4;overflow:hidden;">
        <div style="height:7px;width:${strength}%;border-radius:999px;background:${strength < 90 ? '#ef4444' : '#10b981'};"></div>
      </div>
      <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;color:#78716c;font-size:11px;font-weight:700;">
        <span>${strengthLabel}: <strong style="color:#292524;">${strength}%</strong></span>
        <span>${reviewLabel}: <strong style="color:#292524;">${Number(problem?.reviewCount) || 0}</strong></span>
        <span>${nextLabel}: <strong style="color:#292524;">${escapeHtml(nextReviewAt)}</strong></span>
      </div>
    </div>
  `;
}

function renderWeeklyProblemSection(title, emptyText, problems, locale, tone) {
  const safeProblems = safeArray(problems);
  return `
    <div style="margin-top:22px;">
      <div style="font-size:15px;font-weight:900;color:#1c1917;margin-bottom:10px;">${escapeHtml(title)}</div>
      ${
        safeProblems.length > 0
          ? safeProblems.map((problem) => renderWeeklyProblemCard(problem, locale, tone)).join('')
          : `<div style="border:1px dashed #d6d3d1;border-radius:16px;padding:14px;color:#78716c;font-size:13px;background:#fafaf9;">${escapeHtml(emptyText)}</div>`
      }
    </div>
  `;
}

function buildWeeklySummaryContent(payload, locale) {
  const title = locale === 'zh-CN' ? '本周刷题周报' : 'Your Weekly Review Digest';
  const subtitle =
    locale === 'zh-CN'
      ? '把本周新增、复习节奏、薄弱标签和下一批最该回看的题放在一起。'
      : 'A compact view of new accepts, review rhythm, weak spots, and the next queue.';
  const statLabels =
    locale === 'zh-CN'
      ? {
          reviewed: '本周复习',
          accepted: '新 AC',
          total: '累计题数',
          due: '待复习',
          overdue: '已逾期'
        }
      : {
          reviewed: 'Reviewed',
          accepted: 'New AC',
          total: 'Total',
          due: 'Due',
          overdue: 'Overdue'
        };
  const difficultyBreakdown = safeArray(payload.difficultyBreakdown);
  const topTags = safeArray(payload.topTags);
  const reviewQueueProblems = (
    safeArray(payload.reviewQueueProblems).length > 0
      ? safeArray(payload.reviewQueueProblems)
      : safeArray(payload.topOverdueProblems)
  ).slice(0, WEEKLY_EMAIL_CARD_LIMIT);
  const acceptedProblemCards = safeArray(payload.acceptedProblemCards).slice(0, WEEKLY_EMAIL_CARD_LIMIT);
  const reviewedProblemCards = safeArray(payload.reviewedProblemCards).slice(0, WEEKLY_EMAIL_CARD_LIMIT);

  return {
    subject: locale === 'zh-CN' ? 'Crush LeetCode 本周周报' : 'Crush LeetCode weekly digest',
    html: `
      <div style="margin:0;padding:24px;background:#f4f1ea;font-family:Inter,Arial,sans-serif;color:#1c1917;">
        <style>
          @media screen and (max-width: 620px) {
            .cl-shell { padding: 12px !important; }
            .cl-card { border-radius: 18px !important; }
            .cl-main { padding: 18px !important; }
            .cl-stat { display:block !important; width:100% !important; box-sizing:border-box !important; margin-bottom:10px !important; }
            .cl-half { display:block !important; width:100% !important; padding:0 0 10px 0 !important; }
            .cl-hero-title { font-size:24px !important; }
          }
        </style>
        <div class="cl-shell" style="max-width:760px;margin:0 auto;">
          <div class="cl-card" style="background:#fffaf2;border:1px solid #e7d8bf;border-radius:26px;overflow:hidden;box-shadow:0 24px 60px rgba(88,64,38,.12);">
            <div style="padding:28px;background:radial-gradient(circle at top right,#facc15 0,#f97316 34%,#1c1917 72%);color:white;">
              <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.82;font-weight:900;">Crush LeetCode</div>
              <h1 class="cl-hero-title" style="margin:12px 0 0;font-size:30px;line-height:1.16;">${title}</h1>
              <p style="margin:10px 0 0;color:#ffedd5;font-size:14px;line-height:1.6;max-width:560px;">${subtitle}</p>
            </div>
            <div class="cl-main" style="padding:24px 28px 28px;">
              <div style="font-size:0;margin:0 -5px;">
                ${[
                  [statLabels.reviewed, payload.reviewedProblemsThisWeekCount, '#fff7ed', '#9a3412'],
                  [statLabels.accepted, payload.acceptedProblemsThisWeekCount, '#eff6ff', '#1d4ed8'],
                  [statLabels.total, payload.totalProblems, '#fafaf9', '#57534e'],
                  [statLabels.due, payload.dueCount, '#ecfdf5', '#047857'],
                  [statLabels.overdue, payload.overdueCount, '#fef2f2', '#b91c1c']
                ]
                  .map(
                    ([label, value, background, color]) => `
                      <div class="cl-stat" style="display:inline-block;width:20%;vertical-align:top;padding:5px;box-sizing:border-box;">
                        <div style="border:1px solid #e7e5e4;background:${background};border-radius:18px;padding:14px;">
                          <div style="font-size:11px;color:${color};font-weight:900;">${label}</div>
                          <div style="margin-top:8px;font-size:28px;line-height:1;font-weight:950;color:#1c1917;">${Number(value) || 0}</div>
                        </div>
                      </div>
                    `
                  )
                  .join('')}
              </div>

              <div style="margin-top:22px;">
                <div style="font-size:15px;font-weight:900;color:#1c1917;">${locale === 'zh-CN' ? '每日刷题趋势' : 'Daily review trend'}</div>
                ${renderWeeklyChart(payload.dailyReviewPoints, locale)}
              </div>

              <div style="margin-top:22px;font-size:0;">
                <div class="cl-half" style="display:inline-block;width:50%;vertical-align:top;padding-right:6px;box-sizing:border-box;">
                  <div style="border:1px solid #e7e5e4;border-radius:18px;background:white;padding:14px;">
                    <div style="font-size:14px;font-weight:900;margin-bottom:10px;">${locale === 'zh-CN' ? '难度分布' : 'Difficulty'}</div>
                    ${difficultyBreakdown
                      .map((item) => {
                        const color = difficultyColor(item.difficulty);
                        return `<span style="display:inline-block;margin:0 6px 6px 0;border:1px solid ${color}33;background:${color}12;color:${color};border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;">${escapeHtml(labelForDifficulty(item.difficulty, locale))} ${Number(item.count) || 0}</span>`;
                      })
                      .join('') || `<span style="font-size:13px;color:#78716c;">-</span>`}
                  </div>
                </div>
                <div class="cl-half" style="display:inline-block;width:50%;vertical-align:top;padding-left:6px;box-sizing:border-box;">
                  <div style="border:1px solid #e7e5e4;border-radius:18px;background:white;padding:14px;">
                    <div style="font-size:14px;font-weight:900;margin-bottom:10px;">${locale === 'zh-CN' ? '高频标签' : 'Top tags'}</div>
                    ${topTags
                      .map((item) => `<span style="display:inline-block;margin:0 6px 6px 0;border-radius:999px;background:#f5f5f4;color:#57534e;padding:6px 10px;font-size:12px;font-weight:800;">${escapeHtml(item.tag)} ${Number(item.count) || 0}</span>`)
                      .join('') || `<span style="font-size:13px;color:#78716c;">-</span>`}
                  </div>
                </div>
              </div>

              ${renderWeeklyProblemSection(
                locale === 'zh-CN' ? '下一批最该回看的题' : 'Next review queue',
                locale === 'zh-CN' ? '当前没有待复习题。' : 'No due problems right now.',
                reviewQueueProblems,
                locale,
                'queue'
              )}
              ${renderWeeklyProblemSection(
                locale === 'zh-CN' ? '本周新增 AC' : 'New accepts this week',
                locale === 'zh-CN' ? '这周还没有新增 AC。' : 'No new accepted problems this week.',
                acceptedProblemCards,
                locale,
                'accepted'
              )}
              ${renderWeeklyProblemSection(
                locale === 'zh-CN' ? '最近复习过' : 'Recently reviewed',
                locale === 'zh-CN' ? '这周还没有完成复习。' : 'No reviews completed this week.',
                reviewedProblemCards,
                locale,
                'reviewed'
              )}
            </div>
          </div>
        </div>
      </div>
    `
  };
}

function buildEmailContent(payload) {
  const locale = payload.locale === 'zh-CN' ? 'zh-CN' : 'en';
  
  if (Array.isArray(payload.dailyReviewPoints)) {
    return buildWeeklySummaryContent(payload, locale);
  }

  const subject =
    locale === 'zh-CN'
      ? `Crush LeetCode 复习提醒：${payload.problemTitle}`
      : `Crush LeetCode review reminder: ${payload.problemTitle}`;
  const heading = locale === 'zh-CN' ? '有一道题该回来看一眼了' : 'You have an overdue review waiting';
  const body =
    locale === 'zh-CN'
      ? `${escapeHtml(payload.problemTitle)} 已逾期 ${payload.daysOverdue} 天。`
      : `${escapeHtml(payload.problemTitle)} is ${payload.daysOverdue} day(s) overdue.`;
  const cta = locale === 'zh-CN' ? '打开题目' : 'Open problem';
  const footer =
    locale === 'zh-CN'
      ? `计划复习时间：${escapeHtml(payload.nextReviewAt)}`
      : `Scheduled review time: ${escapeHtml(payload.nextReviewAt)}`;

  return {
    subject,
    html: `
      <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #171717; padding: 24px;">
        <div style="max-width: 560px; margin: 0 auto; border: 1px solid #e5e5e5; border-radius: 16px; overflow: hidden;">
          <div style="background: #111827; color: white; padding: 20px 24px;">
            <div style="font-size: 12px; opacity: 0.8; letter-spacing: 0.08em; text-transform: uppercase;">Crush LeetCode</div>
            <h1 style="margin: 8px 0 0; font-size: 22px; line-height: 1.3;">${heading}</h1>
          </div>
          <div style="padding: 24px;">
            <p style="margin: 0 0 12px; font-size: 16px; font-weight: 600;">${escapeHtml(payload.problemTitle)}</p>
            <p style="margin: 0 0 16px; color: #525252;">${body}</p>
            <a href="${escapeHtml(payload.problemUrl)}" style="display: inline-block; background: #f59e0b; color: #111827; text-decoration: none; font-weight: 700; padding: 10px 16px; border-radius: 12px;">${cta}</a>
            <p style="margin: 16px 0 0; font-size: 13px; color: #737373;">${footer}</p>
          </div>
        </div>
      </div>
    `
  };
}

function buildIdempotencyKey(payload) {
  const source = [
    payload?.eventId ?? '',
    payload?.recipientEmail ?? '',
    payload?.problemUrl ?? '',
    payload?.nextReviewAt ?? '',
    Number.isFinite(payload?.daysOverdue) ? payload.daysOverdue : '',
    Number.isFinite(payload?.totalProblems) ? payload.totalProblems : '',
    Number.isFinite(payload?.reviewedProblemsThisWeekCount) ? payload.reviewedProblemsThisWeekCount : ''
  ].join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}

/**
 * Robust request sender using built-in https module for maximum compatibility
 */
async function sendWithBrevo(payload) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.BREVO_FROM_EMAIL;
  const fromName = process.env.BREVO_FROM_NAME || 'Crush LeetCode';

  if (!apiKey || !fromEmail) {
    throw new Error('Server configuration missing (BREVO_API_KEY or BREVO_FROM_EMAIL).');
  }

  const content = buildEmailContent(payload);
  const postData = JSON.stringify({
    sender: { name: fromName, email: fromEmail },
    to: [{ email: payload.recipientEmail }],
    subject: content.subject,
    htmlContent: content.html,
    headers: { 'X-Crush-Idempotency-Key': buildIdempotencyKey(payload) },
    tags: ['crush-leetcode', Array.isArray(payload.dailyReviewPoints) ? 'weekly-digest' : 'review-reminder']
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(postData)
      },
      timeout: 10000 // 10s timeout
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ ok: true });
          }
        } else {
          reject(new Error(`Brevo API failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request to Brevo timed out.'));
    });
    req.write(postData);
    req.end();
  });
}

module.exports = {
  clearAdminSessionCookie,
  checkRateLimit,
  createAdminSessionCookie,
  getAdminSession,
  handleOptions,
  issueBetaCode,
  listBetaCodes,
  listOfficialUsers,
  requireAdminSecret,
  requireBetaAccess,
  requirePost,
  requireSecret,
  revokeBetaCode,
  sendWithResend: sendWithBrevo,
  setCorsHeaders,
  setOfficialUserStatus,
  validatePayload,
  verifyAdminCredentials
};
