const { handleOptions, requirePost, setCorsHeaders } = require('./_lib');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCorsHeaders(res);
  if (!requirePost(req, res)) {
    return;
  }

  res.status(200).json({
    ok: true,
    service: 'crush-leetcode-official-mailer',
    brevoConfigured: Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL),
    secretConfigured: Boolean(process.env.REMINDER_SHARED_SECRET)
  });
};
