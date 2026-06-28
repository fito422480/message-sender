/**
 * MetricsStore - PostgreSQL Implementation
 * Contacts and Campaigns persistence with PostgreSQL
 * Redis used only for cache and session data
 */
const pg = require('./postgresClient');
const logger = require('./logger');

// ========================================
// CONTACTS
// ========================================

async function getContactByPhone(userId, phone) {
  const result = await pg.query(
    'SELECT * FROM contacts WHERE user_id = $1 AND phone = $2',
    [userId, String(phone).trim()]
  );
  return result.rows[0] || null;
}

async function getContactById(userId, contactId) {
  const result = await pg.query(
    'SELECT * FROM contacts WHERE user_id = $1 AND id = $2',
    [userId, contactId]
  );
  return result.rows[0] || null;
}

async function upsertContact(userId, data, source = 'manual') {
  const phone = String(data.phone || data.numero || '').trim();
  if (!phone) throw new Error('El teléfono es obligatorio');

  const result = await pg.query(
    `INSERT INTO contacts (user_id, phone, nombre, sustantivo, grupo, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, phone) DO UPDATE SET
       nombre = COALESCE(NULLIF(EXCLUDED.nombre, ''), contacts.nombre),
       sustantivo = COALESCE(NULLIF(EXCLUDED.sustantivo, ''), contacts.sustantivo),
       grupo = COALESCE(NULLIF(EXCLUDED.grupo, ''), contacts.grupo),
       updated_at = NOW()
     RETURNING *`,
    [userId, phone, data.nombre || null, data.tratamiento || data.sustantivo || null, data.grupo || null, source]
  );

  return { contact: mapContact(result.rows[0]), created: true };
}

async function updateContact(userId, contactId, patch) {
  const existing = await getContactById(userId, contactId);
  if (!existing) return null;

  const targetPhone = String(patch.phone || existing.phone).trim();
  if (!targetPhone) throw new Error('El teléfono es obligatorio');

  // Check if phone is taken by another contact
  if (targetPhone !== existing.phone) {
    const phoneTaken = await getContactByPhone(userId, targetPhone);
    if (phoneTaken && phoneTaken.id !== existing.id) {
      throw new Error('Ya existe un contacto con ese número');
    }
  }

  const result = await pg.query(
    `UPDATE contacts SET 
      phone = $3,
      nombre = $4,
      sustantivo = $5,
      grupo = $6
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      contactId,
      targetPhone,
      patch.nombre !== undefined ? patch.nombre : existing.nombre,
      (patch.tratamiento !== undefined ? patch.tratamiento : (patch.sustantivo !== undefined ? patch.sustantivo : existing.sustantivo)),
      patch.grupo !== undefined ? patch.grupo : existing.grupo
    ]
  );
  return result.rows[0] ? mapContact(result.rows[0]) : null;
}

async function deleteContact(userId, contactId) {
  const result = await pg.query(
    'DELETE FROM contacts WHERE user_id = $1 AND id = $2',
    [userId, contactId]
  );
  return result.rowCount > 0;
}

async function listContacts(userId, opts = {}) {
  const search = String(opts.search || '').trim().toLowerCase();
  const group = String(opts.group || '').trim();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(opts.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE user_id = $1';
  const params = [userId];
  let paramIndex = 2;

  if (search) {
    whereClause += ` AND (LOWER(phone) LIKE $${paramIndex} OR LOWER(nombre) LIKE $${paramIndex} OR LOWER(grupo) LIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (group) {
    whereClause += ` AND LOWER(grupo) = $${paramIndex}`;
    params.push(group.toLowerCase());
    paramIndex++;
  }

  const countResult = await pg.query(
    `SELECT COUNT(*) as total FROM contacts ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  const result = await pg.query(
    `SELECT * FROM contacts ${whereClause} 
     ORDER BY updated_at DESC 
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, pageSize, offset]
  );

  return {
    items: result.rows.map(mapContact),
    total,
    page,
    pageSize
  };
}

async function getContactGroups(userId) {
  const result = await pg.query(
    `SELECT DISTINCT grupo FROM contacts 
     WHERE user_id = $1 AND grupo IS NOT NULL AND grupo != ''
     ORDER BY grupo`,
    [userId]
  );
  return result.rows.map(r => r.grupo);
}

async function getContactsByIds(userId, contactIds) {
  if (!contactIds || contactIds.length === 0) return [];
  
  const result = await pg.query(
    `SELECT * FROM contacts WHERE user_id = $1 AND id = ANY($2)`,
    [userId, contactIds]
  );
  return result.rows.map(mapContact);
}

async function getContactsByGroup(userId, groupName) {
  const result = await pg.query(
    `SELECT * FROM contacts WHERE user_id = $1 AND LOWER(grupo) = $2`,
    [userId, String(groupName || '').toLowerCase()]
  );
  return result.rows.map(mapContact);
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
  const name = payload.name || `Campaña ${new Date().toLocaleString()}`;
  
  const result = await pg.query(
    `INSERT INTO campaigns (user_id, name, message_type, template_count, total_recipients)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      userId,
      name,
      payload.messageType || 'text',
      Number(payload.templateCount || 1),
      Number(payload.totalRecipients || 0)
    ]
  );

  const campaign = result.rows[0];
  
  // Update monthly stats
  const month = formatMonth(new Date());
  await pg.query(
    `INSERT INTO monthly_stats (user_id, month, campaign_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, month) 
     DO UPDATE SET campaign_count = monthly_stats.campaign_count + 1, updated_at = NOW()`,
    [userId, month]
  );

  return mapCampaign(campaign);
}

async function getCampaign(userId, campaignId) {
  const result = await pg.query(
    'SELECT * FROM campaigns WHERE user_id = $1 AND id = $2',
    [userId, campaignId]
  );
  return result.rows[0] ? mapCampaign(result.rows[0]) : null;
}

async function setCampaignStatus(userId, campaignId, status, extra = {}) {
  const updates = ['status = $3'];
  const params = [userId, campaignId, status];
  let paramIndex = 4;

  if (status === 'running' && !extra.skipStarted) {
    updates.push(`started_at = COALESCE(started_at, NOW())`);
  }

  if (status === 'completed' || status === 'canceled' || status === 'failed') {
    updates.push(`finished_at = NOW()`);
  }

  if (extra.sentCount !== undefined) {
    updates.push(`sent_count = $${paramIndex}`);
    params.push(extra.sentCount);
    paramIndex++;
  }

  if (extra.errorCount !== undefined) {
    updates.push(`error_count = $${paramIndex}`);
    params.push(extra.errorCount);
    paramIndex++;
  }

  const result = await pg.query(
    `UPDATE campaigns SET ${updates.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING *`,
    params
  );

  if (result.rows[0]) {
    await addMetricEvent(userId, {
      type: `campaign_${status}`,
      campaignId,
    });
    return mapCampaign(result.rows[0]);
  }
  return null;
}

async function initCampaignRecipients(userId, campaignId, entries = []) {
  const validEntries = entries.filter(e => String(e?.number || '').trim());
  if (!validEntries.length) return;

  const client = await pg.getClient();
  try {
    await client.query('BEGIN');

    // Batch insert in chunks of 100 to avoid PostgreSQL parameter limits
    const chunkSize = 100;
    for (let i = 0; i < validEntries.length; i += chunkSize) {
      const chunk = validEntries.slice(i, i + chunkSize);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const entry of chunk) {
        const phone = String(entry.number).trim();
        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6})`);
        params.push(
          campaignId,
          entry.contactId || null,
          phone,
          entry?.variables?.nombre || null,
          entry?.variables?.tratamiento || entry?.variables?.sustantivo || null,
          entry?.variables?.grupo || null,
          entry.templateIndex != null ? entry.templateIndex : null
        );
        paramIdx += 7;
      }

      await client.query(
        `INSERT INTO campaign_recipients (campaign_id, contact_id, phone, nombre, sustantivo, grupo, template_index)
         VALUES ${values.join(',')}`,
        params
      );
    }

    await client.query('COMMIT');

    await addMetricEvent(userId, {
      type: 'campaign_enqueue',
      campaignId,
      metadata: { total: validEntries.length }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordRecipientStatus(userId, campaignId, entry, status, meta = {}) {
  if (!campaignId) return null;

  const phone = String(entry?.number || entry?.phone || '').trim();
  if (!phone) return null;

  // Update recipient
  const updateFields = ['status = $3', 'attempts = attempts + 1'];
  const params = [campaignId, phone, status];
  let paramIndex = 4;

  if (status === 'sent') {
    updateFields.push('sent_at = NOW()');
  }
  if (status === 'error') {
    updateFields.push('error_at = NOW()');
    if (meta.errorMessage) {
      updateFields.push(`error_message = $${paramIndex}`);
      params.push(meta.errorMessage);
      paramIndex++;
    }
  }
  if (meta.templateIndex !== undefined) {
    updateFields.push(`template_index = $${paramIndex}`);
    params.push(meta.templateIndex);
    paramIndex++;
  }

  const result = await pg.query(
    `UPDATE campaign_recipients SET ${updateFields.join(', ')} 
     WHERE campaign_id = $1 AND phone = $2 
     RETURNING *`,
    params
  );

  const recipient = result.rows[0];
  if (!recipient) return null;

  // Run all independent follow-up queries in parallel
  if (status === 'sent') {
    await Promise.all([
      pg.query(
        'UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1',
        [campaignId]
      ),
      incrementMonthlyCounters(userId, 'sent'),
      updateContactStats(userId, recipient, 'sent'),
      addMetricEvent(userId, {
        type: 'message_sent',
        campaignId,
        phone,
        contactId: recipient.contact_id,
        grupo: recipient.grupo || 'Sin grupo',
      }),
    ]);
  } else if (status === 'error') {
    await Promise.all([
      pg.query(
        'UPDATE campaigns SET error_count = error_count + 1 WHERE id = $1',
        [campaignId]
      ),
      incrementMonthlyCounters(userId, 'error'),
      updateContactStats(userId, recipient, 'error'),
      addMetricEvent(userId, {
        type: 'message_error',
        campaignId,
        phone,
        contactId: recipient.contact_id,
        grupo: recipient.grupo || 'Sin grupo',
        errorMessage: meta.errorMessage,
      }),
    ]);
  } else if (status === 'sending') {
    await addMetricEvent(userId, {
      type: 'message_sending',
      campaignId,
      phone,
      contactId: recipient.contact_id,
      grupo: recipient.grupo || 'Sin grupo',
    });
  }

  return mapRecipient(recipient);
}

async function getCampaignDetail(userId, campaignId) {
  const campaign = await getCampaign(userId, campaignId);
  if (!campaign) return null;

  const result = await pg.query(
    `SELECT * FROM campaign_recipients 
     WHERE campaign_id = $1 
     ORDER BY updated_at DESC`,
    [campaignId]
  );

  return {
    campaign,
    recipients: result.rows.map(mapRecipient)
  };
}

async function listCampaigns(userId, opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.max(1, Math.min(50, Number(opts.pageSize) || 20));
  const offset = (page - 1) * pageSize;

  // Build WHERE clauses
  const conditions = ['user_id = $1'];
  const params = [userId];
  let paramIdx = 2;

  if (opts.search) {
    conditions.push(`name ILIKE $${paramIdx}`);
    params.push(`%${opts.search}%`);
    paramIdx++;
  }

  if (opts.dateFrom) {
    conditions.push(`created_at >= $${paramIdx}`);
    params.push(opts.dateFrom);
    paramIdx++;
  }

  if (opts.dateTo) {
    conditions.push(`created_at <= $${paramIdx}::date + interval '1 day'`);
    params.push(opts.dateTo);
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await pg.query(
    `SELECT COUNT(*) as total FROM campaigns WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  const result = await pg.query(
    `SELECT * FROM campaigns WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, pageSize, offset]
  );

  return {
    items: result.rows.map(mapCampaign),
    total,
    page,
    pageSize
  };
}

// ========================================
// METRICS & DASHBOARD
// ========================================

async function addMetricEvent(userId, event) {
  await pg.query(
    `INSERT INTO metric_events (user_id, event_type, campaign_id, phone, contact_id, grupo, error_message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      event.type,
      event.campaignId || null,
      event.phone || null,
      event.contactId || null,
      event.grupo || null,
      event.errorMessage || null,
      event.metadata ? JSON.stringify(event.metadata) : null
    ]
  );
}

async function incrementMonthlyCounters(userId, status) {
  const month = formatMonth(new Date());
  const field = status === 'sent' ? 'sent_count' : 'error_count';
  
  await pg.query(
    `INSERT INTO monthly_stats (user_id, month, ${field})
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, month) 
     DO UPDATE SET ${field} = monthly_stats.${field} + 1, updated_at = NOW()`,
    [userId, month]
  );
}

async function updateContactStats(userId, recipient, status) {
  const phone = String(recipient.phone || '').trim();
  if (!phone) return;

  const field = status === 'sent' ? 'sent_count' : 'error_count';
  
  await pg.query(
    `INSERT INTO contact_stats (user_id, phone, contact_id, nombre, grupo, ${field}, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, 1, NOW())
     ON CONFLICT (user_id, phone) 
     DO UPDATE SET 
       ${field} = contact_stats.${field} + 1,
       nombre = COALESCE($4, contact_stats.nombre),
       grupo = COALESCE($5, contact_stats.grupo),
       last_activity_at = NOW()`,
    [userId, phone, recipient.contact_id, recipient.nombre, recipient.grupo]
  );
}

async function dashboardSummary(userId, from, to) {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const result = await pg.query(
    `SELECT 
       COUNT(*) FILTER (WHERE event_type = 'message_sent') as sent,
       COUNT(*) FILTER (WHERE event_type = 'message_error') as errors
     FROM metric_events 
     WHERE user_id = $1 AND created_at BETWEEN $2 AND $3`,
    [userId, new Date(range.start), new Date(range.end)]
  );

  const campaignsResult = await pg.query(
    `SELECT COUNT(*) as count FROM campaigns 
     WHERE user_id = $1 AND created_at BETWEEN $2 AND $3`,
    [userId, new Date(range.start), new Date(range.end)]
  );

  const sent = parseInt(result.rows[0].sent, 10);
  const errors = parseInt(result.rows[0].errors, 10);
  const delivered = sent + errors;
  const successRate = delivered > 0 ? Number(((sent * 100) / delivered).toFixed(2)) : 0;

  return {
    from: range.start,
    to: range.end,
    campaigns: parseInt(campaignsResult.rows[0].count, 10),
    sent,
    errors,
    delivered,
    successRate,
  };
}

async function dashboardTimeline(userId, from, to, bucket = 'day') {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const bucketFormat = bucket === 'hour' ? 'YYYY-MM-DD HH24:00' 
    : bucket === 'month' ? 'YYYY-MM' 
    : 'YYYY-MM-DD';

  const result = await pg.query(
    `SELECT 
       TO_CHAR(created_at, $4) as bucket,
       COUNT(*) FILTER (WHERE event_type = 'message_sent') as sent,
       COUNT(*) FILTER (WHERE event_type = 'message_error') as errors
     FROM metric_events 
     WHERE user_id = $1 
       AND created_at BETWEEN $2 AND $3
       AND event_type IN ('message_sent', 'message_error')
     GROUP BY TO_CHAR(created_at, $4)
     ORDER BY bucket`,
    [userId, new Date(range.start), new Date(range.end), bucketFormat]
  );

  return result.rows.map(r => ({
    bucket: r.bucket,
    sent: parseInt(r.sent, 10),
    errors: parseInt(r.errors, 10)
  }));
}

async function dashboardByGroup(userId, from, to) {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const result = await pg.query(
    `SELECT 
       COALESCE(grupo, 'Sin grupo') as group,
       COUNT(*) FILTER (WHERE event_type = 'message_sent') as sent,
       COUNT(*) FILTER (WHERE event_type = 'message_error') as errors,
       COUNT(*) as total
     FROM metric_events 
     WHERE user_id = $1 
       AND created_at BETWEEN $2 AND $3
       AND event_type IN ('message_sent', 'message_error')
     GROUP BY COALESCE(grupo, 'Sin grupo')
     ORDER BY total DESC`,
    [userId, new Date(range.start), new Date(range.end)]
  );

  return result.rows.map(r => ({
    group: r.group,
    sent: parseInt(r.sent, 10),
    errors: parseInt(r.errors, 10),
    total: parseInt(r.total, 10)
  }));
}

async function dashboardByContact(userId, from, to, limit = 20) {
  const range = parseRange(from, to);
  if (!range) throw new Error('Rango de fechas inválido');

  const result = await pg.query(
    `SELECT
      me.phone,
      COUNT(*) FILTER (WHERE me.event_type = 'message_sent') AS sent,
      COUNT(*) FILTER (WHERE me.event_type = 'message_error') AS errors,
      COUNT(*) AS total,
      c.nombre,
      c.grupo
    FROM metric_events me
    LEFT JOIN contacts c ON c.user_id = me.user_id AND c.phone = me.phone
    WHERE me.user_id = $1
      AND me.created_at BETWEEN $2 AND $3
      AND me.event_type IN ('message_sent', 'message_error')
      AND me.phone IS NOT NULL
    GROUP BY me.phone, c.nombre, c.grupo
    ORDER BY total DESC
    LIMIT $4`,
    [userId, new Date(range.start), new Date(range.end), limit]
  );

  return result.rows.map(row => ({
    phone: row.phone,
    nombre: row.nombre || null,
    grupo: row.grupo || null,
    sent: parseInt(row.sent) || 0,
    errors: parseInt(row.errors) || 0,
    total: parseInt(row.total) || 0
  }));
}

async function dashboardCurrentMonth(userId) {
  const now = new Date();
  const curMonth = formatMonth(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = formatMonth(prevDate);

  const result = await pg.query(
    `SELECT 
       month,
       sent_count as sent,
       error_count as errors
     FROM monthly_stats 
     WHERE user_id = $1 AND month IN ($2, $3)`,
    [userId, curMonth, prevMonth]
  );

  const current = result.rows.find(r => r.month === curMonth) || { sent: 0, errors: 0 };
  const previous = result.rows.find(r => r.month === prevMonth) || { sent: 0, errors: 0 };

  const sent = parseInt(current.sent, 10);
  const errors = parseInt(current.errors, 10);
  const prevSent = parseInt(previous.sent, 10);
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
  const result = await pg.query(
    `SELECT month, sent_count as sent, error_count as errors
     FROM monthly_stats 
     WHERE user_id = $1
     ORDER BY month DESC
     LIMIT $2`,
    [userId, months]
  );

  return result.rows.reverse().map(r => ({
    month: r.month,
    sent: parseInt(r.sent, 10),
    errors: parseInt(r.errors, 10),
    total: parseInt(r.sent, 10) + parseInt(r.errors, 10)
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

function mapContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    nombre: row.nombre,
    tratamiento: row.sustantivo,
    grupo: row.grupo,
    source: row.source,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).getTime() : null,
  };
}

function mapCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    messageType: row.message_type,
    templateCount: row.template_count,
    totalRecipients: row.total_recipients,
    sentCount: row.sent_count,
    errorCount: row.error_count,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null,
  };
}

function mapRecipient(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    phone: row.phone,
    nombre: row.nombre,
    tratamiento: row.sustantivo,
    grupo: row.grupo,
    status: row.status,
    templateIndex: row.template_index,
    attempts: row.attempts,
    errorMessage: row.error_message,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    sentAt: row.sent_at ? new Date(row.sent_at).getTime() : null,
    errorAt: row.error_at ? new Date(row.error_at).getTime() : null,
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
