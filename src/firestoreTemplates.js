const { admin, db } = require('./firebaseAdmin');
const FieldValue = admin.firestore.FieldValue;

const col = (uid) => db.collection(`users/${uid}/templates`);

async function getTemplateCount(userId) {
  const snap = await col(userId).get();
  return snap.size;
}

async function listTemplates(userId, category) {
  let query = col(userId).orderBy('updatedAt', 'desc');
  if (category) {
    query = query.where('category', '==', category);
  }
  const snap = await query.get();
  const items = [];
  snap.forEach(d => {
    items.push({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toMillis(), updatedAt: d.data().updatedAt?.toMillis() });
  });
  return items;
}

async function createTemplate(userId, name, content, category, variables) {
  const ref = col(userId).doc();
  const data = {
    name,
    content,
    category: category || null,
    variables: variables || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(data);
  const snap = await ref.get();
  return { id: snap.id, ...snap.data() };
}

async function updateTemplate(userId, id, name, content, category, variables) {
  const ref = col(userId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({
    name,
    content,
    category: category || null,
    variables: variables || null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const after = await ref.get();
  return { id: after.id, ...after.data() };
}

async function deleteTemplate(userId, id) {
  const ref = col(userId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

module.exports = { getTemplateCount, listTemplates, createTemplate, updateTemplate, deleteTemplate };
