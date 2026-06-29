/**
 * API v1 Routes — Public API access for authenticated API key users.
 * Authentication via API Key → Bearer token (separate from Firebase JWT).
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const logger = require('./logger');
const { normalizeNumber } = require('./phoneValidator');
const metricsStore = require('./metricsStore');
const redisQueue = require('./queueRedis');
const { ALLOWED_INTERVALS, DEFAULT_INTERVAL } = require('./queueRedis');
const sessionManager = require('./sessionManager');

// In-memory token store: token → { uid, createdAt, expiresAt }
// In production this should be Redis-backed; good enough for MVP.
const apiTokens = new Map();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ────────────────────────────────────────────
// Middleware: validate API Bearer token
// ────────────────────────────────────────────
function apiAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <token>' });
  }

  const token = authHeader.slice(7);
  const entry = apiTokens.get(token);

  if (!entry) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (Date.now() > entry.expiresAt) {
    apiTokens.delete(token);
    return res.status(401).json({ error: 'Token expired. Please request a new one via POST /api/v1/auth/token' });
  }

  // Attach minimal auth context compatible with existing code
  req.auth = { uid: entry.uid };
  req.apiUser = entry;
  next();
}

// ────────────────────────────────────────────
// Helper kept for compatibility; plan restrictions are disabled.
// ────────────────────────────────────────────
async function requireApiPlan(uid) {
  return null;
}

// ────────────────────────────────────────────
// Build API v1 router
// ────────────────────────────────────────────
function buildApiV1Routes() {
  const router = express.Router();

  // ── Serve OpenAPI spec ──
  router.get('/docs/openapi.json', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'openapi.json'));
  });

  // ══════════════════════════════════════════
  // POST /api/v1/auth/token
  // ══════════════════════════════════════════
  router.post('/auth/token', async (req, res) => {
    try {
      const apiKey = req.body.apiKey || req.headers['x-api-key'];

      if (!apiKey) {
        return res.status(400).json({ error: 'Missing required field: apiKey' });
      }

      // Look up user by API key in Firestore
      const { db } = require('./firebaseAdmin');

      if (!db) {
        // Dev mode fallback
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        apiTokens.set(token, {
          uid: 'dev-user-001',
          createdAt: now,
          expiresAt: now + TOKEN_TTL_MS
        });
        return res.json({
          success: true,
          token,
          expiresIn: TOKEN_TTL_MS / 1000,
          uid: 'dev-user-001'
        });
      }

      const usersSnap = await db.collection('users').where('apiKey', '==', apiKey).limit(1).get();

      if (usersSnap.empty) {
        return res.status(401).json({ error: 'Invalid or revoked API key' });
      }

      const userDoc = usersSnap.docs[0];
      const uid = userDoc.id;
      const profile = userDoc.data();

      // Plan checks are disabled.
      const planError = await requireApiPlan(uid);
      if (planError) {
        return res.status(403).json({ error: planError });
      }

      // Generate token
      const token = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      apiTokens.set(token, {
        uid,
        email: profile.email,
        plan: profile.plan,
        role: profile.role,
        createdAt: now,
        expiresAt: now + TOKEN_TTL_MS
      });

      logger.info({ uid }, 'API token issued');

      return res.json({
        success: true,
        token,
        expiresIn: TOKEN_TTL_MS / 1000,
        uid
      });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error in POST /api/v1/auth/token');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ══════════════════════════════════════════
  // POST /api/v1/messages/send
  // ══════════════════════════════════════════
  router.post('/messages/send', apiAuth, async (req, res) => {
    try {
      const { phone, message, mediaUrl, mediaType, messageInterval: rawInterval } = req.body;
      const uid = req.auth.uid;

      if (!phone) {
        return res.status(400).json({ error: 'Missing required field: phone' });
      }
      if (!message) {
        return res.status(400).json({ error: 'Missing required field: message' });
      }
      if (mediaUrl && !mediaType) {
        return res.status(400).json({ error: 'mediaType is required when mediaUrl is provided' });
      }

      // Validate messageInterval
      let messageInterval = DEFAULT_INTERVAL;
      if (rawInterval !== undefined) {
        const parsed = Number(rawInterval);
        if (!ALLOWED_INTERVALS.includes(parsed)) {
          return res.status(400).json({
            error: `Invalid messageInterval. Allowed values: ${ALLOWED_INTERVALS.join(', ')}`,
          });
        }
        messageInterval = parsed;
      }

      // Normalize phone number
      const phoneResult = normalizeNumber(phone, 'PY');
      if (!phoneResult.valid) {
        return res.status(400).json({ error: 'Invalid phone number format. Expected international format, e.g. 595991234567' });
      }

      // Check WhatsApp connection
      const whatsappManager = await sessionManager.getSession(uid);
      if (!whatsappManager || !whatsappManager.isReady) {
        return res.status(503).json({
          error: 'WhatsApp session is not connected. Please connect via the dashboard first.'
        });
      }

      // Create a single-recipient campaign
      const messageId = 'msg_' + crypto.randomBytes(8).toString('hex');
      const numbers = [{
        number: phoneResult.normalized,
        variables: {}
      }];

      const campaign = await metricsStore.createCampaign(uid, {
        name: `API Send - ${phoneResult.normalized}`,
        totalRecipients: 1,
        templateCount: 1,
      });
      await metricsStore.initCampaignRecipients(uid, campaign.id, numbers);

      // Enqueue via existing infrastructure
      await redisQueue.enqueueCampaign(uid, numbers, [message], null, null, null, { campaignId: campaign.id, messageInterval });

      logger.info({ uid, phone: phoneResult.normalized, messageId, campaignId: campaign.id, messageInterval }, 'API single message queued');

      return res.json({
        success: true,
        messageId,
        phone: phoneResult.normalized,
        status: 'queued',
        campaignId: campaign.id,
        messageInterval
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error in POST /api/v1/messages/send');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ══════════════════════════════════════════
  // POST /api/v1/messages/bulk
  // ══════════════════════════════════════════
  router.post('/messages/bulk', apiAuth, async (req, res) => {
    try {
      const { recipients, template, mediaUrl, campaignName, messageInterval: rawInterval } = req.body;
      const uid = req.auth.uid;

      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'Missing or empty required field: recipients' });
      }
      if (!template || typeof template !== 'string' || template.trim().length === 0) {
        return res.status(400).json({ error: 'Missing required field: template' });
      }
      if (recipients.length > 10000) {
        return res.status(400).json({ error: 'Maximum 10,000 recipients per request' });
      }

      // Validate messageInterval
      let messageInterval = DEFAULT_INTERVAL;
      if (rawInterval !== undefined) {
        const parsed = Number(rawInterval);
        if (!ALLOWED_INTERVALS.includes(parsed)) {
          return res.status(400).json({
            error: `Invalid messageInterval. Allowed values: ${ALLOWED_INTERVALS.join(', ')}`,
          });
        }
        messageInterval = parsed;
      }

      // Check WhatsApp connection
      const whatsappManager = await sessionManager.getSession(uid);
      if (!whatsappManager || !whatsappManager.isReady) {
        return res.status(503).json({
          error: 'WhatsApp session is not connected. Please connect via the dashboard first.'
        });
      }

      // Normalize and validate all phone numbers
      const numbers = [];
      const invalidPhones = [];

      for (const r of recipients) {
        if (!r.phone) {
          invalidPhones.push({ phone: r.phone, reason: 'Missing phone' });
          continue;
        }
        const phoneResult = normalizeNumber(r.phone, 'PY');
        if (!phoneResult.valid) {
          invalidPhones.push({ phone: r.phone, reason: 'Invalid format' });
          continue;
        }
        numbers.push({
          number: phoneResult.normalized,
          variables: r.variables || {}
        });
      }

      if (numbers.length === 0) {
        return res.status(400).json({
          error: 'No valid phone numbers found',
          invalidPhones: invalidPhones.slice(0, 10)
        });
      }

      // Create campaign
      const campaign = await metricsStore.createCampaign(uid, {
        name: campaignName || `API Bulk - ${new Date().toISOString()}`,
        totalRecipients: numbers.length,
        templateCount: 1,
      });
      await metricsStore.initCampaignRecipients(uid, campaign.id, numbers);

      // Enqueue
      await redisQueue.enqueueCampaign(uid, numbers, [template], null, null, null, { campaignId: campaign.id, messageInterval });

      logger.info({ uid, campaignId: campaign.id, totalRecipients: numbers.length, messageInterval }, 'API bulk campaign queued');

      return res.json({
        success: true,
        campaignId: campaign.id,
        totalRecipients: numbers.length,
        invalidCount: invalidPhones.length,
        status: 'processing',
        messageInterval
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error in POST /api/v1/messages/bulk');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ══════════════════════════════════════════
  // GET /api/v1/messages/status/:campaignId
  // ══════════════════════════════════════════
  router.get('/messages/status/:campaignId', apiAuth, async (req, res) => {
    try {
      const uid = req.auth.uid;
      const { campaignId } = req.params;

      const detail = await metricsStore.getCampaignDetail(uid, campaignId);
      if (!detail) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      // Determine state
      let state = 'processing';
      const totalProcessed = (detail.sent || 0) + (detail.errors || 0);
      if (totalProcessed >= (detail.total || detail.totalRecipients || 0)) {
        state = 'completed';
      }

      return res.json({
        campaignId,
        name: detail.name || detail.campaignName || null,
        total: detail.total || detail.totalRecipients || 0,
        sent: detail.sent || 0,
        errors: detail.errors || 0,
        state,
        results: detail.recipients || detail.results || [],
        createdAt: detail.createdAt || null
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error in GET /api/v1/messages/status/:campaignId');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ══════════════════════════════════════════
  // Webhooks CRUD (stub — stores in Firestore)
  // ══════════════════════════════════════════
  router.post('/webhooks', apiAuth, async (req, res) => {
    try {
      const uid = req.auth.uid;
      const { url, events } = req.body;

      if (!url) {
        return res.status(400).json({ error: 'Missing required field: url' });
      }
      if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'Missing required field: events (array)' });
      }

      const validEvents = ['message.sent', 'message.failed', 'message.delivered', 'campaign.completed'];
      const invalidEvents = events.filter(e => !validEvents.includes(e));
      if (invalidEvents.length > 0) {
        return res.status(400).json({ error: 'Invalid events: ' + invalidEvents.join(', ') + '. Valid: ' + validEvents.join(', ') });
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      const webhookId = 'wh_' + crypto.randomBytes(8).toString('hex');
      const secret = 'whsec_' + crypto.randomBytes(16).toString('hex');

      // Store in Firestore
      const { db } = require('./firebaseAdmin');
      if (db) {
        await db.collection('webhooks').doc(webhookId).set({
          uid,
          url,
          events,
          secret,
          active: true,
          createdAt: new Date().toISOString()
        });
      }

      logger.info({ uid, webhookId, url, events }, 'Webhook registered');

      return res.json({
        success: true,
        webhookId,
        url,
        events,
        secret
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error in POST /api/v1/webhooks');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/webhooks', apiAuth, async (req, res) => {
    try {
      const uid = req.auth.uid;

      const { db } = require('./firebaseAdmin');
      if (!db) {
        return res.json({ webhooks: [] });
      }

      const snap = await db.collection('webhooks').where('uid', '==', uid).get();
      const webhooks = [];
      snap.forEach(doc => {
        const data = doc.data();
        webhooks.push({
          webhookId: doc.id,
          url: data.url,
          events: data.events,
          active: data.active,
          createdAt: data.createdAt
        });
      });

      return res.json({ webhooks });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error in GET /api/v1/webhooks');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/webhooks', apiAuth, async (req, res) => {
    try {
      const uid = req.auth.uid;
      const { webhookId } = req.query;

      if (!webhookId) {
        return res.status(400).json({ error: 'Missing required query parameter: webhookId' });
      }

      const { db } = require('./firebaseAdmin');
      if (!db) {
        return res.json({ success: true });
      }

      const docRef = db.collection('webhooks').doc(webhookId);
      const snap = await docRef.get();

      if (!snap.exists || snap.data().uid !== uid) {
        return res.status(404).json({ error: 'Webhook not found' });
      }

      await docRef.delete();
      logger.info({ uid, webhookId }, 'Webhook deleted');

      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error in DELETE /api/v1/webhooks');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ══════════════════════════════════════════
  // GET /api/v1/config/intervals
  // ══════════════════════════════════════════
  router.get('/config/intervals', apiAuth, (req, res) => {
    const intervals = ALLOWED_INTERVALS.map(value => ({
      value,
      label: value === 3 ? 'Fast (3s)' :
             value === 5 ? 'Normal (5s)' :
             value === 8 ? 'Safe (8s)' :
             value === 12 ? 'Very safe (12s)' :
             'Ultra safe (15s)',
      restricted: value === 3,
      default: value === DEFAULT_INTERVAL
    }));

    return res.json({
      intervals,
      defaultInterval: DEFAULT_INTERVAL,
      allowedValues: ALLOWED_INTERVALS
    });
  });

  // Periodic cleanup of expired tokens
  setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of apiTokens.entries()) {
      if (now > entry.expiresAt) {
        apiTokens.delete(token);
      }
    }
  }, 60 * 60 * 1000); // Every hour

  return router;
}

module.exports = { buildApiV1Routes };
