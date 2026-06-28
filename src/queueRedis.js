const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const sessionManager = require('./sessionManager');
const { messageDelay, tempDir } = require('./config');
const { convertAudioToOpus } = require('./media');
const metricsStore = require('./metricsStore');
const waha = require('./wahaClient');
const s3 = require('./storage/s3');

const delayFactor = Math.max(0.5, Number(process.env.MESSAGE_DELAY_FACTOR || 1));
const BASE_DELAY = Math.max(2000, Math.floor(messageDelay * delayFactor));
const SEND_BETWEEN_MS = BASE_DELAY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function jitter(ms) {
  const variance = Math.floor(ms * 0.3);
  return ms + Math.floor(Math.random() * variance * 2) - variance;
}

const activeCampaigns = new Map();
const campaignStatus = new Map();

const ALLOWED_INTERVALS = [3, 5, 8, 12, 15];
const DEFAULT_INTERVAL = 5;

function getValidInterval(value) {
  const num = Number(value);
  return ALLOWED_INTERVALS.includes(num) ? num : DEFAULT_INTERVAL;
}

function validateNumbersArray(numbers) {
  if (!Array.isArray(numbers)) return { valid: false, invalidCount: 1 };
  let invalid = 0;
  for (const entry of numbers) {
    const n = String(typeof entry === 'string' ? entry : entry?.number || '').trim();
    const onlyDigits = /^\d+$/.test(n);
    const validLength = n.length >= 10 && n.length <= 15;
    if (!onlyDigits || !validLength) invalid++;
  }
  return { valid: invalid === 0, invalidCount: invalid };
}

function processMessageVariables(message, variables) {
  if (!message) return message;
  let processedMessage = message;
  if (variables && Object.keys(variables).length > 0) {
    Object.entries(variables).forEach(([key, value]) => {
      if (value) {
        const placeholder = `{${key}}`;
        const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'gi');
        processedMessage = processedMessage.replace(regex, value);
      }
    });
  }
  processedMessage = processedMessage.replace(/\{[^}\n]+\}/g, '');
  processedMessage = processedMessage.replace(/\r\n/g, '\n');
  processedMessage = processedMessage.replace(/[ \t]+\n/g, '\n');
  processedMessage = processedMessage.replace(/\n[ \t]+/g, '\n');
  processedMessage = processedMessage.replace(/[ \t]{2,}/g, ' ');
  processedMessage = processedMessage.replace(/[ \t]+$/gm, '');
  processedMessage = processedMessage.trim();
  return processedMessage;
}

async function getImageBufferCached(cache, img) {
  if (!img) return null;
  const key = img.s3Key ? `s3:${img.s3Key}` : (img.path ? `fs:${img.path}` : null);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  let buf;
  if (img.s3Key) {
    buf = await s3.getObjectBuffer(img.s3Key);
  } else if (img.path && fs.existsSync(img.path)) {
    buf = fs.readFileSync(img.path);
  } else {
    throw new Error(`Archivo de imagen no encontrado${img.path ? ': ' + img.path : ''}`);
  }
  cache.set(key, buf);
  return buf;
}

async function ensureConvertedAudio(userId, audio) {
  if (!audio || !audio.s3Key) return null;
  const origKey = audio.s3Key;
  const convKey = origKey.replace(/(\.[^./]+)?$/, '-converted.m4a');

  logger.info({ userId, origKey, convKey }, 'Procesando audio desde S3');

  try {
    const exists = await s3.existsObject(convKey);
    if (exists) {
      logger.info({ userId, convKey }, 'Audio convertido ya existe en S3');
      return { s3Key: convKey, mimetype: 'audio/mp4' };
    }
  } catch (err) {
    logger.warn({ userId, error: err.message }, 'Error verificando audio convertido existente');
  }

  logger.info({ userId, origKey }, 'Descargando audio original de S3...');
  const localOrig = path.join(tempDir, `audio_download_${userId}_${Date.now()}`);
  const localConv = await (async () => {
    const buf = await s3.getObjectBuffer(origKey);
    logger.info({ userId, size: buf.length }, 'Audio descargado de S3');
    fs.writeFileSync(localOrig, buf);
    try {
      logger.info({ userId, localOrig }, 'Convirtiendo audio...');
      const out = await convertAudioToOpus(localOrig, userId);
      const convBuf = fs.readFileSync(out);
      logger.info({ userId, convKey, size: convBuf.length }, 'Subiendo audio convertido a S3...');
      await s3.putObjectFromBuffer(convKey, convBuf, 'audio/mp4');
      logger.info({ userId, convKey }, 'Audio convertido subido exitosamente');
      try { fs.unlinkSync(out); } catch { }
      return out;
    } finally {
      try { fs.unlinkSync(localOrig); } catch { }
    }
  })();
  try { if (localConv && fs.existsSync(localConv)) fs.unlinkSync(localConv); } catch { }
  return { s3Key: convKey, mimetype: 'audio/mp4' };
}

async function buildWahaFilePayload(img) {
  if (!img) return null;
  if (img.s3Key) {
    const buf = await s3.getObjectBuffer(img.s3Key);
    return { mimetype: img.mimetype || 'image/jpeg', filename: img.originalname || 'file', data: buf.toString('base64') };
  }
  if (img.path && fs.existsSync(img.path)) {
    const buf = fs.readFileSync(img.path);
    return { mimetype: img.mimetype || 'image/jpeg', filename: img.originalname || 'file', data: buf.toString('base64') };
  }
  if (img.url) {
    return { mimetype: img.mimetype || 'image/jpeg', filename: img.filename || 'file', url: img.url };
  }
  if (img.data) return img;
  return null;
}

function initStatus(userId, total, messageInterval) {
  const st = {
    total,
    sent: 0,
    errors: 0,
    completed: false,
    canceled: false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    messageInterval,
  };
  campaignStatus.set(userId, st);
  return st;
}

function getStatus(userId) {
  const st = campaignStatus.get(userId);
  if (!st) {
    return { total: 0, sent: 0, errors: 0, completed: true, canceled: false, messages: [] };
  }
  return {
    total: st.total,
    sent: st.sent,
    errors: st.errors,
    completed: st.completed,
    canceled: st.canceled,
    startedAt: st.startedAt,
    updatedAt: st.updatedAt,
    finishedAt: st.finishedAt,
    messages: [],
  };
}

async function getStatusDetailed(userId) {
  const st = campaignStatus.get(userId);
  if (!st) {
    return { total: 0, sent: 0, errors: 0, completed: true, canceled: false, messages: [], inProgress: false, queue: { waiting: 0, active: 0 }, etaSeconds: 0, state: 'idle' };
  }
  const remaining = Math.max(0, st.total - st.sent - st.errors);
  const eta = remaining * Math.ceil((st.messageInterval || SEND_BETWEEN_MS) / 1000);
  const active = activeCampaigns.has(userId) && !st.completed && !st.canceled;
  const state = st.canceled ? 'canceled' : (st.completed ? 'completed' : (active ? 'running' : 'idle'));
  return {
    total: st.total,
    sent: st.sent,
    errors: st.errors,
    completed: st.completed,
    canceled: st.canceled,
    startedAt: st.startedAt || null,
    updatedAt: st.updatedAt || null,
    finishedAt: st.finishedAt || null,
    progress: active ? { sent: st.sent, total: st.total, status: 'sending', updatedAt: Date.now() } : null,
    queue: { waiting: 0, active: active ? 1 : 0 },
    inProgress: active,
    etaSeconds: eta,
    state,
    messages: [],
  };
}

async function enqueueCampaign(userId, numbers, templates, images, singleImage, audio, meta = {}) {
  const messageInterval = getValidInterval(meta?.messageInterval) * 1000;
  const st = initStatus(userId, numbers.length, messageInterval);

  const result = { jobId: `mem-${userId}-${Date.now()}` };

  activeCampaigns.set(userId, {
    userId, numbers, templates, images, singleImage, audio,
    campaignId: meta?.campaignId || null,
    messageInterval,
  });

  logger.info({ userId, total: numbers.length, templateCount: templates?.length }, 'Enqueueing campaign (in-memory)');

  processCampaignInBackground(userId);

  return result;
}

async function processCampaignInBackground(userId) {
  const entry = activeCampaigns.get(userId);
  if (!entry) return;

  const { numbers, templates, images, singleImage, audio, campaignId, messageInterval: sendBetween } = entry;
  let manager;

  try {
    const st = campaignStatus.get(userId);
    if (!st || st.canceled) {
      logger.warn({ userId }, 'Campaign already canceled before start');
      if (campaignId) {
        try { await metricsStore.setCampaignStatus(userId, campaignId, 'canceled'); } catch { }
      }
      return;
    }

    manager = await sessionManager.getSession(userId);
    if (!manager || !manager.isReady) {
      await sessionManager.initializeSession(userId);
      manager = await sessionManager.getSession(userId);
    }
    if (!manager || !manager.isReady) throw new Error('WhatsApp session no está lista');

    if (campaignId) {
      try { await metricsStore.setCampaignStatus(userId, campaignId, 'running', { startedAt: Date.now() }); } catch { }
    }

    const numCheck = validateNumbersArray(numbers);
    if (!numCheck.valid) {
      logger.warn({ userId, invalidCount: numCheck.invalidCount }, 'Lista con números inválidos; cancelando campaña');
      st.canceled = true;
      if (campaignId) {
        try { await metricsStore.setCampaignStatus(userId, campaignId, 'canceled'); } catch { }
      }
      return;
    }

    if (!Array.isArray(templates) || templates.length === 0 || templates.length > 5) {
      logger.warn({ userId, templateCount: templates?.length }, 'Templates inválidos; cancelando campaña');
      st.canceled = true;
      if (campaignId) {
        try { await metricsStore.setCampaignStatus(userId, campaignId, 'canceled'); } catch { }
      }
      return;
    }

    const hasValidTemplate = templates.some(t => t && t.trim().length > 0);
    if (!hasValidTemplate && !singleImage && !(images && images.length) && !audio) {
      logger.warn({ userId }, 'Contenido inválido (sin mensaje ni media); cancelando campaña');
      st.canceled = true;
      if (campaignId) {
        try { await metricsStore.setCampaignStatus(userId, campaignId, 'canceled'); } catch { }
      }
      return;
    }

    logger.info({ userId, templateCount: templates.length, numbersCount: numbers.length }, 'Iniciando campaña con WAHA');

    const imageCache = new Map();
    let convertedAudio = null;
    if (audio && audio.s3Key) {
      try {
        convertedAudio = await ensureConvertedAudio(userId, audio);
      } catch (err) {
        logger.error({ userId, error: err.message }, 'Error procesando audio desde S3');
        throw new Error(`Error al procesar audio: ${err.message}`);
      }
    }

    if (manager && typeof manager.setActiveCampaign === 'function') {
      manager.setActiveCampaign(true);
    }

    for (let i = 0; i < numbers.length; i++) {
      if (st.canceled) {
        logger.warn({ userId, index: i }, 'Cancelación detectada durante campaña; abortando');
        break;
      }

      const entryNum = numbers[i];
      const number = typeof entryNum === 'string' ? entryNum : entryNum.number;
      const variables = typeof entryNum === 'object' && entryNum.variables ? entryNum.variables : {};

      const templateIndex = i % templates.length;
      const currentTemplate = templates[templateIndex];

      logger.debug({ lineIndex: i + 1, templateIndex: templateIndex + 1, totalTemplates: templates.length, number }, 'Usando template para línea');

      st.updatedAt = Date.now();

      const processedMessage = processMessageVariables(currentTemplate, variables || {});
      const chatId = waha.toChatId(number);

      let retries = 0;
      const MAX_RETRIES = 3;
      let success = false;

      while (retries <= MAX_RETRIES && !success) {
        try {
          if (!manager || !manager.isReady) {
            throw new Error('Connection not ready');
          }

          if (convertedAudio) {
            const buf = await s3.getObjectBuffer(convertedAudio.s3Key);
            const filePayload = { mimetype: 'audio/ogg; codecs=opus', filename: 'audio.ogg', data: buf.toString('base64') };
            await waha.sendVoice(chatId, filePayload, false);
            if (processedMessage) {
              await sleep(jitter(sendBetween));
              await waha.sendText(chatId, processedMessage);
            }
          } else if (singleImage) {
            const filePayload = await buildWahaFilePayload(singleImage);
            await waha.sendImage(chatId, filePayload, processedMessage || '');
          } else if (images && images.length > 0) {
            for (let k = 0; k < images.length; k++) {
              const filePayload = await buildWahaFilePayload(images[k]);
              await waha.sendImage(chatId, filePayload, k === 0 ? (processedMessage || '') : '');
              if (k < images.length - 1) await sleep(jitter(sendBetween));
            }
          } else if (processedMessage) {
            await waha.sendText(chatId, processedMessage);
          } else {
            throw new Error('No se proporcionó contenido');
          }

          st.sent++;
          if (campaignId) {
            try {
              await metricsStore.recordRecipientStatus(userId, campaignId, entryNum, 'sent', {
                templateIndex: templateIndex + 1,
                attempts: retries + 1,
                timestamp: Date.now(),
              });
            } catch { }
          }
          success = true;

        } catch (err) {
          retries++;
          const isConnectionError = err?.message?.includes('Connection') || err?.message?.includes('Socket') || err?.message?.includes('not ready') || err?.message?.includes('WORKING');

          if (isConnectionError && retries <= MAX_RETRIES) {
            logger.warn(`Error de conexión enviando a ${number} (intento ${retries}/${MAX_RETRIES}): ${err?.message}. Reintentando en 5s...`);
            await sleep(5000);
            if (manager && typeof manager.ensureConnection === 'function') {
              try { await manager.ensureConnection(); } catch (reconErr) {
                logger.error(`Error al reconectar: ${reconErr?.message}`);
              }
            }
          } else {
            logger.warn(`Error enviando a ${number} (${retries} intentos): ${err?.message}`);
            st.errors++;
            if (campaignId) {
              try {
                await metricsStore.recordRecipientStatus(userId, campaignId, entryNum, 'error', {
                  errorMessage: err?.message || 'Error desconocido',
                  templateIndex: templateIndex + 1,
                  attempts: retries,
                  timestamp: Date.now(),
                });
              } catch { }
            }
            break;
          }
        }
      }

      await sleep(jitter(sendBetween));
    }

    if (st.canceled) {
      st.completed = true;
      st.finishedAt = Date.now();
      if (campaignId) {
        try { await metricsStore.setCampaignStatus(userId, campaignId, 'canceled'); } catch { }
      }
    } else {
      st.completed = true;
      st.finishedAt = Date.now();
      if (campaignId) {
        try { await metricsStore.setCampaignStatus(userId, campaignId, 'completed'); } catch { }
      }
    }

    if (manager && typeof manager.setActiveCampaign === 'function') {
      manager.setActiveCampaign(false);
    }

    try {
      if (s3.isEnabled() && s3.shouldDeleteAfterSend()) {
        if (Array.isArray(images)) {
          for (const img of images) if (img?.s3Key) await s3.deleteObject(img.s3Key);
        }
        if (singleImage?.s3Key) await s3.deleteObject(singleImage.s3Key);
        if (convertedAudio?.s3Key) await s3.deleteObject(convertedAudio.s3Key);
        if (audio?.s3Key) await s3.deleteObject(audio.s3Key);
      }
    } catch { }
  } catch (err) {
    logger.error({ userId, error: err?.message }, 'Campaign failed');
    const st = campaignStatus.get(userId);
    if (st) {
      st.completed = true;
      st.finishedAt = Date.now();
    }
    if (campaignId) {
      try { await metricsStore.setCampaignStatus(userId, campaignId, 'failed'); } catch { }
    }
    if (manager && typeof manager.setActiveCampaign === 'function') {
      manager.setActiveCampaign(false);
    }
  } finally {
    activeCampaigns.delete(userId);
  }
}

async function cancelCampaign(userId) {
  const st = campaignStatus.get(userId);
  if (st) {
    st.canceled = true;
    st.completed = true;
    st.finishedAt = Date.now();
  }
  activeCampaigns.delete(userId);
  return { removed: 1 };
}

async function cleanupUserData(userId, options = {}) {
  campaignStatus.delete(userId);
  activeCampaigns.delete(userId);
  return { success: true, deletedKeys: [] };
}

async function removeUserJobs(userId) {
  campaignStatus.delete(userId);
  activeCampaigns.delete(userId);
  return 0;
}

async function saveList(userId, numbers) {
  return;
}

async function clearList(userId) {
  return;
}

async function touchHeartbeat(userId) {
  return;
}

async function closeWorker() {
  activeCampaigns.clear();
  campaignStatus.clear();
}

async function cleanQueue(type = 'completed', graceSec = 3600, limit = 1000) {
  return { cleaned: 0, type };
}

async function obliterateQueue(force = true) {
  activeCampaigns.clear();
  campaignStatus.clear();
  return { ok: true };
}

async function getQueueSize() {
  return { active: activeCampaigns.size };
}

async function getQueueCounts() {
  return { waiting: 0, active: activeCampaigns.size, completed: 0, failed: 0 };
}

async function getQueueStatus() {
  const campaigns = [];
  for (const [userId, st] of campaignStatus) {
    campaigns.push({ userId, ...st });
  }
  return { campaigns, activeCount: activeCampaigns.size, totalCount: campaignStatus.size };
}

async function getAllJobs() {
  const jobs = [];
  for (const [userId, st] of campaignStatus) {
    jobs.push({
      id: `mem-${userId}`,
      name: 'campaign',
      data: { userId },
      status: st.completed ? (st.canceled ? 'canceled' : 'completed') : 'active',
      progress: st.completed ? 100 : Math.round((st.sent + st.errors) / Math.max(1, st.total) * 100),
    });
  }
  return jobs;
}

async function getQueueInfo(userId) {
  const st = campaignStatus.get(userId);
  return {
    counts: { waiting: 0, active: activeCampaigns.has(userId) ? 1 : 0, delayed: 0, paused: 0 },
    position: null,
    queuedForUser: activeCampaigns.has(userId) ? 1 : 0,
    activeForUser: activeCampaigns.has(userId),
  };
}

async function getJobLogs(jobId) {
  return [];
}

async function getRedisKeyStats() {
  return { keys: [], total: 0, memory: 0 };
}

async function cleanupOrphanKeys(whitelist) {
  return [];
}

async function deleteOrphanKeys(orphans) {
  return { deleted: 0 };
}

async function resetStatus(userId, total) {
  initStatus(userId, total, SEND_BETWEEN_MS);
}

async function markCompleted(userId) {
  const st = campaignStatus.get(userId);
  if (st) { st.completed = true; st.finishedAt = Date.now(); }
}

async function markCanceled(userId) {
  const st = campaignStatus.get(userId);
  if (st) { st.canceled = true; st.completed = true; st.finishedAt = Date.now(); }
}

async function requestCancel(userId) {
  const st = campaignStatus.get(userId);
  if (st) { st.canceled = true; }
}

async function isCanceled(userId) {
  const st = campaignStatus.get(userId);
  return st ? st.canceled : false;
}

async function clearCancel(userId) {
  return;
}

async function getRecentEvents(userId, limit = 100) {
  return [];
}

module.exports = {
  ALLOWED_INTERVALS,
  DEFAULT_INTERVAL,
  enqueueCampaign,
  getStatus,
  getStatusDetailed,
  cancelCampaign,
  saveList,
  clearList,
  cleanupUserData,
  removeUserJobs,
  touchHeartbeat,
  closeWorker,
  cleanQueue,
  obliterateQueue,
  getQueueSize,
  getQueueCounts,
  getQueueStatus,
  getAllJobs,
  getJobLogs,
  getRedisKeyStats,
  cleanupOrphanKeys,
  deleteOrphanKeys,
  getQueueInfo,
  resetStatus,
  markCompleted,
  markCanceled,
  requestCancel,
  isCanceled,
  clearCancel,
  getRecentEvents,
};
