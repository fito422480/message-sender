const { admin, db } = require('./firebaseAdmin');
const logger = require('./logger');

const FieldValue = admin.firestore.FieldValue;

// Collection helpers
const contactsCol = (uid) => db.collection(`users/${uid}/contacts`);
const campaignsCol = (uid) => db.collection(`users/${uid}/campaigns`);
const recipientsCol = (uid, cid) => db.collection(`users/${uid}/campaigns/${cid}/recipients`);
const metricEventsCol = (uid) => db.collection(`users/${uid}/metricEvents`);
const monthlyStatsCol = (uid) => db.collection(`users/${uid}/monthlyStats`);
const contactStatsCol = (uid) => db.collection(`users/${uid}/contactStats`);
const rootContactsCol = () => db.collection(process.env.FIRESTORE_CONTACTS_COLLECTION || 'contacts');

const CONTACT_PHONE_FIELDS = ['phone', 'numero', 'number', 'telefono', 'celular'];
const CONTACT_OWNER_FIELDS = [
  'uid',
  'userId',
  'ownerUid',
  'ownerId',
  'createdBy',
  'created_by',
  'user_id',
  'owner.uid',
  'user.uid',
];
const CONTACT_EMAIL_FIELDS = [
  'email',
  'userEmail',
  'ownerEmail',
  'createdByEmail',
  'user_email',
  'owner.email',
  'user.email',
];

// ========================================
// CONTACTS
// ========================================

async function getContactByPhone(userId, phone) {
  const snap = await findContactSnapshotByPhone(userId, phone);
  return snap ? mapContact(snap.id, snap.data()) : null;
}

async function getContactById(userId, contactId) {
  const snap = await findContactSnapshotById(userId, contactId);
  return snap ? mapContact(snap.id, snap.data()) : null;
}

async function upsertContact(userId, data, source = 'manual') {
  const phone = String(data.phone || data.numero || '').trim();
  if (!phone) throw new Error('El teléfono es obligatorio');

  const snap = await findContactSnapshotByPhone(userId, phone);
  const ref = snap?.ref || contactsCol(getCanonicalUserId(userId)).doc(phone);

  const nombre = data.nombre || null;
  const tratamiento = data.tratamiento || data.sustantivo || null;
  const grupo = data.grupo || null;

  if (snap?.exists) {
    const updates = {};
    if (!snap.data().phone) updates.phone = phone;
    if (nombre) updates.nombre = nombre;
    if (tratamiento) updates.tratamiento = tratamiento;
    if (grupo) updates.grupo = grupo;
    updates.updatedAt = FieldValue.serverTimestamp();
    if (Object.keys(updates).length > 0) {
      await ref.update(updates);
    }
    const after = await ref.get();
    return { contact: mapContact(after.id, after.data()), created: false };
  }

  await ref.set({
    phone,
    nombre,
    tratamiento,
    grupo,
    source,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastSeenAt: null,
  });

  const after = await ref.get();
  return { contact: mapContact(after.id, after.data()), created: true };
}

async function updateContact(userId, contactId, patch) {
  const existingSnap = await findContactSnapshotById(userId, contactId);
  if (!existingSnap) return null;
  const existing = mapContact(existingSnap.id, existingSnap.data());

  const targetPhone = String(patch.phone || existing.phone).trim();
  if (!targetPhone) throw new Error('El teléfono es obligatorio');

  if (targetPhone !== existing.phone) {
    const phoneTaken = await findContactSnapshotByPhone(userId, targetPhone);
    if (phoneTaken && phoneTaken.ref.path !== existingSnap.ref.path) {
      throw new Error('Ya existe un contacto con ese número');
    }
  }

  const ref = existingSnap.ref;
  const updates = {
    phone: targetPhone,
    nombre: patch.nombre !== undefined ? patch.nombre : existing.nombre,
    tratamiento: patch.tratamiento !== undefined ? patch.tratamiento : (patch.sustantivo !== undefined ? patch.sustantivo : existing.tratamiento),
    grupo: patch.grupo !== undefined ? patch.grupo : existing.grupo,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.update(updates);

  if (isUserContactsPath(ref.path) && targetPhone !== existing.id) {
    const newRef = ref.parent.doc(targetPhone);
    await newRef.set(updates, { merge: true });
    await ref.delete();
    const after = await newRef.get();
    return mapContact(after.id, after.data());
  }

  const after = await ref.get();
  return mapContact(after.id, after.data());
}

async function deleteContact(userId, contactId) {
  const existing = await findContactSnapshotById(userId, contactId);
  if (!existing) return false;
  await existing.ref.delete();
  return true;
}

async function listContacts(userId, opts = {}) {
  const search = String(opts.search || '').trim().toLowerCase();
  const group = String(opts.group || '').trim();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(opts.pageSize) || 25));

  let docs = await getAllContactSnapshots(userId);

  docs.sort((a, b) => {
    const aUp = toMillis(a.data().updatedAt) || 0;
    const bUp = toMillis(b.data().updatedAt) || 0;
    return bUp - aUp;
  });

  if (search) {
    docs = docs.filter(d => {
      const contact = mapContact(d.id, d.data());
      const phone = String(contact.phone || '').toLowerCase();
      const nombre = String(contact.nombre || '').toLowerCase();
      const grupo = String(contact.grupo || '').toLowerCase();
      return phone.includes(search) || nombre.includes(search) || grupo.includes(search);
    });
  }

  if (group) {
    const normalizedGroup = group.toLowerCase();
    docs = docs.filter(d => {
      const contact = mapContact(d.id, d.data());
      return String(contact.grupo || '').trim().toLowerCase() === normalizedGroup;
    });
  }

  const total = docs.length;
  const offset = (page - 1) * pageSize;
  const pageDocs = docs.slice(offset, offset + pageSize);
  const items = pageDocs.map(d => mapContact(d.id, d.data()));

  return { items, total, page, pageSize };
}

async function getContactGroups(userId) {
  const docs = await getAllContactSnapshots(userId);
  const groups = new Set();
  docs.forEach(d => {
    const data = d.data();
    const g = data.grupo || data.group;
    if (g && String(g).trim()) groups.add(String(g).trim());
  });
  return [...groups].sort();
}

async function getContactsByIds(userId, contactIds) {
  if (!contactIds || contactIds.length === 0) return [];
  const results = [];
  for (const id of contactIds) {
    const c = await getContactById(userId, id);
    if (c) results.push(c);
  }
  return results;
}

async function getContactsByGroup(userId, groupName) {
  const targetGroup = String(groupName || '').trim().toLowerCase();
  if (!targetGroup) return [];

  const docs = await getAllContactSnapshots(userId);
  const results = [];
  docs.forEach(d => {
    const contact = mapContact(d.id, d.data());
    if (String(contact.grupo || '').trim().toLowerCase() === targetGroup) {
      results.push(contact);
    }
  });
  return results;
}

async function importContactsFromEntries(userId, entries, source = 'csv') {
  const summary = { inserted: 0, updated: 0, total: 0 };
  const enriched = [];

  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const number = String(entry?.number || '').trim();
    if (!number) continue;

    const vars = entry?.variables || {};
    const contactPayload = {
      phone: number,
      nombre: vars.nombre || entry.nombre || null,
      tratamiento: vars.tratamiento || vars.sustantivo || entry.tratamiento || entry.sustantivo || null,
      grupo: vars.grupo || entry.grupo || null,
    };

    const result = await upsertContact(userId, contactPayload, source);
    summary.total++;
    if (result.created) summary.inserted++;
    else summary.updated++;

    const c = result.contact;
    enriched.push({
      ...entry,
      number: c.phone,
      contactId: c.id,
      group: c.grupo || null,
      variables: {
        ...vars,
        nombre: c.nombre || vars.nombre || '',
        tratamiento: c.tratamiento || vars.tratamiento || vars.sustantivo || '',
        grupo: c.grupo || vars.grupo || '',
      },
    });
  }

  return { entries: enriched, summary };
}

// ========================================
// CAMPAIGNS
// ========================================

async function createCampaign(userId, payload = {}) {
  const docRef = campaignsCol(userId).doc();
  const name = payload.name || `Campaña ${new Date().toLocaleString()}`;

  await docRef.set({
    name,
    messageType: payload.messageType || 'text',
    templateCount: Number(payload.templateCount || 1),
    totalRecipients: Number(payload.totalRecipients || 0),
    status: 'pending',
    sentCount: 0,
    errorCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    startedAt: null,
    finishedAt: null,
  });

  const month = formatMonth(new Date());
  const monthRef = monthlyStatsCol(userId).doc(month);
  await monthRef.set({
    month,
    campaignCount: FieldValue.increment(1),
    sentCount: FieldValue.increment(0),
    errorCount: FieldValue.increment(0),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const snap = await docRef.get();
  return mapCampaign(docRef.id, snap.data());
}

async function getCampaign(userId, campaignId) {
  const snap = await campaignsCol(userId).doc(campaignId).get();
  if (!snap.exists) return null;
  return mapCampaign(snap.id, snap.data());
}

async function setCampaignStatus(userId, campaignId, status, extra = {}) {
  const ref = campaignsCol(userId).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const updates = { status, updatedAt: FieldValue.serverTimestamp() };

  if (status === 'running' && !extra.skipStarted) {
    updates.startedAt = FieldValue.serverTimestamp();
  }

  if (status === 'completed' || status === 'canceled' || status === 'failed') {
    updates.finishedAt = FieldValue.serverTimestamp();
  }

  if (extra.sentCount !== undefined) {
    updates.sentCount = extra.sentCount;
  }

  if (extra.errorCount !== undefined) {
    updates.errorCount = extra.errorCount;
  }

  await ref.update(updates);

  await addMetricEvent(userId, {
    type: `campaign_${status}`,
    campaignId,
  });

  const after = await ref.get();
  return mapCampaign(after.id, after.data());
}

async function initCampaignRecipients(userId, campaignId, entries = []) {
  const validEntries = entries.filter(e => String(e?.number || '').trim());
  if (!validEntries.length) return;

  const batch = db.batch();
  const colRef = recipientsCol(userId, campaignId);

  for (const entry of validEntries) {
    const phone = String(entry.number).trim();
    const docRef = colRef.doc(phone);
    batch.set(docRef, {
      contactId: entry.contactId || null,
      phone,
      nombre: entry?.variables?.nombre || null,
      tratamiento: entry?.variables?.tratamiento || entry?.variables?.sustantivo || null,
      grupo: entry?.variables?.grupo || null,
      templateIndex: entry.templateIndex != null ? entry.templateIndex : null,
      status: 'pending',
      attempts: 0,
      errorMessage: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      sentAt: null,
      errorAt: null,
    });
  }

  await batch.commit();

  await addMetricEvent(userId, {
    type: 'campaign_enqueue',
    campaignId,
    metadata: { total: validEntries.length },
  });
}

async function recordRecipientStatus(userId, campaignId, entry, status, meta = {}) {
  if (!campaignId) return null;

  const phone = String(entry?.number || entry?.phone || '').trim();
  if (!phone) return null;

  const ref = recipientsCol(userId, campaignId).doc(phone);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const updates = {
    status,
    attempts: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (status === 'sent') {
    updates.sentAt = FieldValue.serverTimestamp();
  }
  if (status === 'error') {
    updates.errorAt = FieldValue.serverTimestamp();
    if (meta.errorMessage) {
      updates.errorMessage = meta.errorMessage;
    }
  }
  if (meta.templateIndex !== undefined) {
    updates.templateIndex = meta.templateIndex;
  }

  await ref.update(updates);
  const after = await ref.get();
  const recipient = { id: after.id, ...after.data() };

  if (status === 'sent') {
    await Promise.all([
      campaignsCol(userId).doc(campaignId).update({ sentCount: FieldValue.increment(1) }),
      incrementMonthlyCounters(userId, 'sent'),
      updateContactStats(userId, recipient, 'sent'),
      addMetricEvent(userId, {
        type: 'message_sent',
        campaignId,
        phone,
        contactId: recipient.contactId,
        grupo: recipient.grupo || 'Sin grupo',
      }),
    ]);
  } else if (status === 'error') {
    await Promise.all([
      campaignsCol(userId).doc(campaignId).update({ errorCount: FieldValue.increment(1) }),
      incrementMonthlyCounters(userId, 'error'),
      updateContactStats(userId, recipient, 'error'),
      addMetricEvent(userId, {
        type: 'message_error',
        campaignId,
        phone,
        contactId: recipient.contactId,
        grupo: recipient.grupo || 'Sin grupo',
        errorMessage: meta.errorMessage,
      }),
    ]);
  } else if (status === 'sending') {
    await addMetricEvent(userId, {
      type: 'message_sending',
      campaignId,
      phone,
      contactId: recipient.contactId,
      grupo: recipient.grupo || 'Sin grupo',
    });
  }

  return mapRecipient(after.id, after.data());
}

async function getCampaignDetail(userId, campaignId) {
  const campaign = await getCampaign(userId, campaignId);
  if (!campaign) return null;

  const snap = await recipientsCol(userId, campaignId)
    .orderBy('updatedAt', 'desc')
    .get();
  const recipients = [];
  snap.forEach(d => recipients.push(mapRecipient(d.id, d.data())));

  return { campaign, recipients };
}

async function listCampaigns(userId, opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.max(1, Math.min(50, Number(opts.pageSize) || 20));

  let query = campaignsCol(userId).orderBy('createdAt', 'desc');
  const snap = await query.limit(2000).get();
  let docs = [];
  snap.forEach(d => docs.push(d));

  if (opts.search) {
    const s = opts.search.toLowerCase();
    docs = docs.filter(d => (d.data().name || '').toLowerCase().includes(s));
  }

  if (opts.dateFrom) {
    const from = new Date(opts.dateFrom);
    docs = docs.filter(d => d.data().createdAt && d.data().createdAt.toDate() >= from);
  }

  if (opts.dateTo) {
    const to = new Date(opts.dateTo);
    to.setHours(23, 59, 59, 999);
    docs = docs.filter(d => d.data().createdAt && d.data().createdAt.toDate() <= to);
  }

  const total = docs.length;
  const offset = (page - 1) * pageSize;
  const pageDocs = docs.slice(offset, offset + pageSize);

  return {
    items: pageDocs.map(d => mapCampaign(d.id, d.data())),
    total,
    page,
    pageSize,
  };
}

// ========================================
// METRICS & DASHBOARD
// ========================================

async function addMetricEvent(userId, event) {
  await metricEventsCol(userId).add({
    eventType: event.type,
    campaignId: event.campaignId || null,
    phone: event.phone || null,
    contactId: event.contactId || null,
    grupo: event.grupo || null,
    errorMessage: event.errorMessage || null,
    metadata: event.metadata || null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function incrementMonthlyCounters(userId, status) {
  const month = formatMonth(new Date());
  const field = status === 'sent' ? 'sentCount' : 'errorCount';
  const ref = monthlyStatsCol(userId).doc(month);

  await ref.set({
    month,
    [field]: FieldValue.increment(1),
    sentCount: FieldValue.increment(0),
    errorCount: FieldValue.increment(0),
    campaignCount: FieldValue.increment(0),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function updateContactStats(userId, recipient, status) {
  const phone = String(recipient.phone || '').trim();
  if (!phone) return;

  const field = status === 'sent' ? 'sentCount' : 'errorCount';
  const ref = contactStatsCol(userId).doc(phone);

  await ref.set({
    phone,
    contactId: recipient.contactId || null,
    nombre: recipient.nombre || null,
    grupo: recipient.grupo || null,
    [field]: FieldValue.increment(1),
    sentCount: FieldValue.increment(0),
    errorCount: FieldValue.increment(0),
    lastActivityAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function dashboardSummary(userId, from, to) {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const start = new Date(range.start);
  const end = new Date(range.end);

  const eventsSnap = await metricEventsCol(userId)
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end)
    .get();

  let sent = 0;
  let errors = 0;
  const campaignIds = new Set();

  eventsSnap.forEach(d => {
    const data = d.data();
    if (data.eventType === 'message_sent') sent++;
    else if (data.eventType === 'message_error') errors++;
    if (data.campaignId) campaignIds.add(data.campaignId);
  });

  const delivered = sent + errors;
  const successRate = delivered > 0 ? Number(((sent * 100) / delivered).toFixed(2)) : 0;

  return {
    from: range.start,
    to: range.end,
    campaigns: campaignIds.size,
    sent,
    errors,
    delivered,
    successRate,
  };
}

async function dashboardTimeline(userId, from, to, bucket = 'day') {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const start = new Date(range.start);
  const end = new Date(range.end);

  const eventsSnap = await metricEventsCol(userId)
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end)
    .get();

  const buckets = {};

  eventsSnap.forEach(d => {
    const data = d.data();
    const et = data.eventType;
    if (et !== 'message_sent' && et !== 'message_error') return;
    const ts = data.createdAt ? data.createdAt.toDate() : new Date();
    let key;
    if (bucket === 'hour') {
      key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:00`;
    } else if (bucket === 'month') {
      key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
    } else {
      key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}`;
    }

    if (!buckets[key]) buckets[key] = { sent: 0, errors: 0 };
    if (et === 'message_sent') buckets[key].sent++;
    else if (et === 'message_error') buckets[key].errors++;
  });

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, vals]) => ({
      bucket,
      sent: vals.sent,
      errors: vals.errors,
    }));
}

async function dashboardByGroup(userId, from, to) {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const start = new Date(range.start);
  const end = new Date(range.end);

  const eventsSnap = await metricEventsCol(userId)
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end)
    .get();

  const groups = {};

  eventsSnap.forEach(d => {
    const data = d.data();
    const et = data.eventType;
    if (et !== 'message_sent' && et !== 'message_error') return;
    const g = data.grupo || 'Sin grupo';
    if (!groups[g]) groups[g] = { sent: 0, errors: 0, total: 0 };
    groups[g].total++;
    if (et === 'message_sent') groups[g].sent++;
    else if (et === 'message_error') groups[g].errors++;
  });

  return Object.entries(groups)
    .map(([group, vals]) => ({ group, ...vals }))
    .sort((a, b) => b.total - a.total);
}

async function dashboardByContact(userId, from, to, limit = 20) {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const start = new Date(range.start);
  const end = new Date(range.end);

  const eventsSnap = await metricEventsCol(userId)
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end)
    .get();

  const byPhone = {};

  eventsSnap.forEach(d => {
    const data = d.data();
    const et = data.eventType;
    if (et !== 'message_sent' && et !== 'message_error') return;
    const phone = data.phone;
    if (!phone) return;
    if (!byPhone[phone]) byPhone[phone] = { phone, sent: 0, errors: 0, total: 0, nombre: null, grupo: null };
    byPhone[phone].total++;
    if (et === 'message_sent') byPhone[phone].sent++;
    else if (et === 'message_error') byPhone[phone].errors++;
  });

  const phones = Object.keys(byPhone);
  for (let i = 0; i < phones.length; i += 10) {
    const batch = phones.slice(i, i + 10);
    await Promise.all(batch.map(async (phone) => {
      const contact = await getContactByPhone(userId, phone);
      if (contact) {
        byPhone[phone].nombre = contact.nombre;
        byPhone[phone].grupo = contact.grupo;
      }
    }));
  }

  return Object.values(byPhone)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

async function dashboardCurrentMonth(userId) {
  const now = new Date();
  const curMonth = formatMonth(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = formatMonth(prevDate);

  const [curSnap, prevSnap] = await Promise.all([
    monthlyStatsCol(userId).doc(curMonth).get(),
    monthlyStatsCol(userId).doc(prevMonth).get(),
  ]);

  const current = curSnap.exists ? curSnap.data() : { sentCount: 0, errorCount: 0 };
  const previous = prevSnap.exists ? prevSnap.data() : { sentCount: 0, errorCount: 0 };

  const sent = Number(current.sentCount) || 0;
  const errors = Number(current.errorCount) || 0;
  const prevSent = Number(previous.sentCount) || 0;
  const delivered = sent + errors;
  const successRate = delivered > 0 ? Number(((sent * 100) / delivered).toFixed(2)) : 0;
  const delta = sent - prevSent;
  const deltaPct = prevSent > 0 ? Number(((delta * 100) / prevSent).toFixed(2)) : (sent > 0 ? 100 : 0);

  return {
    month: curMonth,
    sent,
    errors,
    delivered,
    successRate,
    previousMonthSent: prevSent,
    deltaSent: delta,
    deltaPercent: deltaPct,
  };
}

async function dashboardMonthly(userId, months = 12) {
  const snap = await monthlyStatsCol(userId)
    .orderBy('month', 'desc')
    .limit(months)
    .get();

  const results = [];
  snap.forEach(d => results.push(d.data()));

  return results.reverse().map(r => ({
    month: r.month,
    sent: Number(r.sentCount) || 0,
    errors: Number(r.errorCount) || 0,
    total: (Number(r.sentCount) || 0) + (Number(r.errorCount) || 0),
  }));
}

// ========================================
// HELPERS
// ========================================

function formatMonth(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function parseRange(from, to) {
  const nowTs = Date.now();
  const parseTs = (val, asEnd = false) => {
    if (!val) return null;
    const s = String(val).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T00:00:00`);
      if (asEnd) d.setHours(23, 59, 59, 999);
      return d.getTime();
    }
    return Number(new Date(s).getTime());
  };
  const end = parseTs(to, true) ?? nowTs;
  const start = parseTs(from, false) ?? (end - (30 * 24 * 3600 * 1000));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

function getCanonicalUserId(userId) {
  if (userId && typeof userId === 'object') {
    return String(userId.uid || userId.userId || userId.id || 'default').trim() || 'default';
  }
  return String(userId || 'default').trim() || 'default';
}

function addAlias(aliases, value) {
  const alias = String(value || '').trim();
  if (!alias || alias.includes('/')) return;
  aliases.add(alias);
}

async function getContactOwnerAliases(userId) {
  const canonicalUserId = getCanonicalUserId(userId);
  const aliases = new Set();
  addAlias(aliases, canonicalUserId);

  if (userId && typeof userId === 'object') {
    [
      userId.uid,
      userId.userId,
      userId.id,
      userId.email,
      userId.legacyUid,
      userId.legacyUserId,
      userId.keycloakId,
      userId.whatsappPhone,
    ].forEach(value => addAlias(aliases, value));
  }

  String(process.env.FIRESTORE_CONTACT_OWNER_ALIASES || '')
    .split(',')
    .forEach(value => addAlias(aliases, value));

  try {
    const userSnap = await db.collection('users').doc(canonicalUserId).get();
    if (userSnap.exists) {
      const data = userSnap.data() || {};
      [
        data.uid,
        data.userId,
        data.id,
        data.email,
        data.legacyUid,
        data.legacyUserId,
        data.keycloakId,
        data.whatsappPhone,
      ].forEach(value => addAlias(aliases, value));
    }
  } catch (err) {
    logger.debug({ err: err.message, userId: canonicalUserId }, 'Could not load Firestore user aliases for contacts');
  }

  return [...aliases];
}

async function getContactCollectionRefs(userId) {
  const aliases = await getContactOwnerAliases(userId);
  return getContactCollectionRefsFromAliases(aliases);
}

function getContactCollectionRefsFromAliases(aliases) {
  const seen = new Set();
  return aliases
    .map(alias => contactsCol(alias))
    .filter(ref => {
      if (seen.has(ref.path)) return false;
      seen.add(ref.path);
      return true;
    });
}

async function getAllContactSnapshots(userId) {
  const aliases = await getContactOwnerAliases(userId);
  return getAllContactSnapshotsForAliases(aliases);
}

async function getAllContactSnapshotsForAliases(aliases) {
  const docs = [];

  for (const col of getContactCollectionRefsFromAliases(aliases)) {
    await collectQueryDocs(col, docs);
  }

  await collectOwnedRootContactDocs(aliases, docs);
  return dedupeContactDocs(docs);
}

async function collectOwnedRootContactDocs(aliases, docs) {
  const allAliases = aliases.filter(Boolean);
  const emailAliases = allAliases.filter(alias => alias.includes('@'));

  for (const field of CONTACT_OWNER_FIELDS) {
    for (const alias of allAliases) {
      await collectQueryDocs(rootContactsCol().where(field, '==', alias), docs);
    }
  }

  for (const field of CONTACT_EMAIL_FIELDS) {
    for (const alias of emailAliases) {
      await collectQueryDocs(rootContactsCol().where(field, '==', alias), docs);
    }
  }

  if (String(process.env.FIRESTORE_CONTACTS_INCLUDE_GLOBAL || '').toLowerCase() === 'true') {
    await collectQueryDocs(rootContactsCol(), docs);
  }
}

async function collectQueryDocs(query, docs) {
  try {
    const snap = await query.get();
    snap.forEach(doc => docs.push(doc));
  } catch (err) {
    logger.debug({ err: err.message }, 'Skipping Firestore contacts query');
  }
}

function dedupeContactDocs(docs) {
  const byPhone = new Map();
  const byPath = new Map();

  for (const doc of docs) {
    if (!doc?.exists) continue;
    const contact = mapContact(doc.id, doc.data());
    const phoneKey = normalizePhoneKey(contact.phone);
    if (phoneKey) {
      if (!byPhone.has(phoneKey)) byPhone.set(phoneKey, doc);
      continue;
    }
    if (!byPath.has(doc.ref.path)) byPath.set(doc.ref.path, doc);
  }

  return [...byPhone.values(), ...byPath.values()];
}

async function findContactSnapshotByPhone(userId, phone) {
  const normalizedPhone = String(phone || '').trim();
  if (!normalizedPhone) return null;

  const aliases = await getContactOwnerAliases(userId);
  for (const col of getContactCollectionRefsFromAliases(aliases)) {
    const byId = await safeGetDoc(col.doc(normalizedPhone));
    if (byId?.exists) return byId;

    for (const field of CONTACT_PHONE_FIELDS) {
      const byField = await safeGetFirst(col.where(field, '==', normalizedPhone));
      if (byField) return byField;
    }
  }

  const docs = await getAllContactSnapshotsForAliases(aliases);
  return docs.find(doc => phoneMatches(mapContact(doc.id, doc.data()).phone, normalizedPhone)) || null;
}

async function findContactSnapshotById(userId, contactId) {
  const id = String(contactId || '').trim();
  if (!id) return null;

  const aliases = await getContactOwnerAliases(userId);
  if (id.includes('/')) {
    const byPath = await safeGetDoc(db.doc(id));
    if (byPath?.exists && contactBelongsToAliases(byPath, aliases)) return byPath;
  }

  for (const col of getContactCollectionRefsFromAliases(aliases)) {
    const snap = await safeGetDoc(col.doc(id));
    if (snap?.exists) return snap;
  }

  const rootSnap = await safeGetDoc(rootContactsCol().doc(id));
  if (rootSnap?.exists && contactBelongsToAliases(rootSnap, aliases)) return rootSnap;

  const docs = await getAllContactSnapshotsForAliases(aliases);
  return docs.find(doc => doc.id === id || doc.ref.path === id) || null;
}

async function safeGetDoc(ref) {
  try {
    return await ref.get();
  } catch (err) {
    logger.debug({ err: err.message, path: ref.path }, 'Skipping Firestore contact doc read');
    return null;
  }
}

async function safeGetFirst(query) {
  try {
    const snap = await query.limit(1).get();
    return snap.empty ? null : snap.docs[0];
  } catch (err) {
    logger.debug({ err: err.message }, 'Skipping Firestore contact lookup');
    return null;
  }
}

function contactBelongsToAliases(doc, aliases) {
  const aliasSet = new Set(aliases);
  const parts = doc.ref.path.split('/');
  if (parts[0] === 'users' && parts[2] === 'contacts' && aliasSet.has(parts[1])) {
    return true;
  }

  const data = doc.data() || {};
  for (const field of [...CONTACT_OWNER_FIELDS, ...CONTACT_EMAIL_FIELDS]) {
    const value = getNestedValue(data, field);
    if (value && aliasSet.has(String(value).trim())) return true;
  }

  return String(process.env.FIRESTORE_CONTACTS_INCLUDE_GLOBAL || '').toLowerCase() === 'true';
}

function getNestedValue(data, path) {
  return String(path).split('.').reduce((value, key) => {
    if (value && Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    return undefined;
  }, data);
}

function isUserContactsPath(path) {
  const parts = String(path || '').split('/');
  return parts[0] === 'users' && parts[2] === 'contacts';
}

function normalizePhoneKey(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneMatches(left, right) {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (a && b && a === b) return true;
  const da = normalizePhoneKey(a);
  const db = normalizePhoneKey(b);
  return !!da && !!db && da === db;
}

function mapContact(id, data) {
  if (!data) return null;
  const phone = data.phone || data.numero || data.number || data.telefono || data.celular || id;
  return {
    id,
    phone,
    nombre: data.nombre || data.name || data.nombreCompleto || null,
    tratamiento: data.tratamiento || data.sustantivo || data.titulo || null,
    grupo: data.grupo || data.group || null,
    source: data.source || 'firebase',
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    lastSeenAt: toMillis(data.lastSeenAt),
  };
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const ts = Number(new Date(value).getTime());
  return Number.isFinite(ts) ? ts : null;
}

function mapCampaign(id, data) {
  if (!data) return null;
  return {
    id,
    userId: null,
    name: data.name,
    status: data.status,
    messageType: data.messageType,
    templateCount: data.templateCount,
    totalRecipients: data.totalRecipients,
    sentCount: data.sentCount,
    errorCount: data.errorCount,
    createdAt: data.createdAt ? data.createdAt.toMillis() : null,
    updatedAt: data.updatedAt ? data.updatedAt.toMillis() : null,
    startedAt: data.startedAt ? data.startedAt.toMillis() : null,
    finishedAt: data.finishedAt ? data.finishedAt.toMillis() : null,
  };
}

function mapRecipient(id, data) {
  if (!data) return null;
  return {
    id,
    campaignId: null,
    contactId: data.contactId,
    phone: data.phone,
    nombre: data.nombre,
    tratamiento: data.tratamiento,
    grupo: data.grupo,
    status: data.status,
    templateIndex: data.templateIndex,
    attempts: data.attempts,
    errorMessage: data.errorMessage,
    createdAt: data.createdAt ? data.createdAt.toMillis() : null,
    updatedAt: data.updatedAt ? data.updatedAt.toMillis() : null,
    sentAt: data.sentAt ? data.sentAt.toMillis() : null,
    errorAt: data.errorAt ? data.errorAt.toMillis() : null,
  };
}

module.exports = {
  // Contacts
  upsertContact,
  updateContact,
  deleteContact,
  listContacts,
  getContactById,
  getContactByPhone,
  getContactGroups,
  getContactsByIds,
  getContactsByGroup,
  importContactsFromEntries,
  // Campaigns
  createCampaign,
  getCampaign,
  setCampaignStatus,
  initCampaignRecipients,
  recordRecipientStatus,
  getCampaignDetail,
  listCampaigns,
  // Dashboard
  dashboardSummary,
  dashboardTimeline,
  dashboardByGroup,
  dashboardByContact,
  dashboardCurrentMonth,
  dashboardMonthly,
  addMetricEvent,
};
