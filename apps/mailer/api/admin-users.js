const {
  handleOptions,
  listOfficialUsers,
  requireAdminSecret,
  setCorsHeaders,
  setOfficialUserStatus
} = require('./_lib');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCorsHeaders(res);

  try {
    if (!requireAdminSecret(req, res)) {
      return;
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        users: listOfficialUsers({ limit: req.query?.limit })
      });
    }

    if (req.method === 'POST') {
      if (req.body?.action === 'set-status') {
        const result = setOfficialUserStatus(req.body.id || req.body.email, req.body.status);
        if (!result.ok) {
          return res.status(404).json({ ok: false, error: 'User not found.' });
        }
        return res.status(200).json({ ok: true, user: result.user });
      }

      return res.status(400).json({ ok: false, error: 'Unsupported admin action.' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (error) {
    console.error('[Admin Users Error]:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
