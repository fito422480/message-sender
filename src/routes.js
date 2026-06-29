const fs = require('fs');
const path = require('path');
const express = require('express');
const { upload } = require('./media');
const { cleanupOldFiles, loadNumbersFromCSV } = require('./utils');
const { normalizeNumber, getCountryConfigs } = require('./phoneValidator');
const waha = require('./wahaClient');
const redisQueue = require('./queueRedis');
const metricsStore = require('./metricsStore');
const { publicDir, retentionHours } = require('./config');
const logger = require('./logger');
const { checkJwt } = require('./auth');
const sessionManager = require('./sessionManager');
const { ensureUserProfile, invalidateProfileCache } = require('./middleware/ensureUserProfile');
const { checkTrial } = require('./middleware/checkTrial');
const { sessionGuard, createSession, clearSession } = require('./middleware/sessionGuard');
const { ensureEmailVerified } = require('./middleware/ensureEmailVerified');
const { admin, db, auth } = require('./firebaseAdmin');
const { requireFeature, requireLimit, getPlanFeatures } = require('./middleware/planGate');

// Map para rastrear operaciones de refresh-qr en progreso por usuario
const qrRefreshInProgress = new Map();

// Middleware condicional para desarrollo
// Chains: checkJwt -> ensureUserProfile -> checkTrial
const conditionalAuth = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    req.auth = {
      uid: 'dev-user-001',
      name: 'Usuario Desarrollo',
      email: 'dev@test.com',
      picture: null,
      email_verified: true,
      sign_in_provider: 'password'
    };
    req.userProfile = {
      uid: 'dev-user-001',
      email: 'dev@test.com',
      displayName: 'Usuario Desarrollo',
      photoURL: null,
      plan: 'active',
      role: 'admin',
      status: 'active',
      country: 'PY',
      trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      whatsappPhone: null,
      createdAt: new Date(),
      lastLoginAt: new Date()
    };
    return next();
  }

  // Production chain: checkJwt -> ensureUserProfile -> ensureEmailVerified -> checkTrial -> sessionGuard
  checkJwt(req, res, (err) => {
    if (err) return; // checkJwt already sent response
    ensureUserProfile(req, res, (err2) => {
      if (err2) return;
      ensureEmailVerified(req, res, (err3) => {
        if (err3) return;
        checkTrial(req, res, (err4) => {
          if (err4) return;
          sessionGuard(req, res, next);
        });
      });
    });
  });
};

// Auth-only middleware (no trial check) — for endpoints expired users should access
const conditionalAuthNoTrial = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    req.auth = {
      uid: 'dev-user-001',
      name: 'Usuario Desarrollo',
      email: 'dev@test.com',
      picture: null,
      email_verified: true,
      sign_in_provider: 'password'
    };
    req.userProfile = {
      uid: 'dev-user-001',
      email: 'dev@test.com',
      displayName: 'Usuario Desarrollo',
      photoURL: null,
      plan: 'active',
      role: 'admin',
      status: 'active',
      country: 'PY',
      trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      whatsappPhone: null,
      createdAt: new Date(),
      lastLoginAt: new Date()
    };
    return next();
  }

  // Production chain: checkJwt -> ensureUserProfile (no trial check)
  checkJwt(req, res, (err) => {
    if (err) return;
    ensureUserProfile(req, res, next);
  });
};

// conditionalRole — with Firebase Auth there are no Keycloak role arrays.
// In production we simply check that the user is authenticated (checkJwt already ran).
// The parameter is kept for API compatibility so call-sites don't need changes.
const conditionalRole = (_role) => (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  // Authenticated users pass — Firebase custom-claims based roles can be added later.
  if (!req.auth) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  return next();
};

function buildRoutes() {
  const router = express.Router();

  // ── Public Firebase client config (NO auth — needed before login) ──
  router.get('/config/firebase', (_req, res) => {
    res.json({
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      measurementId: process.env.FIREBASE_MEASUREMENT_ID
    });
  });

  // ── Session management (no sessionGuard — this endpoint CREATES sessions) ──
  router.post('/auth/session', conditionalAuthNoTrial, async (req, res) => {
    try {
      const userId = req.auth.uid;
      const crypto = require('crypto');

      const token = crypto.randomUUID();
      logger.info({ uid: userId }, 'Session created via POST /auth/session');

      res.json({ sessionToken: token });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en POST /auth/session');
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  // ── Session cleanup on logout ──
  router.post('/auth/logout-session', conditionalAuthNoTrial, async (req, res) => {
    try {
      const userId = req.auth.uid;
      await clearSession(userId);
      res.json({ success: true, message: 'Session cleared' });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en POST /auth/logout-session');
      res.status(500).json({ error: 'Failed to clear session' });
    }
  });

  // ── Resend email verification (tracking endpoint) ──
  router.post('/auth/resend-verification', conditionalAuthNoTrial, async (req, res) => {
    try {
      const uid = req.auth.uid;
      const email = req.auth.email;

      // Google users don't need email verification
      if (req.auth.sign_in_provider === 'google.com') {
        return res.json({ success: true, message: 'Google users are already verified' });
      }

      if (req.auth.email_verified) {
        return res.json({ success: true, message: 'Email already verified' });
      }

      // Generate verification link via Firebase Admin SDK
      if (auth) {
        try {
          const link = await auth.generateEmailVerificationLink(email);
          logger.info({ uid, email }, 'Email verification link generated');
        } catch (linkErr) {
          logger.warn({ uid, email, err: linkErr.message }, 'Could not generate verification link via Admin SDK');
        }
      }

      logger.info({ uid, email }, 'Resend verification requested');
      res.json({ success: true, message: 'Verification email requested' });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en POST /auth/resend-verification');
      res.status(500).json({ error: 'Failed to process verification request' });
    }
  });

  // Intervalos de envío disponibles para el usuario
  router.get('/config/intervals', conditionalAuth, (req, res) => {
    const intervals = [
      { value: 3,  label: 'Rapido (3s)', badge: '\u26A0\uFE0F', color: 'warning', restricted: false, available: true },
      { value: 5,  label: 'Normal (5s)', badge: '\u2713',       color: 'success', restricted: false, available: true, default: true },
      { value: 8,  label: 'Seguro (8s)', badge: '\u2713\u2713',       color: 'info',    restricted: false, available: true },
      { value: 12, label: 'Muy seguro (12s)', badge: '\u2713\u2713\u2713',   color: 'info',    restricted: false, available: true },
      { value: 15, label: 'Ultra seguro (15s)', badge: '',       color: 'secondary', restricted: false, available: true },
    ];

    res.json({ intervals, defaultInterval: 5 });
  });

  // Estado de la sesión del usuario autenticado
  router.get('/connection-status', conditionalAuth, async (req, res) => {
    try {
      const whatsappManager = await sessionManager.getSessionByToken(req);
      const s = whatsappManager.getState();

      const conn = s.connectionState;
      const stateText = s.isReady
        ? 'connected'
        : (conn === 'qr_ready' ? 'qr_ready'
          : (conn === 'connecting' ? 'connecting' : 'disconnected'));

      const resp = {
        status: s.connectionState,
        state: stateText,
        isReady: s.isReady,
        lastActivity: s.lastActivity,
        lastActivityAgo: Math.round((Date.now() - s.lastActivity) / 1000),
        hasQR: !!s.qrCode,
        userId: req.auth?.uid,
        userName: req.auth?.name || req.auth?.email,
        connection: {
          isConnecting: conn === 'connecting',
          lastDisconnectReason: null
        }
      };

      if (s.userInfo) {
        resp.userInfo = {
          phoneNumber: s.userInfo.phoneNumber,
          pushname: s.userInfo.pushname
        };
      }

      if (req.userProfile && req.userProfile.whatsappPhone) {
        resp.whatsappPhone = req.userProfile.whatsappPhone;
      }

      res.json(resp);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en /connection-status');
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/send-messages', conditionalAuth, conditionalRole('sender_api'), requireLimit('send'), upload.fields([
    { name: 'csvFile', maxCount: 1 },
    { name: 'images', maxCount: 10 },
    { name: 'singleImage', maxCount: 1 },
    { name: 'audioFile', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const whatsappManager = await sessionManager.getSessionByToken(req);

      if (!whatsappManager.isReady) {
        return res.status(400).json({
          error: 'Tu sesión de WhatsApp no está lista. Escaneá el QR primero.',
          needsQR: true
        });
      }

      const userCountry = req.userProfile?.country || 'PY';
      if (req.userProfile && !req.userProfile.country) {
        req.userProfile.country = userCountry;
      }

      const userId = req.auth?.uid || 'default';
      const { recipientSource, contactIds, groupName, templates: templatesJson, message, campaignName, messageInterval: rawInterval } = req.body;

      // Validate message interval
      const allowedIntervals = redisQueue.ALLOWED_INTERVALS || [3, 5, 8, 12, 15];
      const defaultInterval = redisQueue.DEFAULT_INTERVAL || 5;
      let messageInterval = Number(rawInterval) || defaultInterval;
      if (!allowedIntervals.includes(messageInterval)) {
        messageInterval = defaultInterval;
      }

      let numbers = [];
      let source = recipientSource || 'csv';
      let importSummary = null;
      let duplicates = 0;
      let invalidCount = 0;

      // Obtener destinatarios según la fuente
      if (source === 'contacts' && contactIds) {
        // Enviar a contactos seleccionados
        const ids = typeof contactIds === 'string' ? JSON.parse(contactIds) : contactIds;
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ error: 'Debes seleccionar al menos un contacto' });
        }
        const contacts = await metricsStore.getContactsByIds(userId, ids);
        if (contacts.length === 0) {
          return res.status(400).json({ error: 'No se encontraron los contactos seleccionados' });
        }
        numbers = contacts.map(c => ({
          number: c.phone,
          contactId: c.id,
          variables: {
            nombre: c.nombre || '',
            tratamiento: c.tratamiento || '',
            grupo: c.grupo || ''
          }
        }));
      } else if (source === 'group' && groupName) {
        // Enviar a un grupo completo
        const contacts = await metricsStore.getContactsByGroup(userId, groupName);
        if (contacts.length === 0) {
          return res.status(400).json({ error: `No se encontraron contactos en el grupo "${groupName}"` });
        }
        numbers = contacts.map(c => ({
          number: c.phone,
          contactId: c.id,
          variables: {
            nombre: c.nombre || '',
            tratamiento: c.tratamiento || '',
            grupo: c.grupo || ''
          }
        }));
      } else {
        // Fuente CSV (comportamiento original)
        if (!req.files || !req.files['csvFile']) {
          return res.status(400).json({ error: 'Archivo CSV/TXT no proporcionado' });
        }
        
        const csvFilePath = req.files['csvFile'][0].path;
        const parsed = await loadNumbersFromCSV(csvFilePath, userCountry);
        invalidCount = parsed?.invalidCount || 0;
        duplicates = parsed?.duplicates || 0;
        
        if ((parsed?.numbers || []).length === 0) {
          return res.status(400).json({ error: 'No se encontraron números válidos' });
        }
        
        if (invalidCount > 0) {
          try { if (redisQueue && typeof redisQueue.cancelCampaign === 'function') await redisQueue.cancelCampaign(userId); } catch { }
          try { if (redisQueue && typeof redisQueue.clearList === 'function') await redisQueue.clearList(userId); } catch { }
          // Limpiar archivo
          if (fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
          return res.status(400).json({
            error: 'Se detectaron filas inválidas en el CSV. Envío cancelado.',
            invalidCount,
            duplicates,
            details: 'Verifique que los números estén en formato válido para su país (con o sin código de país)'
          });
        }
        
        if (duplicates > 0) {
          logger.info({ duplicates, unique: parsed.numbers.length }, 'Duplicados eliminados del CSV');
        }
        
        // Importar contactos y enriquecer
        const imported = await metricsStore.importContactsFromEntries(userId, parsed.numbers, 'csv');
        numbers = imported.entries || [];
        importSummary = imported.summary || null;
        
        // Limpiar archivo CSV
        if (fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
      }

      if (numbers.length === 0) {
        return res.status(400).json({ error: 'No se encontraron destinatarios válidos' });
      }

      let images = req.files['images'];
      let singleImage = req.files['singleImage'] ? req.files['singleImage'][0] : null;
      let audioFile = req.files['audioFile'] ? req.files['audioFile'][0] : null;

      // Extract templates from request body
      let templates = [];

      try {
        if (templatesJson) {
          templates = JSON.parse(templatesJson);
        } else if (message) {
          templates = [message];
        } else {
          for (let i = 1; i <= 5; i++) {
            const field = req.body?.[`message${i}`];
            if (typeof field === 'string' && field.trim()) {
              templates.push(field.trim());
            }
          }
        }
      } catch (e) {
        logger.error({ error: e.message }, 'Error parsing templates JSON');
        return res.status(400).json({ error: 'Formato de templates inválido' });
      }

      if (Array.isArray(templates)) {
        templates = templates
          .map((tpl) => (typeof tpl === 'string' ? tpl.trim() : tpl))
          .filter((tpl) => typeof tpl === 'string' && tpl.length > 0);
      }

      if (!audioFile && (!templates || !Array.isArray(templates) || templates.length === 0)) {
        return res.status(400).json({ error: 'Debes proporcionar al menos un template de mensaje' });
      }

      if (templates.length > 5) {
        return res.status(400).json({ error: 'Máximo 5 templates permitidos' });
      }

      for (let i = 0; i < templates.length; i++) {
        if (typeof templates[i] !== 'string' || templates[i].trim().length === 0) {
          return res.status(400).json({ error: `Template ${i + 1} está vacío o es inválido` });
        }
      }

      logger.info({
        userId,
        templateCount: templates.length,
        numbersCount: numbers.length,
        source
      }, 'Procesando envío con templates múltiples');

      // Crear campaña persistente
      const campaign = await metricsStore.createCampaign(userId, {
        name: campaignName || `Campaña ${new Date().toLocaleString()}`,
        totalRecipients: numbers.length,
        templateCount: templates.length,
      });
      await metricsStore.initCampaignRecipients(userId, campaign.id, numbers);

      // Si S3 está habilitado, subir imágenes y referenciarlas por s3Key
      try {
        const s3 = require('./storage/s3');
        if (s3.isEnabled()) {
          const userId = req.auth?.uid || 'default';
          const uploaded = [];
          if (Array.isArray(images)) {
            for (const img of images) {
              const key = s3.buildKey(userId, img.originalname || 'image');
              await s3.putObjectFromPath(key, img.path, img.mimetype);
              uploaded.push({ s3Key: key, mimetype: img.mimetype, originalname: img.originalname });
              try { if (img.path) require('fs').unlinkSync(img.path); } catch { }
            }
            images = uploaded;
          }
          if (singleImage) {
            const key = s3.buildKey(userId, singleImage.originalname || 'image');
            await s3.putObjectFromPath(key, singleImage.path, singleImage.mimetype);
            try { if (singleImage.path) require('fs').unlinkSync(singleImage.path); } catch { }
            singleImage = { s3Key: key, mimetype: singleImage.mimetype, originalname: singleImage.originalname };
          }
          if (audioFile) {
            const key = s3.buildKey(userId, audioFile.originalname || 'audio');
            await s3.putObjectFromPath(key, audioFile.path, audioFile.mimetype);
            try { if (audioFile.path) require('fs').unlinkSync(audioFile.path); } catch { }
            audioFile = { s3Key: key, mimetype: audioFile.mimetype, originalname: audioFile.originalname };
          }
        }
      } catch (e) {
        logger.error({ error: e.message, stack: e.stack }, 'Error al cargar archivos a S3');
        // Si el error es de credenciales o permisos, devolver error claro al usuario
        if (e.message && (e.message.includes('Access Key') || e.message.includes('credentials') || e.message.includes('forbidden'))) {
          throw new Error(`Error de almacenamiento: ${e.message}. Verifica las credenciales de MinIO.`);
        }
        logger.warn(`Carga a S3 omitida o fallida: ${e.message}`);
      }

      const useRedisQueue = (process.env.MESSAGE_QUEUE_BACKEND || 'redis').toLowerCase() === 'redis';
      if (useRedisQueue) {
        await redisQueue.enqueueCampaign(userId, numbers, templates, images, singleImage, audioFile, { campaignId: campaign.id, messageInterval });
        // Primer heartbeat tras encolar (para detectar refresh)
        if (typeof redisQueue.touchHeartbeat === 'function') {
          try { await redisQueue.touchHeartbeat(userId); } catch { }
        }
      } else {
        whatsappManager.updateActivity();
        await whatsappManager.messageQueue.add(numbers, templates[0], images, singleImage, audioFile);
      }

      res.json({
        status: 'success',
        message: 'Procesando mensajes',
        totalNumbers: numbers.length,
        templateCount: templates.length,
        campaignId: campaign.id,
        messageInterval,
        importSummary,
        duplicatesRemoved: duplicates,
        invalidNumbers: invalidCount,
        userId: req.auth?.uid,
        initialStats: useRedisQueue ? { total: numbers.length, sent: 0, errors: 0, messages: [], completed: false } : whatsappManager.messageQueue.getStats()
      });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /send-messages');
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/message-status', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const useRedisQueue = (process.env.MESSAGE_QUEUE_BACKEND || 'redis').toLowerCase() === 'redis';
      if (useRedisQueue) {
        const userId = req.auth?.uid || 'default';
        if (typeof redisQueue.touchHeartbeat === 'function') {
          try { await redisQueue.touchHeartbeat(userId); } catch { }
        }
        const getStatus = redisQueue.getStatusDetailed || redisQueue.getStatus;
        const stats = await getStatus(userId);
        return res.json(stats);
      } else {
        const whatsappManager = await sessionManager.getSessionByToken(req);
        if (!whatsappManager.messageQueue) {
          return res.json({ total: 0, sent: 0, errors: 0, messages: [], completed: true });
        }
        return res.json(whatsappManager.messageQueue.getStats());
      }
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /message-status');
      res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Contactos (alta manual + CRUD)
  // ---------------------------
  router.get('/contacts', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { search = '', group = '', page = 1, pageSize = 25 } = req.query || {};
      const data = await metricsStore.listContacts(userId, { search, group, page, pageSize });
      return res.json(data);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /contacts');
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/contacts', conditionalAuth, conditionalRole('sender_api'), requireLimit('contacts'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';

      const { phone, nombre, tratamiento, sustantivo, grupo } = req.body || {};
      const userCountry = req.userProfile?.country || 'PY';
      const phoneResult = normalizeNumber(phone, userCountry);
      const normalized = phoneResult.valid ? phoneResult.normalized : null;
      if (!normalized) {
        return res.status(400).json({ error: `Número inválido para ${userCountry}. Verifica el formato e intenta de nuevo.` });
      }

      const result = await metricsStore.upsertContact(userId, {
        phone: normalized,
        nombre: nombre || null,
        tratamiento: tratamiento || sustantivo || null,
        grupo: grupo || null,
      }, 'manual');
      return res.json({ success: true, created: result.created, contact: result.contact });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en POST /contacts');
      return res.status(500).json({ error: error.message });
    }
  });

  router.put('/contacts/:contactId', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { contactId } = req.params;
      const patch = { ...req.body };
      if (patch.phone !== undefined) {
        const userCountry = req.userProfile?.country || 'PY';
        const phoneResult = normalizeNumber(patch.phone, userCountry);
        if (!phoneResult.valid) {
          return res.status(400).json({ error: `Número inválido para ${userCountry}. Verifica el formato e intenta de nuevo.` });
        }
        patch.phone = phoneResult.normalized;
      }

      const updated = await metricsStore.updateContact(userId, contactId, patch);
      if (!updated) return res.status(404).json({ error: 'Contacto no encontrado' });
      return res.json({ success: true, contact: updated });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en PUT /contacts/:contactId');
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/contacts/:contactId', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { contactId } = req.params;
      const deleted = await metricsStore.deleteContact(userId, contactId);
      if (!deleted) return res.status(404).json({ error: 'Contacto no encontrado' });
      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en DELETE /contacts/:contactId');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Importar contactos desde CSV
  // ---------------------------
  router.post('/contacts/import', conditionalAuth, conditionalRole('sender_api'), requireLimit('contacts'), upload.single('csvFile'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      
      if (!req.file) {
        return res.status(400).json({ error: 'Archivo CSV no proporcionado' });
      }

      const csvFilePath = req.file.path;
      const { loadNumbersFromCSV } = require('./utils');
      const userCountry = req.userProfile?.country || 'PY';
      const parsed = await loadNumbersFromCSV(csvFilePath, userCountry);
      
      if (parsed.invalidRows && parsed.invalidRows.length > 0) {
        fs.unlinkSync(csvFilePath);
        return res.status(400).json({
          error: 'Se detectaron filas inválidas en el CSV.',
          invalidRows: parsed.invalidRows.slice(0, 10)
        });
      }

      const result = await metricsStore.importContactsFromEntries(userId, parsed.entries || [], 'csv');

      // Limpiar archivo temporal
      if (fs.existsSync(csvFilePath)) {
        fs.unlinkSync(csvFilePath);
      }

      logger.info({ userId, imported: result.summary }, 'Contactos importados desde CSV');
      return res.json({
        success: true,
        imported: result.summary.inserted,
        updated: result.summary.updated,
        total: result.summary.total
      });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en POST /contacts/import');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Obtener grupos de contactos
  // ---------------------------
  router.get('/contacts/groups', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const groups = await metricsStore.getContactGroups(userId);
      return res.json({ groups });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /contacts/groups');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/contacts/:contactId', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { contactId } = req.params;
      const contact = await metricsStore.getContactById(userId, contactId);
      if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });
      return res.json(contact);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /contacts/:contactId');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Dashboard analytics
  // ---------------------------
  router.get('/dashboard/summary', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { from, to } = req.query || {};
      const data = await metricsStore.dashboardSummary(userId, from, to);
      return res.json(data);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /dashboard/summary');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/dashboard/timeline', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { from, to, bucket = 'day' } = req.query || {};
      const data = await metricsStore.dashboardTimeline(userId, from, to, bucket);
      return res.json({ bucket, rows: data });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /dashboard/timeline');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/dashboard/by-group', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { from, to } = req.query || {};
      const rows = await metricsStore.dashboardByGroup(userId, from, to);
      return res.json({ rows });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /dashboard/by-group');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/dashboard/by-contact', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { from, to, limit = 20 } = req.query || {};
      const rows = await metricsStore.dashboardByContact(userId, from, to, Number(limit));
      return res.json({ rows });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /dashboard/by-contact');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/dashboard/current-month', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const data = await metricsStore.dashboardCurrentMonth(userId);
      return res.json(data);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /dashboard/current-month');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/dashboard/monthly', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { months = 12 } = req.query || {};
      const rows = await metricsStore.dashboardMonthly(userId, Number(months));
      return res.json({ rows });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /dashboard/monthly');
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /campaigns — paginated list with stats
  router.get('/campaigns', conditionalAuth, conditionalRole('sender_api'), requireFeature('campaigns'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20));
      const search = req.query.search || '';
      const dateFrom = req.query.dateFrom || null;
      const dateTo = req.query.dateTo || null;

      const result = await metricsStore.listCampaigns(userId, { page, pageSize, search, dateFrom, dateTo });
      return res.json(result);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /campaigns');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/campaigns/:id', conditionalAuth, conditionalRole('sender_api'), requireFeature('campaigns'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const detail = await metricsStore.getCampaignDetail(userId, req.params.id);
      if (!detail) return res.status(404).json({ error: 'Campaña no encontrada' });
      return res.json(detail);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /campaigns/:id');
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /campaigns/:id/responses — incoming messages from campaign contacts after campaign date
  router.get('/campaigns/:id/responses', conditionalAuth, conditionalRole('sender_api'), requireFeature('campaigns'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { db } = require('./firebaseAdmin');
      const chatbotEngine = require('./chatbotEngine');

      const campaignSnap = await db.collection(`users/${userId}/campaigns`).doc(req.params.id).get();
      if (!campaignSnap.exists) {
        return res.status(404).json({ error: 'Campaña no encontrada' });
      }
      const campaignData = campaignSnap.data();
      const campaignCreatedAt = campaignData.createdAt;
      const campaignId = campaignSnap.id;

      const recipientsSnap = await db.collection(`users/${userId}/campaigns/${campaignId}/recipients`).get();
      const phones = [];
      recipientsSnap.forEach(d => {
        const data = d.data();
        if (data.phone) phones.push(data.phone);
      });

      if (phones.length === 0) {
        return res.json({ responses: [], count: 0 });
      }

      const messages = [];
      const fromTime = campaignCreatedAt ? campaignCreatedAt.toDate() : new Date(0);

      // Firestore 'in' max 10 values — batch
      for (let i = 0; i < phones.length; i += 10) {
        const batch = phones.slice(i, i + 10);
        const snap = await db.collection(`users/${userId}/inboxMessages`)
          .where('contactPhone', 'in', batch)
          .get();
        snap.forEach(d => {
          const data = d.data();
          if (data.isFromContact !== true) return;
          const msgCreatedAt = data.createdAt ? data.createdAt.toDate() : new Date(0);
          if (msgCreatedAt >= fromTime) {
            messages.push({
              id: d.id,
              ...data,
              createdAt: data.createdAt ? data.createdAt.toMillis() : null,
            });
          }
        });
      }
      messages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      return res.json({
        responses: messages,
        count: messages.length
      });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /campaigns/:id/responses');
      return res.status(500).json({ error: error.message });
    }
  });

  // Cancelar campaña en curso o en espera (por usuario)
  router.post('/cancel-campaign', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const useRedisQueue = (process.env.MESSAGE_QUEUE_BACKEND || 'redis').toLowerCase() === 'redis';
      if (!useRedisQueue) {
        return res.status(400).json({ success: false, error: 'Cancelación soportada sólo con backend Redis' });
      }
      const userId = req.auth?.uid || 'default';
      const result = await redisQueue.cancelCampaign(userId);
      const status = await redisQueue.getStatus(userId);
      return res.json({ success: true, canceled: true, removedWaitingJobs: result.removed, status });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /cancel-campaign');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Heartbeat endpoint para mantener campaña activa
  router.post('/heartbeat', conditionalAuth, async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      await redisQueue.touchHeartbeat(userId);
      logger.debug({ userId }, 'Heartbeat recibido');
      return res.json({ success: true, timestamp: Date.now() });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /heartbeat');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  function setQrResponseHeaders(res) {
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }

  async function serveQrForUser(userId, res, manager = null) {
    const qrManager = manager || sessionManager.sessions?.get?.(userId);
    if (qrManager) {
      try {
        const qrBase64 = await qrManager.getQrBase64({ maxAgeMs: 2000 });
        if (qrBase64) {
          const base64Data = qrBase64.replace(/^data:image\/png;base64,/, '');
          const buf = Buffer.from(base64Data, 'base64');
          setQrResponseHeaders(res);
          return res.send(buf);
        }
      } catch {}
    }

    return null;
  }

  router.get('/qr', conditionalAuth, async (req, res) => {
    try {
      const userId = req.auth?.uid;
      if (!userId) {
        return res.status(401).json({ error: 'Usuario no autenticado' });
      }

      const whatsappManager = await sessionManager.getSessionByToken(req);

      if (whatsappManager.isReady) {
        return res.status(400).json({ error: 'Ya estás conectado a WhatsApp' });
      }

      // Try to serve existing QR immediately
      const quickServe = await serveQrForUser(userId, res, whatsappManager);
      if (quickServe) return;

      // Ensure session is initialized and WAHA is generating QR
      await sessionManager.initializeSession(userId);

      // Wait up to 15s for WAHA to generate QR
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (whatsappManager.isReady) {
          return res.status(400).json({ error: 'Ya estás conectado a WhatsApp' });
        }
        const served = await serveQrForUser(userId, res, whatsappManager);
        if (served) return;
      }

      return res.status(404).json({
        error: 'QR no disponible. Solicita un nuevo QR.',
        userId
      });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /qr');
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/qr-:userId.png', conditionalAuth, async (req, res) => {
    try {
      const requestedId = req.params.userId;
      const authUser = req.auth?.uid;

      if (!authUser) {
        return res.status(401).json({ error: 'Usuario no autenticado' });
      }

      if (requestedId !== authUser) {
        logger.warn({ authUser, requestedId }, 'Intento de acceso a QR de otro usuario');
        return res.status(403).json({ error: 'Forbidden' });
      }

      const manager = await sessionManager.getSession(requestedId);
      const served = await serveQrForUser(requestedId, res, manager);
      if (served) return;

      return res.status(404).json({
        error: 'QR no disponible. Solicita un nuevo QR.',
        userId: requestedId
      });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /qr-<userId>.png');
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/refresh-qr', conditionalAuth, async (req, res) => {
    try {
      const userId = req.auth?.uid;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
      }

      if (qrRefreshInProgress.has(userId)) {
        return res.status(429).json({
          success: false,
          message: 'Ya hay una operación de refresh en progreso',
          retryAfter: 3
        });
      }

      qrRefreshInProgress.set(userId, Date.now());
      setTimeout(() => qrRefreshInProgress.delete(userId), 30000);

      const whatsappManager = await sessionManager.getSessionByToken(req);

      if (whatsappManager.isReady) {
        qrRefreshInProgress.delete(userId);
        return res.status(400).json({ success: false, message: 'Ya estás conectado a WhatsApp' });
      }

      // Force clean re-initialize to get a new QR
      await whatsappManager.cleanInitialize();
      qrRefreshInProgress.delete(userId);
      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, message: 'Solicitando nuevo código QR...', qrUrl: '/qr' });
    } catch (e) {
      const userId = req.auth?.uid;
      if (userId) qrRefreshInProgress.delete(userId);
      logger.error({ err: e?.message, userId }, 'Error en refresh-qr');
      res.status(500).json({ success: false, message: e.message || 'Error al refrescar QR' });
    }
  });

  router.post('/cleanup', (req, res) => {
    cleanupOldFiles(retentionHours);
    res.json({ ok: true });
  });

  // ===== RUTAS ADMINISTRATIVAS PARA MULTI-SESIÓN =====

  // Listar todas las sesiones activas (solo para admins)
  router.get('/admin/sessions', conditionalAuth, conditionalRole('admin'), (req, res) => {
    try {
      const stats = sessionManager.getStats();
      res.json(stats);
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /admin/sessions');
      res.status(500).json({ error: error.message });
    }
  });

  // Cerrar sesión específica (solo para admins)
  router.post('/admin/sessions/:userId/close', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      const { userId } = req.params;
      await sessionManager.closeSession(userId);
      res.json({ success: true, message: `Sesión de usuario ${userId} cerrada` });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error cerrando sesión');
      res.status(500).json({ error: error.message });
    }
  });

  // Limpiar sesiones inactivas (solo para admins)
  router.post('/admin/cleanup-sessions', conditionalAuth, conditionalRole('admin'), (req, res) => {
    try {
      const { maxInactiveHours = 24 } = req.body;
      sessionManager.cleanupInactiveSessions(maxInactiveHours);
      res.json({ success: true, message: 'Limpieza de sesiones inactivas completada' });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en limpieza de sesiones');
      res.status(500).json({ error: error.message });
    }
  });

  // Limpieza de cola BullMQ (solo admin)
  router.post('/admin/queue/clean', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      const { type = 'completed', graceSec = 3600, limit = 1000, obliterate = false } = req.body || {};
      if (obliterate) {
        const r = await redisQueue.obliterateQueue(true);
        return res.json({ success: r.ok, result: r });
      }
      const result = await redisQueue.cleanQueue(type, Number(graceSec), Number(limit));
      res.json({ success: true, result });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /admin/queue/clean');
      res.status(500).json({ error: error.message });
    }
  });

  // Estado de mi propia sesión (detallado)
  router.get('/my-session', conditionalAuth, async (req, res) => {
    try {
      const whatsappManager = await sessionManager.getSessionByToken(req);
      const state = whatsappManager.getState();

      res.json({
        ...state,
        userId: req.auth?.uid,
        userName: req.auth?.name || req.auth?.email
      });
    } catch (error) {
      logger.error({ err: error?.message }, 'Error en /my-session');
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/logout-whatsapp', conditionalAuth, async (req, res) => {
    try {
      const userId = req.auth.uid;
      await clearSession(userId).catch(() => {});
      const result = await sessionManager.logoutByToken(req);
      return res.json({ success: true, message: 'Sesión de WhatsApp cerrada', ...result });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en logout-whatsapp');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/logout-status/:userId?', conditionalAuth, async (req, res) => {
    try {
      const userId = req.params.userId || req.auth.uid;
      if (userId !== req.auth.uid) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      const manager = await sessionManager.getSession(userId);
      if (!manager) {
        return res.json({ userId, connected: false, state: 'no_session' });
      }

      res.json({
        userId,
        connected: manager.isReady,
        state: manager.isReady ? 'connected' : 'disconnected',
        connectionState: manager.connectionState,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en logout-status');
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Reset cooldown (no-op with WAHA — no built-in rate limiting)
  router.post('/reset-cooldown', checkJwt, async (_req, res) => {
    res.json({ success: true, message: 'Cooldown reseteado' });
  });

  // Clear Redis auth state (no-op with WAHA — auth lives in WAHA server)
  router.post('/auth/clear-redis', conditionalAuth, async (req, res) => {
    res.json({ success: true, message: 'No es necesario limpiar caché con WAHA' });
  });

  // Limpiar caché de usuario (no-op con WAHA)
  router.delete('/cache/user', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid;
      logger.info({ userId }, 'Solicitud de limpieza de caché de usuario');

      res.json({
        success: true,
        message: 'Caché limpiado',
        deletedKeys: 0,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error limpiando caché de usuario');
      res.status(500).json({
        success: false,
        error: 'Error limpiando caché',
        details: error?.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------------------------
  // User profile (accessible even with expired trial)
  // ---------------------------
  router.get('/user/profile', conditionalAuthNoTrial, async (req, res) => {
    try {
      const profile = req.userProfile;
      if (!profile) {
        return res.json({
          uid: req.auth?.uid || 'default',
          email: req.auth?.email || '',
          displayName: req.auth?.name || '',
          photoURL: req.auth?.picture || null,
          plan: 'active',
          role: req.auth?.email === 'adolfo.andres.ayala@gmail.com' ? 'admin' : 'user',
          status: 'active',
          trialDaysLeft: 0,
          whatsappPhone: null,
          country: 'PY',
          createdAt: null
        });
      }

      // Calculate trialDaysLeft
      let trialDaysLeft = 0;
      if (profile.trialEndsAt) {
        const trialEnd = profile.trialEndsAt instanceof Date
          ? profile.trialEndsAt
          : (profile.trialEndsAt && profile.trialEndsAt.toDate
            ? profile.trialEndsAt.toDate()
            : new Date(profile.trialEndsAt));
        const msLeft = trialEnd.getTime() - Date.now();
        trialDaysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
      }

      return res.json({
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        photoURL: profile.photoURL || null,
        plan: profile.plan,
        role: profile.role,
        status: profile.status || 'active',
        trialDaysLeft,
        whatsappPhone: profile.whatsappPhone,
        country: profile.country || 'PY',
        createdAt: profile.createdAt
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en GET /user/profile');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // User: access capabilities for frontend display
  // ---------------------------
  router.get('/user/plan-features', conditionalAuthNoTrial, async (req, res) => {
    try {
      const profile = req.userProfile;
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      const plan = 'active';
      const role = profile.role;
      const features = getPlanFeatures(plan, role);

      // Gather usage stats
      const userId = req.auth?.uid || 'default';
      let usage = { sendThisMonth: 0, contactsTotal: 0, templatesTotal: 0 };

      try {
        const monthData = await metricsStore.dashboardCurrentMonth(userId);
        usage.sendThisMonth = (monthData && (monthData.sent || monthData.totalSent || 0)) || 0;
      } catch (e) {
        logger.warn({ err: e.message, userId }, 'Could not fetch monthly send count for plan-features');
      }

      try {
        const contactData = await metricsStore.listContacts(userId, { page: 1, pageSize: 1 });
        usage.contactsTotal = contactData.total || 0;
      } catch (e) {
        logger.warn({ err: e.message, userId }, 'Could not fetch contact count for plan-features');
      }

      try {
        const ft = require('./firestoreTemplates');
        usage.templatesTotal = await ft.getTemplateCount(userId);
      } catch (e) {
        logger.warn({ err: e.message, userId }, 'Could not fetch template count for plan-features');
      }

      return res.json({ plan, role: role || 'user', features, usage });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en GET /user/plan-features');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // User: API Key management (Profesional, Premium and Enterprise only)
  // ---------------------------
  router.post('/user/api-key', conditionalAuth, requireFeature('api'), async (req, res) => {
    try {
      const uid = req.auth?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthenticated' });

      const crypto = require('crypto');
      const apiKey = crypto.randomUUID();

      if (db) {
        await db.collection('users').doc(uid).set({ apiKey }, { merge: true });
        invalidateProfileCache(uid);
      }

      logger.info({ uid }, 'API key generated');
      return res.json({ success: true, apiKey });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en POST /user/api-key');
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/user/api-key', conditionalAuth, async (req, res) => {
    try {
      const uid = req.auth?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthenticated' });

      if (db) {
        await db.collection('users').doc(uid).set({ apiKey: null }, { merge: true });
        invalidateProfileCache(uid);
      }

      logger.info({ uid }, 'API key revoked');
      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en DELETE /user/api-key');
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/user/api-key', conditionalAuth, async (req, res) => {
    try {
      const uid = req.auth?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthenticated' });

      if (!db) {
        return res.json({ hasApiKey: false, apiKey: null });
      }

      const userRef = db.collection('users').doc(uid);
      const snap = await userRef.get();
      const data = snap.exists ? snap.data() : {};

      return res.json({
        hasApiKey: !!data.apiKey,
        apiKey: data.apiKey || null
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en GET /user/api-key');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Phone: supported countries
  // ---------------------------
  router.get('/phone/countries', conditionalAuth, (req, res) => {
    return res.json(getCountryConfigs());
  });

  // ---------------------------
  // User: set country
  // ---------------------------
  router.put('/user/country', conditionalAuthNoTrial, async (req, res) => {
    try {
      const uid = req.auth?.uid;
      if (!uid) return res.status(401).json({ error: 'Unauthenticated' });

      const { country } = req.body || {};
      const configs = getCountryConfigs();
      if (!country || !configs[country.toUpperCase()]) {
        return res.status(400).json({ error: 'País no soportado. Usa uno de: ' + Object.keys(configs).join(', ') });
      }

      const upperCountry = country.toUpperCase();

      if (db) {
        await db.collection('users').doc(uid).set({ country: upperCountry }, { merge: true });
        invalidateProfileCache(uid);
      }

      return res.json({ success: true, country: upperCountry });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en PUT /user/country');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: update user plan
  // ---------------------------
  router.put('/admin/users/:userId/plan', conditionalAuth, async (req, res) => {
    try {
      // Check admin role
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      const { userId } = req.params;
      const { plan, trialEndsAt } = req.body || {};

      const validPlans = ['active', 'trial', 'expired', 'basico', 'profesional', 'premium', 'enterprise'];
      if (!plan || !validPlans.includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan. Must be one of: ' + validPlans.join(', ') });
      }

      const updateData = { plan };
      if (trialEndsAt) {
        updateData.trialEndsAt = new Date(trialEndsAt);
      }

      const userRef = db.collection('users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'User not found' });
      }

      await userRef.update(updateData);
      invalidateProfileCache(userId);

      logger.info({ adminUid: req.auth.uid, targetUserId: userId, plan, trialEndsAt }, 'Admin updated user plan');

      const updated = (await userRef.get()).data();
      return res.json({
        success: true,
        user: {
          uid: userId,
          email: updated.email,
          plan: updated.plan,
          role: updated.role,
          trialEndsAt: updated.trialEndsAt
        }
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en PUT /admin/users/:userId/plan');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: unlink WhatsApp phone from user
  // ---------------------------
  router.delete('/admin/users/:userId/phone', conditionalAuth, async (req, res) => {
    try {
      // Check admin role
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      const { userId } = req.params;

      const userRef = db.collection('users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'User not found' });
      }

      const previousPhone = snap.data().whatsappPhone;

      // Clear phone in Firestore
      await userRef.update({ whatsappPhone: null });
      invalidateProfileCache(userId);

      // Disconnect WhatsApp session if active
      await sessionManager.logoutUser(userId).catch((logoutErr) => {
        logger.warn({ adminUid: req.auth.uid, targetUserId: userId, err: logoutErr?.message }, 'Error disconnecting user session during phone unlink');
      });

      logger.info({ adminUid: req.auth.uid, targetUserId: userId, previousPhone }, 'Admin unlinked WhatsApp phone');

      return res.json({
        success: true,
        message: 'WhatsApp phone unlinked successfully',
        previousPhone: previousPhone || null
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en DELETE /admin/users/:userId/phone');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: manual cleanup of a user's Redis data
  // ---------------------------
  router.post('/admin/users/:userId/cleanup', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      const { userId } = req.params;
      const keepAuth = req.body?.keepAuth === true;

      logger.info({ adminUid: req.auth.uid, targetUserId: userId, keepAuth }, 'Admin cleanup requested');

      const result = await redisQueue.cleanupUserData(userId, { keepAuth });

      return res.json({
        success: result.success,
        userId,
        keepAuth,
        deletedKeys: result.deletedKeys,
        deletedCount: result.deletedKeys.length,
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en POST /admin/users/:userId/cleanup');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: Redis key statistics
  // ---------------------------
  router.get('/admin/redis/stats', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      const stats = await redisQueue.getRedisKeyStats();
      return res.json({ success: true, ...stats });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en GET /admin/redis/stats');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: Orphan key scanner
  // ---------------------------
  router.get('/admin/redis/orphan-scan', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      const scanResult = await redisQueue.scanOrphanKeys();
      return res.json({
        success: true,
        totalUsersScanned: scanResult.totalUsersScanned,
        orphanCount: scanResult.orphans.length,
        activeCount: scanResult.active.length,
        orphans: scanResult.orphans.map(o => ({
          userId: o.userId,
          keyCount: o.keyCount,
          keys: o.keys,
        })),
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en GET /admin/redis/orphan-scan');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: Delete orphan keys (POST with orphan userIds)
  // ---------------------------
  router.post('/admin/redis/orphan-cleanup', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      // First scan, then optionally filter by provided userIds
      const scanResult = await redisQueue.scanOrphanKeys();
      let toDelete = scanResult.orphans;

      if (req.body?.userIds && Array.isArray(req.body.userIds)) {
        const allowed = new Set(req.body.userIds);
        toDelete = toDelete.filter(o => allowed.has(o.userId));
      }

      if (toDelete.length === 0) {
        return res.json({ success: true, message: 'No orphan keys to delete', totalDeleted: 0 });
      }

      const result = await redisQueue.deleteOrphanKeys(toDelete);
      return res.json({ success: true, ...result });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en POST /admin/redis/orphan-cleanup');
      return res.status(500).json({ error: error.message });
    }
  });

  // ══════════════════════════════════════════════════════
  // ADMIN: USER MANAGEMENT
  // ══════════════════════════════════════════════════════

  // ---------------------------
  // Admin: list all users
  // ---------------------------
  router.get('/admin/users', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Firestore not available' });
      }

      const snapshot = await db.collection('users').get();
      const users = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        users.push({
          uid: doc.id,
          email: data.email || '',
          displayName: data.displayName || '',
          plan: data.plan || 'trial',
          role: data.role || 'user',
          status: data.status || 'active',
          country: data.country || 'PY',
          whatsappPhone: data.whatsappPhone || null,
          createdAt: data.createdAt || null,
          trialEndsAt: data.trialEndsAt || null,
          lastLoginAt: data.lastLoginAt || null
        });
      });

      logger.info({ adminUid: req.auth.uid, userCount: users.length }, 'Admin listed all users');
      return res.json({ users });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en GET /admin/users');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: change user status (active/suspended/disabled)
  // ---------------------------
  router.put('/admin/users/:userId/status', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Firestore not available' });
      }

      const { userId } = req.params;
      const { status, reason } = req.body || {};

      const validStatuses = ['active', 'suspended', 'disabled'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be one of: active, suspended, disabled' });
      }

      // Prevent self-suspension
      if (userId === req.auth.uid && status !== 'active') {
        return res.status(400).json({ error: 'Cannot suspend or disable your own account' });
      }

      const userRef = db.collection('users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updateData = {
        status,
        statusChangedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusChangedBy: req.auth.uid
      };
      if (reason) {
        updateData.statusReason = reason;
      }

      await userRef.update(updateData);
      invalidateProfileCache(userId);

      // If suspending/disabling, close their active session
      if (status !== 'active') {
        await sessionManager.logoutUser(userId).catch((sessionErr) => {
          logger.warn({ adminUid: req.auth.uid, targetUserId: userId, err: sessionErr?.message }, 'Error disconnecting session during status change');
        });
      }

      logger.info({ adminUid: req.auth.uid, targetUserId: userId, status, reason }, 'Admin changed user status');

      const updated = (await userRef.get()).data();
      return res.json({
        success: true,
        user: {
          uid: userId,
          email: updated.email,
          status: updated.status,
          statusChangedAt: updated.statusChangedAt,
          statusReason: updated.statusReason || null
        }
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en PUT /admin/users/:userId/status');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: change user role
  // ---------------------------
  router.put('/admin/users/:userId/role', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Firestore not available' });
      }

      const { userId } = req.params;
      const { role } = req.body || {};

      const validRoles = ['user', 'admin'];
      if (!role || !validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be one of: user, admin' });
      }

      // Prevent self-demotion
      if (userId === req.auth.uid && role !== 'admin') {
        return res.status(400).json({ error: 'Cannot remove admin role from your own account' });
      }

      const userRef = db.collection('users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'User not found' });
      }

      await userRef.update({ role });
      invalidateProfileCache(userId);

      logger.info({ adminUid: req.auth.uid, targetUserId: userId, role }, 'Admin changed user role');

      const updated = (await userRef.get()).data();
      return res.json({
        success: true,
        user: {
          uid: userId,
          email: updated.email,
          role: updated.role
        }
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en PUT /admin/users/:userId/role');
      return res.status(500).json({ error: error.message });
    }
  });

  // ---------------------------
  // Admin: delete user completely
  // ---------------------------
  router.delete('/admin/users/:userId', conditionalAuth, conditionalRole('admin'), async (req, res) => {
    try {
      if (!req.userProfile || req.userProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Firestore not available' });
      }

      const { userId } = req.params;

      // Prevent self-deletion
      if (userId === req.auth.uid) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }

      const userRef = db.collection('users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userData = snap.data();

      // Disconnect WhatsApp session if active
      await sessionManager.logoutUser(userId).catch((sessionErr) => {
        logger.warn({ targetUserId: userId, err: sessionErr?.message }, 'Error disconnecting session during user deletion');
      });

      // Clean up Redis data
      try {
        await redisQueue.cleanupUserData(userId, { keepAuth: false });
      } catch (redisErr) {
        logger.warn({ targetUserId: userId, err: redisErr?.message }, 'Error cleaning Redis data during user deletion');
      }

      // Delete from Firestore
      await userRef.delete();
      invalidateProfileCache(userId);

      // Optionally disable Firebase Auth account
      if (auth) {
        try {
          await auth.updateUser(userId, { disabled: true });
          logger.info({ targetUserId: userId }, 'Firebase Auth account disabled');
        } catch (authErr) {
          // User might not exist in Firebase Auth (e.g., dev mode)
          logger.warn({ targetUserId: userId, err: authErr?.message }, 'Could not disable Firebase Auth account');
        }
      }

      logger.info({ adminUid: req.auth.uid, targetUserId: userId, email: userData.email }, 'Admin deleted user');

      return res.json({
        success: true,
        message: 'User deleted successfully',
        deletedUser: {
          uid: userId,
          email: userData.email
        }
      });
    } catch (error) {
      logger.error({ err: error?.message, uid: req.auth?.uid }, 'Error en DELETE /admin/users/:userId');
      return res.status(500).json({ error: error.message });
    }
  });

  // ══════════════════════════════════════════════════════
  // TEMPLATES CRUD
  // ══════════════════════════════════════════════════════

  // Auto-create templates table if it doesn't exist
  const ft = require('./firestoreTemplates');

  // GET /templates — list all templates for the current user
  router.get('/templates', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { category } = req.query || {};
      const templates = await ft.listTemplates(userId, category);
      return res.json({ templates });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /templates');
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /templates — create a new template
  router.post('/templates', conditionalAuth, conditionalRole('sender_api'), requireLimit('templates'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';

      const { name, content, category, variables } = req.body || {};

      if (!name || !content) {
        return res.status(400).json({ error: 'Nombre y contenido son requeridos' });
      }

      const template = await ft.createTemplate(userId, name.trim(), content.trim(), category?.trim() || null, variables || null);
      return res.json({ success: true, template });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en POST /templates');
      return res.status(500).json({ error: error.message });
    }
  });

  // PUT /templates/:id — update a template
  router.put('/templates/:id', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { id } = req.params;
      const { name, content, category, variables } = req.body || {};

      if (!name || !content) {
        return res.status(400).json({ error: 'Nombre y contenido son requeridos' });
      }

      const template = await ft.updateTemplate(userId, id, name.trim(), content.trim(), category?.trim() || null, variables || null);
      if (!template) {
        return res.status(404).json({ error: 'Plantilla no encontrada' });
      }

      return res.json({ success: true, template });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en PUT /templates/:id');
      return res.status(500).json({ error: error.message });
    }
  });

  // DELETE /templates/:id — delete a template
  router.delete('/templates/:id', conditionalAuth, conditionalRole('sender_api'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { id } = req.params;

      const deleted = await ft.deleteTemplate(userId, id);
      if (!deleted) {
        return res.status(404).json({ error: 'Plantilla no encontrada' });
      }

      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en DELETE /templates/:id');
      return res.status(500).json({ error: error.message });
    }
  });

  // ══════════════════════════════════════════════════════
  // CHATBOT CONFIGURATION & FLOW
  // ══════════════════════════════════════════════════════

  const chatbotEngine = require('./chatbotEngine');
  const fc = require('./firestoreChatbot');

  // GET /chatbot/config — get user's chatbot config
  router.get('/chatbot/config', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const config = await fc.getConfig(userId);
      return res.json({ config });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /chatbot/config');
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /chatbot/config — create initial config
  router.post('/chatbot/config', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';

      const existing = await fc.getConfig(userId);
      if (existing) {
        return res.status(409).json({ error: 'Config already exists. Use PUT to update.' });
      }

      const {
        name, enabled, active_hours_start, active_hours_end, active_days,
        cooldown_minutes, only_known_contacts, max_responses_per_contact,
        ai_enabled, ai_provider, ai_api_key, ai_model, ai_system_prompt,
        welcome_message, fallback_message, bot_mode
      } = req.body || {};

      const encryptedKey = ai_api_key ? chatbotEngine.encrypt(ai_api_key) : null;

      const config = await fc.createConfig(userId, {
        name, enabled, active_hours_start, active_hours_end, active_days,
        cooldown_minutes, only_known_contacts, max_responses_per_contact,
        ai_enabled, ai_provider, ai_api_key_encrypted: encryptedKey, ai_model, ai_system_prompt,
        welcome_message, fallback_message, bot_mode
      });

      chatbotEngine.invalidateConfigCache(userId);
      return res.json({ success: true, config });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en POST /chatbot/config');
      return res.status(500).json({ error: error.message });
    }
  });

  // PUT /chatbot/config — update config
  router.put('/chatbot/config', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';

      const fields = { ...req.body };

      // Handle API key specially (encrypt)
      if (fields.ai_api_key !== undefined) {
        fields.ai_api_key = fields.ai_api_key ? chatbotEngine.encrypt(fields.ai_api_key) : null;
      }

      const config = await fc.updateConfig(userId, fields);
      if (!config) {
        return res.status(404).json({ error: 'Config not found. Use POST to create.' });
      }

      chatbotEngine.invalidateConfigCache(userId);
      return res.json({ success: true, config });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en PUT /chatbot/config');
      return res.status(500).json({ error: error.message });
    }
  });

  // ── Flow nodes ──

  // GET /chatbot/nodes — get all nodes for user's chatbot
  router.get('/chatbot/nodes', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { nodes, configId } = await fc.getNodes(userId);
      return res.json({ nodes, config_id: configId });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /chatbot/nodes');
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /chatbot/nodes — create/update nodes (batch — send entire flow)
  router.post('/chatbot/nodes', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';

      const { nodes } = req.body || {};
      if (!Array.isArray(nodes)) {
        return res.status(400).json({ error: 'nodes must be an array' });
      }

      const result = await fc.replaceNodes(userId, nodes);

      chatbotEngine.invalidateNodesCache(userId);
      return res.json({ success: true, nodes: result });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en POST /chatbot/nodes');
      return res.status(500).json({ error: error.message });
    }
  });

  // DELETE /chatbot/nodes/:nodeId — delete a single node
  router.delete('/chatbot/nodes/:nodeId', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { nodeId } = req.params;

      const deleted = await fc.deleteNode(userId, nodeId);
      if (!deleted) {
        return res.status(404).json({ error: 'Node not found' });
      }

      chatbotEngine.invalidateNodesCache(userId);
      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en DELETE /chatbot/nodes/:nodeId');
      return res.status(500).json({ error: error.message });
    }
  });

  // ── Conversations ──

  // GET /chatbot/conversations — list active conversations
  router.get('/chatbot/conversations', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const conversations = await fc.listConversations(userId);
      return res.json({ conversations });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /chatbot/conversations');
      return res.status(500).json({ error: error.message });
    }
  });

  // PUT /chatbot/conversations/:phone/deactivate — manually deactivate bot for a contact
  router.put('/chatbot/conversations/:phone/deactivate', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      await chatbotEngine.ensureChatbotTables();
      const userId = req.auth?.uid || 'default';
      const { phone } = req.params;

      await chatbotEngine.deactivateConversation(userId, phone);
      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en PUT /chatbot/conversations/:phone/deactivate');
      return res.status(500).json({ error: error.message });
    }
  });

  // DELETE /chatbot/conversations/:phone — reset conversation
  router.delete('/chatbot/conversations/:phone', conditionalAuth, conditionalRole('sender_api'), requireFeature('chatbot'), async (req, res) => {
    try {
      await chatbotEngine.ensureChatbotTables();
      const userId = req.auth?.uid || 'default';
      const { phone } = req.params;

      await chatbotEngine.resetConversation(userId, phone);
      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en DELETE /chatbot/conversations/:phone');
      return res.status(500).json({ error: error.message });
    }
  });

  // ══════════════════════════════════════════════════════
  // INBOX — Incoming messages
  // ══════════════════════════════════════════════════════

  // GET /messages/inbox — paginated conversations grouped by contact
  router.get('/messages/inbox', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

      const { conversations, total } = await fc.getInboxConversations(userId, page, limit);

      return res.json({
        conversations,
        pagination: { page, limit, total },
      });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /messages/inbox');
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /messages/inbox/unread — count of unread conversations
  router.get('/messages/inbox/unread', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const result = await fc.getInboxUnreadCount(userId);
      return res.json(result);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /messages/inbox/unread');
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /messages/inbox/:phone — messages with a specific contact
  router.get('/messages/inbox/:phone', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { phone } = req.params;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

      const messages = await fc.getInboxMessages(userId, phone, page, limit);
      return res.json({ messages });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /messages/inbox/:phone');
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /messages/inbox/:phone/reply — send reply (marks as human intervention)
  router.post('/messages/inbox/:phone/reply', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      await chatbotEngine.ensureChatbotTables();
      const userId = req.auth?.uid || 'default';
      const { phone } = req.params;
      const { message } = req.body || {};

      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
      }

      // Get WhatsApp session
      const manager = await sessionManager.getSession(userId);
      if (!manager || !manager.isReady) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
      }

      // Send via WAHA API
      const chatId = waha.toChatId(phone);
      await waha.sendText(chatId, message.trim());

      // Record as human intervention (deactivates bot for 30min for this contact)
      await chatbotEngine.recordOutgoingMessage(userId, phone, message.trim());

      return res.json({ success: true });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en POST /messages/inbox/:phone/reply');
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /messages/inbox/:phone/bot-status — get bot status for a contact
  router.get('/messages/inbox/:phone/bot-status', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { phone } = req.params;
      const status = await chatbotEngine.getBotStatusForContact(userId, phone);
      return res.json(status);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en GET /messages/inbox/:phone/bot-status');
      return res.status(500).json({ error: error.message });
    }
  });

  // PUT /messages/inbox/:phone/pause-bot — pause bot for a contact
  router.put('/messages/inbox/:phone/pause-bot', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { phone } = req.params;
      await chatbotEngine.pauseBotForContact(userId, phone);
      return res.json({ success: true, bot_paused: true });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en PUT /messages/inbox/:phone/pause-bot');
      return res.status(500).json({ error: error.message });
    }
  });

  // PUT /messages/inbox/:phone/resume-bot — resume bot for a contact
  router.put('/messages/inbox/:phone/resume-bot', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      const userId = req.auth?.uid || 'default';
      const { phone } = req.params;
      await chatbotEngine.resumeBotForContact(userId, phone);
      return res.json({ success: true, bot_paused: false });
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en PUT /messages/inbox/:phone/resume-bot');
      return res.status(500).json({ error: error.message });
    }
  });

  // DELETE /messages/inbox/:phone — delete chat history from DB (not from WhatsApp)
  router.delete('/messages/inbox/:phone', conditionalAuth, conditionalRole('sender_api'), requireFeature('inbox'), async (req, res) => {
    try {
      const userId = req.auth.uid;
      const phone = req.params.phone;
      if (!phone) return res.status(400).json({ error: 'Phone required' });

      const result = await fc.deleteMessagesAndConversation(userId, phone);
      logger.info({ userId, phone, deletedMessages: result.deletedMessages }, 'Inbox chat deleted');
      return res.json(result);
    } catch (error) {
      logger.error({ err: error?.message, userId: req.auth?.uid }, 'Error en DELETE /messages/inbox/:phone');
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { buildRoutes };
