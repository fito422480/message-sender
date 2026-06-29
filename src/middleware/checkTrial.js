// src/middleware/checkTrial.js
const logger = require('../logger');

/**
 * Middleware: check account status.
 * Plan/trial restrictions are disabled so users can keep using the app.
 * Runs after ensureUserProfile. Reads req.userProfile.
 */
async function checkTrial(req, res, next) {
  try {
    const profile = req.userProfile;

    if (!profile) {
      logger.warn({ uid: req.auth && req.auth.uid }, 'checkTrial: no userProfile, skipping account status check');
      return next();
    }

    // Account status is still enforced independently of plan/trial state.
    const status = profile.status || 'active';
    if (status === 'suspended') {
      return res.status(403).json({
        error: 'account_suspended',
        message: 'Tu cuenta ha sido suspendida'
      });
    }
    if (status === 'disabled') {
      return res.status(403).json({
        error: 'account_disabled',
        message: 'Tu cuenta ha sido deshabilitada'
      });
    }

    return next();
  } catch (err) {
    logger.error({ err: err.message, uid: req.auth && req.auth.uid }, 'checkTrial error');
    // Don't crash — let request through
    return next();
  }
}

module.exports = { checkTrial };
