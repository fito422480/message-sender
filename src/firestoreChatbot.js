const { admin, db } = require('./firebaseAdmin');
const logger = require('./logger');
const FieldValue = admin.firestore.FieldValue;

const configDoc = (uid) => db.collection(`users/${uid}/chatbot`).doc('config');
const nodesCol = (uid) => db.collection(`users/${uid}/chatbotNodes`);
const conversationsCol = (uid) => db.collection(`users/${uid}/chatbotConversations`);
const inboxCol = (uid) => db.collection(`users/${uid}/inboxMessages`);

// ── Config ──

async function getConfig(userId) {
  const snap = await configDoc(userId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  data.id = snap.id;
  data.ai_api_key_set = !!data.aiApiKeyEncrypted;
  delete data.aiApiKeyEncrypted;
  return data;
}

async function createConfig(userId, data) {
  const doc = {
    name: data.name || 'Mi Bot',
    enabled: data.enabled || false,
    activeHoursStart: data.active_hours_start || '08:00',
    activeHoursEnd: data.active_hours_end || '22:00',
    activeDays: data.active_days || [1, 2, 3, 4, 5],
    cooldownMinutes: data.cooldown_minutes || 30,
    onlyKnownContacts: data.only_known_contacts !== undefined ? data.only_known_contacts : true,
    maxResponsesPerContact: data.max_responses_per_contact || 5,
    aiEnabled: data.ai_enabled || false,
    aiProvider: data.ai_provider || null,
    aiApiKeyEncrypted: data.ai_api_key_encrypted || null,
    aiModel: data.ai_model || null,
    aiSystemPrompt: data.ai_system_prompt || null,
    welcomeMessage: data.welcome_message || null,
    fallbackMessage: data.fallback_message || 'No entendí tu mensaje. Escribí "menu" para ver las opciones.',
    botMode: data.bot_mode || 'flow',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = configDoc(userId);
  await ref.set(doc);
  const snap = await ref.get();
  const result = { id: snap.id, ...snap.data() };
  result.ai_api_key_set = !!result.aiApiKeyEncrypted;
  delete result.aiApiKeyEncrypted;
  return result;
}

async function updateConfig(userId, fields) {
  const ref = configDoc(userId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const updates = {};
  const keyMap = {
    name: 'name', enabled: 'enabled',
    active_hours_start: 'activeHoursStart', active_hours_end: 'activeHoursEnd',
    active_days: 'activeDays', cooldown_minutes: 'cooldownMinutes',
    only_known_contacts: 'onlyKnownContacts', max_responses_per_contact: 'maxResponsesPerContact',
    ai_enabled: 'aiEnabled', ai_provider: 'aiProvider',
    ai_model: 'aiModel', ai_system_prompt: 'aiSystemPrompt',
    welcome_message: 'welcomeMessage', fallback_message: 'fallbackMessage',
    exit_message: 'exitMessage', deactivation_message: 'deactivationMessage',
    start_node_id: 'startNodeId', activation_keywords: 'activationKeywords',
    deactivation_keywords: 'deactivationKeywords', bot_mode: 'botMode',
  };
  for (const [pgKey, fsKey] of Object.entries(keyMap)) {
    if (fields[pgKey] !== undefined) {
      updates[fsKey] = fields[pgKey];
    }
  }
  if (fields.ai_api_key !== undefined) {
    updates.aiApiKeyEncrypted = fields.ai_api_key;
  }
  updates.updatedAt = FieldValue.serverTimestamp();

  if (Object.keys(updates).length === 0) return null;

  await ref.update(updates);
  const after = await ref.get();
  const result = { id: after.id, ...after.data() };
  result.ai_api_key_set = !!result.aiApiKeyEncrypted;
  delete result.aiApiKeyEncrypted;
  return result;
}

async function getConfigId(userId) {
  const snap = await configDoc(userId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Nodes ──

async function getNodes(userId) {
  const configSnap = await configDoc(userId).get();
  if (!configSnap.exists) return { nodes: [], configId: null };
  const configId = configSnap.id;
  const snap = await nodesCol(userId).orderBy('createdAt').get();
  const nodes = [];
  snap.forEach(d => nodes.push({ id: d.id, ...d.data() }));
  return { nodes, configId: configId };
}

async function replaceNodes(userId, nodes) {
  const configSnap = await configDoc(userId).get();
  if (!configSnap.exists) return [];
  const batch = db.batch();
  const existing = await nodesCol(userId).get();
  existing.forEach(d => batch.delete(d.ref));
  const inserted = [];
  for (const node of nodes) {
    const ref = nodesCol(userId).doc();
    const data = {
      nodeId: node.node_id,
      type: node.type,
      content: node.content || {},
      positionX: node.position_x || 0,
      positionY: node.position_y || 0,
      createdAt: FieldValue.serverTimestamp(),
    };
    batch.set(ref, data);
    inserted.push({ id: ref.id, ...data });
  }
  await batch.commit();
  return inserted;
}

async function deleteNode(userId, nodeId) {
  const ref = nodesCol(userId).doc(nodeId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

// ── Conversations ──

async function listConversations(userId) {
  const snap = await conversationsCol(userId)
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  return items;
}

async function deleteMessagesAndConversation(userId, phone) {
  const inboxSnap = await inboxCol(userId)
    .where('contactPhone', '==', phone)
    .get();
  const batch = db.batch();
  inboxSnap.forEach(d => batch.delete(d.ref));
  const convRef = conversationsCol(userId).doc(phone);
  batch.delete(convRef);
  await batch.commit();
  return { deletedMessages: inboxSnap.size };
}

// ── Inbox ──

async function getInboxConversations(userId, page, limit) {
  const offset = (page - 1) * limit;

  const allSnap = await inboxCol(userId)
    .orderBy('createdAt', 'desc')
    .get();

  const byPhone = {};
  allSnap.forEach(d => {
    const msg = d.data();
    const phone = msg.contactPhone;
    if (!phone) return;
    if (!byPhone[phone]) {
      byPhone[phone] = {
        contact_phone: phone,
        messages: [],
        unread_count: 0,
      };
    }
    byPhone[phone].messages.push(msg);
    if (msg.read === false && msg.isFromContact === true) {
      byPhone[phone].unread_count++;
    }
  });

  const conversations = [];
  for (const [phone, data] of Object.entries(byPhone)) {
    const msgs = data.messages.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    const lastMsg = msgs[0];

    let contactName = lastMsg.contactName || null;
    let tratamiento = null;
    let grupo = null;
    try {
      const metricsStore = require('./metricsStore');
      const contact = await metricsStore.getContactByPhone(userId, phone);
      if (contact) {
        contactName = contact.nombre || contactName;
        tratamiento = contact.tratamiento || null;
        grupo = contact.grupo || null;
      }
    } catch (e) { /* ignore */ }

    conversations.push({
      contact_phone: phone,
      contact_name: contactName,
      tratamiento,
      grupo,
      last_message_at: lastMsg.createdAt ? lastMsg.createdAt.toMillis() : Date.now(),
      message_count: data.messages.length,
      unread_count: data.unread_count,
      last_message: lastMsg.messageText || '',
    });
  }

  conversations.sort((a, b) => b.last_message_at - a.last_message_at);

  const total = conversations.length;
  const pageItems = conversations.slice(offset, offset + limit);

  return { conversations: pageItems, total };
}

async function getInboxUnreadCount(userId) {
  const snap = await inboxCol(userId)
    .where('read', '==', false)
    .where('isFromContact', '==', true)
    .get();

  const phones = new Set();
  let unreadMessages = 0;
  snap.forEach(d => {
    phones.add(d.data().contactPhone);
    unreadMessages++;
  });

  return {
    unreadConversations: phones.size,
    unreadMessages,
  };
}

async function markInboxRead(userId, phone) {
  const snap = await inboxCol(userId)
    .where('contactPhone', '==', phone)
    .where('read', '==', false)
    .where('isFromContact', '==', true)
    .get();

  const batch = db.batch();
  snap.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
}

async function getInboxMessages(userId, phone, page, limit) {
  await markInboxRead(userId, phone);

  const offset = (page - 1) * limit;
  const snap = await inboxCol(userId)
    .where('contactPhone', '==', phone)
    .get();

  const messages = [];
  snap.forEach(d => {
    const data = d.data();
    messages.push({
      id: d.id,
      ...data,
      createdAt: data.createdAt ? data.createdAt.toMillis() : null,
    });
  });

  messages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return messages.slice(offset, offset + limit);
}

async function deleteInboxMessages(userId, phone) {
  const snap = await inboxCol(userId)
    .where('contactPhone', '==', phone)
    .get();
  const batch = db.batch();
  snap.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return { deleted: snap.size };
}

module.exports = {
  getConfig, createConfig, updateConfig, getConfigId,
  getNodes, replaceNodes, deleteNode,
  listConversations, deleteMessagesAndConversation,
  getInboxConversations, getInboxUnreadCount, markInboxRead,
  getInboxMessages, deleteInboxMessages,
};
