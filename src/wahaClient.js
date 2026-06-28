const logger = require('./logger');

const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_DEFAULT_SESSION = process.env.WAHA_DEFAULT_SESSION || 'default';

function headers() {
  return {
    'X-Api-Key': WAHA_API_KEY,
    'Content-Type': 'application/json',
  };
}

async function request(method, path, body = null) {
  const url = `${WAHA_BASE_URL}${path}`;
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    let errText;
    try { errText = await res.text(); } catch { errText = res.statusText; }
    throw new Error(`WAHA ${method} ${path} ${res.status}: ${errText.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function get(path) { return request('GET', path); }
async function post(path, body = null) { return request('POST', path, body); }
async function put(path, body = null) { return request('PUT', path, body); }
async function del(path) { return request('DELETE', path); }

async function rawGet(path) {
  const url = `${WAHA_BASE_URL}${path}`;
  const res = await fetch(url, { method: 'GET', headers: headers() });
  if (!res.ok) throw new Error(`WAHA GET ${path} ${res.status}`);
  return res;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

async function listSessions(all = false) {
  return get(`/api/sessions${all ? '?all=true' : ''}`);
}

async function getSession(session = WAHA_DEFAULT_SESSION) {
  return get(`/api/sessions/${session}`);
}

async function createSession(name, config = {}) {
  return post('/api/sessions', { name, ...config });
}

async function deleteSession(session = WAHA_DEFAULT_SESSION) {
  return del(`/api/sessions/${session}`);
}

async function startSession(session = WAHA_DEFAULT_SESSION) {
  return post(`/api/sessions/${session}/start`);
}

async function stopSession(session = WAHA_DEFAULT_SESSION) {
  return post(`/api/sessions/${session}/stop`);
}

async function restartSession(session = WAHA_DEFAULT_SESSION) {
  return post(`/api/sessions/${session}/restart`);
}

async function logoutSession(session = WAHA_DEFAULT_SESSION) {
  return post(`/api/sessions/${session}/logout`);
}

async function getSessionMe(session = WAHA_DEFAULT_SESSION) {
  return get(`/api/sessions/${session}/me`);
}

// ─── QR / Auth ────────────────────────────────────────────────────────────────

async function getQR(session = WAHA_DEFAULT_SESSION) {
  const resp = await rawGet(`/api/${session}/auth/qr`);
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer);
}

async function requestPairingCode(phoneNumber, session = WAHA_DEFAULT_SESSION) {
  return post(`/api/${session}/auth/request-code`, { phoneNumber });
}

// ─── Sending messages ─────────────────────────────────────────────────────────

async function sendText(chatId, text, options = {}) {
  return post('/api/sendText', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    text,
    linkPreview: options.linkPreview !== false,
    linkPreviewHighQuality: options.linkPreviewHighQuality || false,
    reply_to: options.replyTo || null,
    mentions: options.mentions || [],
  });
}

async function sendImage(chatId, file, caption = '', options = {}) {
  return post('/api/sendImage', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    file,
    caption,
    reply_to: options.replyTo || null,
  });
}

async function sendVoice(chatId, file, convert = false, options = {}) {
  return post('/api/sendVoice', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    file,
    convert,
    reply_to: options.replyTo || null,
  });
}

async function sendFile(chatId, file, options = {}) {
  return post('/api/sendFile', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    file,
    reply_to: options.replyTo || null,
  });
}

async function sendVideo(chatId, file, caption = '', convert = false, options = {}) {
  return post('/api/sendVideo', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    file,
    caption,
    convert,
    reply_to: options.replyTo || null,
  });
}

async function sendSeen(chatId) {
  return post('/api/sendSeen', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
  });
}

async function sendButtons(chatId, buttons, title, options = {}) {
  return post('/api/sendButtons', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    buttons,
    title,
    reply_to: options.replyTo || null,
  });
}

async function sendList(chatId, list, title, description, buttonText, options = {}) {
  return post('/api/sendList', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    list,
    title,
    description,
    buttonText,
    reply_to: options.replyTo || null,
  });
}

async function sendPoll(chatId, poll, options = {}) {
  return post('/api/sendPoll', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
    poll,
    reply_to: options.replyTo || null,
  });
}

async function startTyping(chatId) {
  return post('/api/startTyping', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
  });
}

async function stopTyping(chatId) {
  return post('/api/stopTyping', {
    session: WAHA_DEFAULT_SESSION,
    chatId,
  });
}

// ─── Helper: build chatId from normalized phone ───────────────────────────────

function toChatId(phone) {
  if (phone.includes('@')) return phone;
  return `${phone}@c.us`;
}

function fromChatId(chatId) {
  return chatId.replace(/@[^.]+(\..*)?$/, '');
}

// ─── Helper: build file payload for WAHA ──────────────────────────────────────

function makeFilePayload(urlOrBuffer, mimetype, filename) {
  if (Buffer.isBuffer(urlOrBuffer)) {
    return { mimetype, filename, data: urlOrBuffer.toString('base64') };
  }
  return { mimetype, filename, url: urlOrBuffer };
}

module.exports = {
  WAHA_BASE_URL,
  WAHA_API_KEY,
  WAHA_DEFAULT_SESSION,
  listSessions,
  getSession,
  createSession,
  deleteSession,
  startSession,
  stopSession,
  restartSession,
  logoutSession,
  getSessionMe,
  getQR,
  requestPairingCode,
  sendText,
  sendImage,
  sendVoice,
  sendFile,
  sendVideo,
  sendSeen,
  sendButtons,
  sendList,
  sendPoll,
  startTyping,
  stopTyping,
  toChatId,
  fromChatId,
  makeFilePayload,
};
