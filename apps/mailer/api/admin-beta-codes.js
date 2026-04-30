const {
  checkRateLimit,
  handleOptions,
  listBetaCodes,
  requireAdminSecret,
  revokeBetaCode,
  setCorsHeaders
} = require('./_lib');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCorsHeaders(res);

  try {
    if (!checkRateLimit(req, res, 'adminApi')) {
      return;
    }

    if (!requireAdminSecret(req, res)) {
      return;
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        codes: listBetaCodes({ limit: req.query?.limit })
      });
    }

    if (req.method === 'POST') {
      if (req.body?.action === 'revoke') {
        const result = revokeBetaCode(req.body.id);
        if (!result.ok) {
          return res.status(404).json({ ok: false, error: 'Beta code not found.' });
        }
        return res.status(200).json({ ok: true, revokedAt: result.revokedAt });
      }

      return res.status(400).json({ ok: false, error: 'Unsupported admin action.' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (error) {
    console.error('[Admin Beta Codes Error]:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
