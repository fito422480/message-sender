const usePostgres = !!process.env.POSTGRES_HOST;

if (usePostgres) {
  module.exports = require('./metricsStorePostgres');
} else {
  const { firebaseAvailable } = require('./firebaseAdmin');
  if (firebaseAvailable) {
    module.exports = require('./metricsStoreFirestore');
  } else {
    const logger = require('./logger');
    const stub = {};
    const methods = ['getContactByPhone', 'getContactById', 'upsertContact', 'updateContact', 'deleteContact', 'listContacts', 'getContactGroups', 'getContactsByIds', 'getContactsByGroup', 'importContactsFromEntries', 'createCampaign', 'getCampaign', 'setCampaignStatus', 'initCampaignRecipients', 'recordRecipientStatus', 'getCampaignDetail', 'listCampaigns', 'dashboardSummary', 'dashboardTimeline', 'dashboardByGroup', 'dashboardByContact', 'dashboardCurrentMonth', 'dashboardMonthly', 'addMetricEvent'];

    methods.forEach(m => {
      stub[m] = async (...args) => {
        logger.warn({ method: m }, `metricsStore.${m} called but no database configured. Set POSTGRES_HOST or configure Firebase.`);
        return null;
      };
    });

    module.exports = stub;
  }
}
