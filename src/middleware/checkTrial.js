// src/middleware/checkTrial.js
const { db } = require('../firebaseAdmin');
const logger = require('../logger');
const { invalidateProfileCache } = require('./ensureUserProfile');

/**
 * Middleware: check trial/plan status.
 * Runs after ensureUserProfile. Reads req.userProfile.
 */
async function checkTrial(req, res, next) {
  try {
    const profile = req.userProfile;

    // If Firestore is not available (dev mode) or profile is missing, let request through
    if (!db) {
      logger.warn({ uid: req.auth && req.auth.uid }, 'checkTrial: Firestore not available, skipping');
      return next();
    }

    if (!profile) {
      logger.warn({ uid: req.auth && req.auth.uid }, 'checkTrial: no userProfile, skipping trial check');
      return next();
    }

    // Check account status (suspended/disabled) before anything else
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

    // Admin bypasses trial
    if (profile.role === 'admin') {
      return next();
    }

    // Paid/active user (any paid plan passes through)
    const paidPlans = ['active', 'basico', 'profesional', 'premium', 'enterprise'];
    if (paidPlans.includes(profile.plan)) {
      return next();
    }

    // Trial user — check expiry
    if (profile.plan === 'trial') {
      const trialEnd = profile.trialEndsAt instanceof Date
        ? profile.trialEndsAt
        : (profile.trialEndsAt && profile.trialEndsAt.toDate
          ? profile.trialEndsAt.toDate()
          : new Date(profile.trialEndsAt));

      if (trialEnd > new Date()) {
        return next(); // trial still valid
      }

      // Trial expired — update Firestore
      try {
        await db.collection('users').doc(profile.uid).set({ plan: 'expired' }, { merge: true });
        invalidateProfileCache(profile.uid);
        logger.info({ uid: profile.uid }, 'Trial expired, plan updated to expired');
      } catch (updateErr) {
        logger.error({ uid: profile.uid, err: updateErr.message }, 'Failed to update expired plan');
      }

      return res.status(403).json({
        error: 'trial_expired',
        message: 'Tu periodo de prueba ha expirado',
        trialEndsAt: trialEnd.toISOString()
      });
    }

    // Expired plan
    if (profile.plan === 'expired') {
      return res.status(403).json({
        error: 'account_inactive',
        message: 'Tu cuenta esta inactiva'
      });
    }

    // Unknown plan — let through with warning
    logger.warn({ uid: profile.uid, plan: profile.plan }, 'checkTrial: unknown plan type');
    return next();
  } catch (err) {
    logger.error({ err: err.message, uid: req.auth && req.auth.uid }, 'checkTrial error');
    // Don't crash — let request through
    return next();
  }
}

module.exports = { checkTrial };
