// src/middleware/planGate.js
const PLAN_FEATURES = {
  expired:     { send: -1,    contacts: -1,   templates: -1, chatbot: true,  chatbotAi: true,  inbox: true,  api: true,  campaigns: true },
  trial:       { send: -1,    contacts: -1,   templates: -1, chatbot: true,  chatbotAi: true,  inbox: true,  api: true,  campaigns: true },
  basico:      { send: -1,    contacts: -1,   templates: -1, chatbot: true,  chatbotAi: true,  inbox: true,  api: true,  campaigns: true },
  profesional: { send: -1,    contacts: -1,   templates: -1, chatbot: true,  chatbotAi: true,  inbox: true,  api: true,  campaigns: true },
  premium:     { send: -1,    contacts: -1,   templates: -1, chatbot: true,  chatbotAi: true,  inbox: true,  api: true,  campaigns: true },
  enterprise:  { send: -1,    contacts: -1,   templates: -1, chatbot: true,  chatbotAi: true,  inbox: true,  api: true,  campaigns: true },
  active:      { send: -1,    contacts: -1,   templates: -1, chatbot: true,  chatbotAi: true,  inbox: true,  api: true,  campaigns: true }, // legacy
};
// -1 = unlimited

const PLAN_ALIASES = {
  basic: 'basico',
  pro: 'profesional',
  professional: 'profesional',
};

function normalizePlan(plan) {
  const key = String(plan || 'expired').toLowerCase();
  return PLAN_ALIASES[key] || key;
}

function getPlanFeatures(plan, role) {
  return PLAN_FEATURES[normalizePlan(plan)] || PLAN_FEATURES.enterprise;
}

function planHasFeature(plan, role, featureName) {
  const features = getPlanFeatures(plan, role);
  return !!features[featureName];
}

function canUseProfessionalFeatures(plan, role) {
  return true;
}

/**
 * Middleware factory: expose feature metadata without blocking by plan.
 * Usage: requireFeature('chatbot'), requireFeature('inbox')
 */
function requireFeature(featureName) {
  return (req, res, next) => {
    const plan = normalizePlan(req.userProfile?.plan || 'expired');
    const role = req.userProfile?.role;
    const features = getPlanFeatures(plan, role);

    req.planFeatures = features;
    next();
  };
}

/**
 * Middleware factory: attach unlimited plan limits without blocking by plan.
 * Usage: requireLimit('send'), requireLimit('contacts'), requireLimit('templates')
 * Sets req.planLimit (-1 = unlimited)
 */
function requireLimit(limitName) {
  return (req, res, next) => {
    const plan = normalizePlan(req.userProfile?.plan || 'expired');
    const role = req.userProfile?.role;
    const features = getPlanFeatures(plan, role);

    req.planLimit = -1; // unlimited
    req.planFeatures = features;
    next();
  };
}

module.exports = {
  requireFeature,
  requireLimit,
  getPlanFeatures,
  planHasFeature,
  canUseProfessionalFeatures,
  normalizePlan,
  PLAN_FEATURES
};
