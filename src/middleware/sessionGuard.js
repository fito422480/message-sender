// src/middleware/sessionGuard.js
const crypto = require('crypto');
const logger = require('../logger');

const SESSION_TTL = 24 * 60 * 60;
const SESSION_PREFIX = 'ms:session:';

const sessions = new Map();

async function createSession(userId, req, res) {
  const token = crypto.randomUUID();
  const sessionData = {
    token,
    createdAt: new Date().toISOString(),
    userAgent: req.headers['user-agent'] || 'unknown',
    ip: req.ip || req.connection.remoteAddress || 'unknown'
  };

  sessions.set(`${SESSION_PREFIX}${userId}`, sessionData);
  res.setHeader('X-Session-Token', token);
  logger.info({ uid: userId }, 'New session created');
  return token;
}

async function sessionGuard(req, res, next) {
  try {
    const userId = req.auth && req.auth.uid;
    if (!userId) {
      return next();
    }

    const clientToken = req.headers['x-session-token'] || null;
    const stored = sessions.get(`${SESSION_PREFIX}${userId}`);

    if (!clientToken) {
      if (stored) {
        return next();
      }
      await createSession(userId, req, res);
      return next();
    }

    if (!stored) {
      sessions.set(`${SESSION_PREFIX}${userId}`, {
        token: clientToken,
        createdAt: new Date().toISOString(),
        userAgent: req.headers['user-agent'] || 'unknown',
        ip: req.ip || req.connection.remoteAddress || 'unknown'
      });
      logger.info({ uid: userId }, 'sessionGuard: re-adopted client token (no stored session)');
      return next();
    }

    if (stored.token === clientToken) {
      return next();
    }

    logger.warn({
      uid: userId,
      clientToken: clientToken.substring(0, 8) + '...',
      storedToken: stored.token.substring(0, 8) + '...'
    }, 'Session conflict detected');

    return res.status(401).json({
      error: 'session_conflict',
      message: 'Sesion activa en otro dispositivo'
    });
  } catch (err) {
    logger.error({ err: err.message, uid: req.auth && req.auth.uid }, 'sessionGuard error, allowing request');
    return next();
  }
}

async function clearSession(userId) {
  try {
    sessions.delete(`${SESSION_PREFIX}${userId}`);
    logger.info({ uid: userId }, 'Session cleared');
  } catch (err) {
    logger.warn({ uid: userId, err: err.message }, 'clearSession error');
  }
}

module.exports = { sessionGuard, createSession, clearSession, SESSION_PREFIX, SESSION_TTL };
