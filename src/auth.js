// src/auth.js
require('dotenv').config();
const logger = require('./logger');
const { auth } = require('./firebaseAdmin');

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */
function getBearerToken(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header) return null;
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return null;
  return token;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Middleware: verify Firebase ID token
 * ────────────────────────────────────────────────────────────────────────── */
async function checkJwt(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      logger.warn('Missing Bearer token in request', {
        url: req.url,
        method: req.method,
        headers: Object.keys(req.headers),
        authHeader: req.headers['authorization'] ? 'present' : 'missing'
      });
      return res.status(401).json({ error: 'Missing Bearer token' });
    }

    logger.debug('Verifying Firebase ID token', {
      url: req.url,
      tokenLength: token.length
    });

    const decoded = await auth.verifyIdToken(token);

    logger.debug('Firebase token verification successful', {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name
    });

    req.token = token;
    req.auth = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
      email_verified: decoded.email_verified || false,
      sign_in_provider: (decoded.firebase && decoded.firebase.sign_in_provider) || 'password',
    };

    return next();
  } catch (err) {
    logger.warn({
      err: err?.message,
      code: err?.code,
      url: req.url
    }, 'Firebase token verification failed');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Exports
 * ────────────────────────────────────────────────────────────────────────── */
module.exports = {
  checkJwt,
  getBearerToken,
};
