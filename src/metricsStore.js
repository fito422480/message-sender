const usePostgres = !!process.env.POSTGRES_HOST;
const { firebaseAvailable } = require('./firebaseAdmin');

const contactMethods = [
  'getContactByPhone',
  'getContactById',
  'upsertContact',
  'updateContact',
  'deleteContact',
  'listContacts',
  'getContactGroups',
  'getContactsByIds',
  'getContactsByGroup',
  'importContactsFromEntries',
];

function createStub() {
  const logger = require('./logger');
  const stub = {};
  const methods = [
    ...contactMethods,
    'createCampaign',
    'getCampaign',
    'setCampaignStatus',
    'initCampaignRecipients',
    'recordRecipientStatus',
    'getCampaignDetail',
    'listCampaigns',
    'dashboardSummary',
    'dashboardTimeline',
    'dashboardByGroup',
    'dashboardByContact',
    'dashboardCurrentMonth',
    'dashboardMonthly',
    'addMetricEvent',
  ];

  methods.forEach(m => {
    stub[m] = async () => {
      logger.warn({ method: m }, `metricsStore.${m} called but no database configured. Set POSTGRES_HOST or configure Firebase.`);
      return null;
    };
  });

  return stub;
}

function withFirestoreContacts(primaryStore) {
  const contactsStorePreference = String(process.env.CONTACTS_STORE || 'firestore').toLowerCase();
  if (!firebaseAvailable || contactsStorePreference === 'postgres') {
    return primaryStore;
  }

  const firestoreStore = require('./metricsStoreFirestore');
  const hybridStore = { ...primaryStore };

  contactMethods.forEach(method => {
    hybridStore[method] = firestoreStore[method];
  });

  return hybridStore;
}

if (usePostgres) {
  module.exports = withFirestoreContacts(require('./metricsStorePostgres'));
} else if (firebaseAvailable) {
  module.exports = require('./metricsStoreFirestore');
} else {
  module.exports = createStub();
}
