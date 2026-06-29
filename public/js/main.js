/**
 * Main - Application Entry Point
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Iniciando Monchito WA...');

  // Wait for Firebase config to load before anything else
  await firebaseConfigReady;

  // Initialize authentication
  const authSuccess = await initFirebaseAuth();

  if (!authSuccess) {
    console.error('Fallo la autenticacion');
    return;
  }

  console.log('Autenticacion correcta');

  // Create/claim session (single active session enforcement)
  if (!localStorage.getItem('sessionToken')) {
    await createAppSession();
  }

  // Load user profile (trial status, role, etc.)
  await loadUserProfile();

  // Load plan features (for feature gating)
  await loadPlanFeatures();

  // Load country configs (for phone formatting/placeholders)
  await getCountryConfigs().catch(function() {});

  // Check country selection (blocking modal on first login)
  await checkCountrySelection();

  // Update phone placeholders with user's country code
  updatePhonePlaceholders();

  // Setup country indicator click handler
  var countryIndicator = document.getElementById('country-indicator');
  if (countryIndicator) {
    countryIndicator.addEventListener('click', function() {
      showCountryChangeModal();
    });
  }

  // Setup theme
  setupThemeToggle();

  // Setup profile dropdown menu
  setupProfileMenu();

  // Setup more dropdown menu
  setupMoreMenu();

  // Setup tab navigation
  setupTabNavigation();
  
  // Initialize modules
  initDashboard();
  initWhatsApp();
  initMessages();
  initContacts();
  initTemplates();
  initPlans();
  initApi();
  // Show admin tab if user is admin (after profile is loaded)
  if (window.userProfile && window.userProfile.role === 'admin') {
    var adminTabBtn = document.getElementById('admin-tab-btn');
    if (adminTabBtn) adminTabBtn.classList.remove('d-none');
  }
  if (typeof initInbox === 'function') initInbox();
  if (typeof initCampaigns === 'function') initCampaigns();
  if (typeof initChatbot === 'function') initChatbot();
  if (typeof initAdmin === 'function') initAdmin();

  // Logout is now handled by setupProfileMenu() via #profile-logout-btn
  
  // Initial tab from hash or default to dashboard
  const hash = window.location.hash.substring(1);
  const validTabs = ['dashboard', 'whatsapp', 'send', 'templates', 'contacts', 'campaigns', 'inbox', 'chatbot', 'api', 'admin'];
  const initialTab = validTabs.includes(hash) ? hash : 'dashboard';
  showTab(initialTab);
  
  console.log('🎉 Aplicación iniciada correctamente');
});

// Setup tab navigation (primary tabs only — dropdown items handled by setupMoreMenu)
function setupTabNavigation() {
  document.querySelectorAll('.tabs-nav > .tab-btn').forEach(btn => {
    // Skip the "Mas" trigger — it's handled by setupMoreMenu
    if (btn.classList.contains('tab-more-trigger')) return;

    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Check if send tab requires connection
      if (tab === 'send' && !window.isWhatsAppConnected?.()) {
        showAlert('Primero conecta WhatsApp', 'warning');
        showTab('whatsapp');
        return;
      }

      showTab(tab);
    });
  });
}
