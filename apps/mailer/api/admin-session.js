const {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  getAdminSession,
  handleOptions,
  setCorsHeaders,
  verifyAdminCredentials
} = require('./_lib');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCorsHeaders(res);

  try {
    if (req.method === 'GET') {
      const session = getAdminSession(req);
      return res.status(200).json({
        ok: true,
        authenticated: session.ok,
        username: session.ok ? session.payload.username : undefined
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }

    if (req.body?.action === 'logout') {
      res.setHeader('Set-Cookie', clearAdminSessionCookie(req));
      return res.status(200).json({ ok: true });
    }

    const result = verifyAdminCredentials(req.body?.username, req.body?.password);
    if (!result.ok) {
      return res.status(401).json({ ok: false, error: result.error });
    }

    res.setHeader('Set-Cookie', createAdminSessionCookie(result.username, req));
    return res.status(200).json({
      ok: true,
      authenticated: true,
      username: result.username
    });
  } catch (error) {
    console.error('[Admin Session Error]:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
