const usePostgres = !!process.env.POSTGRES_HOST;
const { firebaseAvailable } = require('./firebaseAdmin');

const metricsStoreMethods = [
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

function createStub() {
  const logger = require('./logger');
  const stub = {};

  metricsStoreMethods.forEach(m => {
    stub[m] = async () => {
      logger.warn({ method: m }, `metricsStore.${m} called but no database configured. Configure Firebase Admin or set POSTGRES_HOST as fallback.`);
      return null;
    };
  });

  return stub;
}

if (firebaseAvailable) {
  module.exports = require('./metricsStoreFirestore');
} else if (usePostgres) {
  module.exports = require('./metricsStorePostgres');
} else {
  module.exports = createStub();
}
