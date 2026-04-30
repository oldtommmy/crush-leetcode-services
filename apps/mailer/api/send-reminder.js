const {
  checkRateLimit,
  handleOptions,
  requireBetaAccess,
  requirePost,
  requireSecret,
  sendWithResend,
  setCorsHeaders,
  validatePayload
} = require('./_lib');

function deliveryLogContext(body) {
  return {
    recipientEmail: typeof body?.recipientEmail === 'string' ? body.recipientEmail.trim().toLowerCase() : undefined,
    eventId: typeof body?.eventId === 'string' ? body.eventId : undefined,
    isWeeklySummary: Array.isArray(body?.dailyReviewPoints),
    totalProblems: body?.totalProblems,
    dueCount: body?.dueCount,
    acceptedProblemsThisWeekCount: body?.acceptedProblemsThisWeekCount,
    reviewedProblemsThisWeekCount: body?.reviewedProblemsThisWeekCount
  };
}

module.exports = async function handler(req, res) {
  // 1. Handle preflight early
  if (handleOptions(req, res)) {
    return;
  }

  // 2. Set CORS for all subsequent responses
  setCorsHeaders(res);

  try {
    if (!checkRateLimit(req, res, 'mailer')) {
      return;
    }

    // 3. Method check
    if (!requirePost(req, res)) {
      return;
    }

    // 4. Secret check
    if (!requireSecret(req, res)) {
      return;
    }

    // 5. Payload validation
    const errors = validatePayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid request payload.', 
        details: errors 
      });
    }

    // 6. Beta access validation for official weekly digest
    if (!requireBetaAccess(req.body, res)) {
      return;
    }

    // 7. Execution
    console.info('[Mailer] Sending email via Brevo.', deliveryLogContext(req.body));
    const result = await sendWithResend(req.body);
    console.info('[Mailer] Brevo accepted email.', {
      ...deliveryLogContext(req.body),
      emailId: result?.messageId || result?.id
    });
    return res.status(200).json({
      ok: true,
      emailId: result?.messageId || result?.id,
      provider: 'brevo'
    });

  } catch (error) {
    console.error('[Mailer Error]:', error);
    
    // Ensure we always return a JSON response with status 502/500
    // and maintaining CORS headers (already set above)
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
