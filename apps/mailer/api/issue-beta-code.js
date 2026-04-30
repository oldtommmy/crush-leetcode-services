const {
  checkRateLimit,
  handleOptions,
  issueBetaCode,
  requireAdminSecret,
  requirePost,
  setCorsHeaders
} = require('./_lib');

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCorsHeaders(res);

  try {
    if (!checkRateLimit(req, res, 'adminApi')) {
      return;
    }

    if (!requirePost(req, res)) {
      return;
    }

    if (!requireAdminSecret(req, res)) {
      return;
    }

    if (!isEmail(req.body?.recipientEmail)) {
      return res.status(400).json({
        ok: false,
        error: 'recipientEmail must be a valid email.'
      });
    }

    const result = issueBetaCode({
      recipientEmail: req.body.recipientEmail,
      githubUsername: req.body.githubUsername,
      expiresAt: req.body.expiresAt
    });

    return res.status(200).json({
      ok: true,
      codeId: result.payload.id,
      userId: result.payload.userId,
      code: result.code,
      recipientEmail: result.payload.recipientEmail,
      githubUsername: result.payload.githubUsername,
      expiresAt: result.payload.expiresAt
    });
  } catch (error) {
    console.error('[Beta Code Error]:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
