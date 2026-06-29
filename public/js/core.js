/**
 * Core - Firebase Authentication, Utils, and Base Functions
 */

// Firebase configuration — loaded from backend
var firebaseConfigReady = fetch('/config/firebase')
  .then(function(res) {
    if (!res.ok) throw new Error('Failed to load Firebase config');
    return res.json();
  })
  .then(function(config) {
    firebase.initializeApp(config);
    return config;
  })
  .catch(function(err) {
    console.error('Could not load Firebase config:', err);
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f87171;font-family:sans-serif;text-align:center;padding:2rem;">' +
      '<div><h2>Error de configuracion</h2><p>No se pudo cargar la configuracion de Firebase. Recarga la pagina o contacta al administrador.</p></div></div>';
    throw err;
  });

// Authentication state
var currentUser = null;
var pollingInterval = null;

// API Base - authenticated fetch
async function authFetch(url, options) {
  options = options || {};

  if (!currentUser) {
    console.error('Not authenticated');
    throw new Error('Not authenticated');
  }

  var token;
  try {
    token = await currentUser.getIdToken();
  } catch (err) {
    console.warn('Token refresh failed, redirecting to login');
    window.location.href = '/login.html';
    return;
  }

  var headers = {
    'Authorization': 'Bearer ' + token
  };

  // Attach session token if available
  var sessionToken = localStorage.getItem('sessionToken');
  if (sessionToken) {
    headers['X-Session-Token'] = sessionToken;
  }

  // Merge existing headers
  if (options.headers) {
    var existing = options.headers;
    for (var key in existing) {
      if (existing.hasOwnProperty(key)) {
        headers[key] = existing[key];
      }
    }
  }

  if (!(options.body instanceof FormData) && options.body) {
    headers['Content-Type'] = 'application/json';
  }

  var fetchOptions = {};
  for (var k in options) {
    if (options.hasOwnProperty(k)) {
      fetchOptions[k] = options[k];
    }
  }
  fetchOptions.headers = headers;

  var response = await fetch(url, fetchOptions);

  // Capture session token from response header
  var newSessionToken = response.headers.get('X-Session-Token');
  if (newSessionToken) {
    localStorage.setItem('sessionToken', newSessionToken);
  }

  // Intercept 401 session conflict
  if (response.status === 401) {
    try {
      var cloned401 = response.clone();
      var body401 = await cloned401.json();
      if (body401.error === 'session_conflict') {
        showSessionConflictModal();
        return response;
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  // Intercept 403 trial/account/verification errors
  if (response.status === 403) {
    try {
      var cloned = response.clone();
      var body = await cloned.json();
      if (body.error === 'email_not_verified') {
        // Reload user to get fresh state, then show verification block
        var freshUser = firebase.auth().currentUser;
        if (freshUser) {
          showEmailVerificationBlock(freshUser);
        }
      } else if (body.error === 'trial_expired') {
        showTrialExpiredModal(body.trialEndsAt);
      } else if (body.error === 'account_inactive') {
        showTrialExpiredModal(null, true);
      } else if (body.error === 'account_suspended') {
        showAccountBlockedModal('suspended', body.message);
      } else if (body.error === 'account_disabled') {
        showAccountBlockedModal('disabled', body.message);
      } else if (body.error === 'plan_restricted' || body.error === 'plan_limit_reached') {
        showPlanUpgradeModal(body.feature, body.message, body.currentPlan);
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  return response;
}

// Initialize Firebase Auth
function initFirebaseAuth() {
  return new Promise(function(resolve, reject) {
    var unsubscribe = firebase.auth().onAuthStateChanged(function(user) {
      unsubscribe();

      if (user) {
        // Check if email is verified (Google users are auto-verified)
        var isGoogle = user.providerData.length > 0 &&
          user.providerData[0].providerId === 'google.com';

        if (!isGoogle && !user.emailVerified) {
          // Block unverified users — show verification pending UI
          hideLoadingScreen();
          showEmailVerificationBlock(user);
          resolve(false);
          return;
        }

        currentUser = user;
        updateUserInfo();
        hideLoadingScreen();
        resolve(true);
      } else {
        // Not authenticated - redirect to login
        window.location.href = '/login.html';
        resolve(false);
      }
    }, function(error) {
      unsubscribe();
      console.error('Firebase auth error:', error);
      hideLoadingScreen();
      showAlert('Error de autenticación. Intente recargar la página.', 'danger', 'Error');
      reject(error);
    });
  });
}

// Show blocking UI when email is not verified
function showEmailVerificationBlock(user) {
  // Create overlay that blocks the entire app
  var overlay = document.createElement('div');
  overlay.id = 'email-verify-overlay';
  overlay.className = 'trial-modal-overlay';
  overlay.innerHTML =
    '<div class="trial-modal-card" style="max-width: 440px;">' +
      '<div class="trial-modal-icon"><i class="bi bi-envelope-check" style="color:#25D366;font-size:2.5rem;"></i></div>' +
      '<h2>Verifica tu correo electronico</h2>' +
      '<p>Enviamos un enlace de verificacion a:</p>' +
      '<p style="color:#25D366; font-weight:600; margin: 0.25rem 0 1rem;">' + (user.email || '') + '</p>' +
      '<div id="verifyOverlayAlert" style="margin-bottom:1rem;"></div>' +
      '<div class="trial-modal-actions" style="flex-direction:column; gap:0.5rem;">' +
        '<button class="btn-primary" id="overlayCheckVerifiedBtn" style="width:100%;">' +
          '<i class="bi bi-check-circle"></i> Ya verifique mi correo' +
        '</button>' +
        '<button class="btn-primary" id="overlayResendBtn" style="width:100%; background:var(--bg-tertiary,#242b33); color:var(--text-primary,#e7e9ea);">' +
          '<i class="bi bi-arrow-repeat"></i> Reenviar correo de verificacion' +
        '</button>' +
        '<button class="btn-primary" id="overlayLogoutBtn" style="width:100%; background:transparent; color:var(--text-secondary,#8b98a5); border:1px solid var(--border-color,#2f3640);">' +
          'Cerrar sesion' +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  function showOverlayMsg(msg, isSuccess) {
    var el = document.getElementById('verifyOverlayAlert');
    if (!el) return;
    el.style.padding = '0.6rem 1rem';
    el.style.borderRadius = '6px';
    el.style.fontSize = '0.875rem';
    if (isSuccess) {
      el.style.background = 'rgba(74, 222, 128, 0.1)';
      el.style.color = '#4ade80';
      el.style.border = '1px solid rgba(74, 222, 128, 0.2)';
    } else {
      el.style.background = 'rgba(248, 113, 113, 0.1)';
      el.style.color = '#f87171';
      el.style.border = '1px solid rgba(248, 113, 113, 0.2)';
    }
    el.textContent = msg;
  }

  // "Ya verifique" button
  document.getElementById('overlayCheckVerifiedBtn').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Verificando...';

    user.reload().then(function() {
      var freshUser = firebase.auth().currentUser;
      if (freshUser && freshUser.emailVerified) {
        // Verified — reload the page to proceed normally
        window.location.reload();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle"></i> Ya verifique mi correo';
        showOverlayMsg('Todavia no verificaste tu correo. Revisa tu bandeja de entrada.', false);
      }
    }).catch(function() {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle"></i> Ya verifique mi correo';
      showOverlayMsg('Error al verificar. Intenta de nuevo.', false);
    });
  });

  // "Reenviar" button
  document.getElementById('overlayResendBtn').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    user.sendEmailVerification().then(function() {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Reenviar correo de verificacion';
      showOverlayMsg('Correo de verificacion reenviado.', true);
    }).catch(function(err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Reenviar correo de verificacion';
      if (err.code === 'auth/too-many-requests') {
        showOverlayMsg('Demasiados intentos. Espera unos minutos.', false);
      } else {
        showOverlayMsg('Error al reenviar. Intenta de nuevo.', false);
      }
    });
  });

  // Logout button
  document.getElementById('overlayLogoutBtn').addEventListener('click', function() {
    firebase.auth().signOut().then(function() {
      currentUser = null;
      window.location.href = '/login.html';
    });
  });
}

// Update user info in UI
function updateUserInfo() {
  var userInfoEl = document.getElementById('user-info');
  var userNameEl = document.getElementById('user-name');
  var userEmailEl = document.getElementById('user-email');

  if (currentUser) {
    var name = currentUser.displayName || currentUser.email || 'Usuario';
    var email = currentUser.email || '';

    if (userNameEl) userNameEl.textContent = name;
    if (userEmailEl) userEmailEl.textContent = email;
    if (userInfoEl) userInfoEl.classList.remove('d-none');
  }
}

// Session management — create a new session after login
async function createAppSession() {
  if (!currentUser) return null;

  try {
    var token = await currentUser.getIdToken();
    var resp = await fetch('/auth/session', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });

    if (!resp.ok) {
      console.error('Failed to create session:', resp.status);
      return null;
    }

    var data = await resp.json();
    if (data.sessionToken) {
      localStorage.setItem('sessionToken', data.sessionToken);
      console.log('Session created successfully');
      return data.sessionToken;
    }
  } catch (err) {
    console.error('Error creating session:', err);
  }
  return null;
}

// Session conflict modal
function showSessionConflictModal() {
  // Prevent duplicates
  var existing = document.getElementById('session-conflict-modal');
  if (existing) return;

  var modal = document.createElement('div');
  modal.id = 'session-conflict-modal';
  modal.className = 'trial-modal-overlay';
  modal.innerHTML =
    '<div class="trial-modal-card">' +
      '<div class="trial-modal-icon"><i class="bi bi-laptop" style="color:#e67e22;"></i></div>' +
      '<h2>Sesion activa en otro dispositivo</h2>' +
      '<p>Tu cuenta fue abierta desde otro navegador o dispositivo. Solo se permite una sesion activa.</p>' +
      '<div class="trial-modal-actions">' +
        '<button class="btn-primary" id="sessionConflictUseHereBtn">Usar aqui</button>' +
        '<button class="btn-secondary" onclick="logout()" style="margin-left:8px;">Cerrar sesion</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  document.getElementById('sessionConflictUseHereBtn').addEventListener('click', async function() {
    this.disabled = true;
    this.textContent = 'Conectando...';
    var token = await createAppSession();
    if (token) {
      var m = document.getElementById('session-conflict-modal');
      if (m) m.remove();
      // Reload to re-fetch data with new session
      window.location.reload();
    } else {
      this.disabled = false;
      this.textContent = 'Usar aqui';
      showAlert('Error al crear sesion. Intente de nuevo.', 'danger');
    }
  });
}

// Logout
function logout() {
  // Clear session from backend (fire-and-forget)
  if (currentUser) {
    currentUser.getIdToken().then(function(token) {
      fetch('/auth/logout-session', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      }).catch(function() {});
    }).catch(function() {});
  }

  // Clear local session token
  localStorage.removeItem('sessionToken');

  firebase.auth().signOut().then(function() {
    currentUser = null;
    window.location.href = '/login.html';
  }).catch(function(error) {
    console.error('Logout error:', error);
    // Force redirect anyway
    window.location.href = '/login.html';
  });
}

// Loading Screen
function hideLoadingScreen() {
  var loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('fade-out');
    setTimeout(function() { loadingScreen.remove(); }, 500);
  }
}

// Alert System
function showAlert(message, type, title) {
  type = type || 'info';
  title = title || null;
  var container = document.getElementById('alert-container');
  if (!container) return;

  var dismissTime = 5000;
  var alertEl = document.createElement('div');
  alertEl.className = 'alert alert-' + type;

  var iconMap = {
    success: 'bi-check-circle-fill',
    danger: 'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info: 'bi-info-circle-fill'
  };

  function removeAlert() {
    if (alertEl.classList.contains('alert-removing')) return;
    alertEl.classList.add('alert-removing');
    setTimeout(function() { alertEl.remove(); }, 300);
  }

  alertEl.innerHTML =
    '<div class="alert-body">' +
      '<div class="alert-icon"><i class="bi ' + (iconMap[type] || iconMap.info) + '"></i></div>' +
      '<div class="alert-text">' +
        (title ? '<strong>' + title + '</strong>' : '') +
        message +
      '</div>' +
    '</div>' +
    '<button type="button" class="alert-close-btn" aria-label="Cerrar"><i class="bi bi-x-lg"></i></button>' +
    '<div class="alert-progress" style="animation-duration: ' + dismissTime + 'ms;"></div>';

  alertEl.querySelector('.alert-close-btn').addEventListener('click', removeAlert);

  container.appendChild(alertEl);
  setTimeout(removeAlert, dismissTime);
}

// Theme Toggle
function setupThemeToggle() {
  var themeSwitch = document.getElementById('themeSwitch');
  if (!themeSwitch) return;

  var savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeSwitch.checked = savedTheme === 'light';

  themeSwitch.addEventListener('change', function() {
    var theme = themeSwitch.checked ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    // Redraw charts if needed
    if (typeof loadDashboard === 'function') {
      loadDashboard();
    }
  });
}

// More menu dropdown
function setupMoreMenu() {
  var wrapper = document.querySelector('.tab-more-wrapper');
  var trigger = document.getElementById('moreTabsBtn');
  var menu = document.getElementById('moreTabsMenu');
  if (!wrapper || !trigger || !menu) return;

  // Toggle dropdown on click
  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    wrapper.classList.toggle('open');
  });

  // Close on click outside
  document.addEventListener('click', function(e) {
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove('open');
    }
  });

  // Handle dropdown item clicks
  menu.querySelectorAll('.tab-more-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var tab = item.dataset.tab;
      wrapper.classList.remove('open');

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

// Tab Navigation
function showTab(tabId) {
  // Plan restrictions removed: allow navigation to all tabs.

  // Determine if tab is in the dropdown
  var isDropdownTab = false;
  var dropdownItem = document.querySelector(
    '.tab-more-item[data-tab="' + tabId + '"]',
  );
  if (dropdownItem) {
    isDropdownTab = true;
  }

  // Update primary tab buttons
  document.querySelectorAll(".tabs-nav > .tab-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });

  // Update dropdown items
  document.querySelectorAll(".tab-more-item").forEach(function (item) {
    item.classList.toggle("active", item.dataset.tab === tabId);
  });

  // Highlight the "Mas" trigger when a dropdown tab is active
  var moreTrigger = document.getElementById("moreTabsBtn");
  if (moreTrigger) {
    moreTrigger.classList.toggle("active", isDropdownTab);
  }

  // Update panes
  document.querySelectorAll(".tab-pane").forEach(function (pane) {
    pane.classList.toggle("active", pane.id === tabId);
  });

  // Update hash
  history.replaceState(null, "", "#" + tabId);

  // Load tab content
  if (tabId === "dashboard" && typeof loadDashboard === "function") {
    loadDashboard();
  } else if (tabId === "contacts" && typeof loadContacts === "function") {
    loadContacts();
  } else if (tabId === "templates" && typeof loadTemplates === "function") {
    loadTemplates();
  } else if (tabId === "plans" && typeof loadPlans === "function") {
    loadPlans();
  } else if (tabId === "api" && typeof loadApi === "function") {
    loadApi();
  } else if (tabId === "inbox" && typeof loadInbox === "function") {
    loadInbox();
  } else if (tabId === "campaigns" && typeof loadCampaigns === "function") {
    loadCampaigns();
  } else if (tabId === "chatbot" && typeof loadChatbot === "function") {
    loadChatbot();
  } else if (tabId === "admin" && typeof loadAdmin === "function") {
    loadAdmin();
  }

  // Stop inbox polling when leaving inbox tab
  if (tabId !== "inbox" && typeof stopInboxPolling === "function") {
    stopInboxPolling();
  }
}

// Query builder
function buildQuery(params) {
  params = params || {};
  var q = new URLSearchParams();
  Object.entries(params).forEach(function(entry) {
    var k = entry[0];
    var v = entry[1];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      q.set(k, String(v));
    }
  });
  var s = q.toString();
  return s ? '?' + s : '';
}

// Get chart text color based on theme
function getChartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#d8dee9';
}

// Trial status
var userProfile = null;

function loadUserProfile() {
  return authFetch('/user/profile')
    .then(function(res) {
      if (!res || !res.ok) return null;
      return res.json();
    })
    .then(function(profile) {
      if (!profile) return;
      userProfile = profile;
      window.userProfile = profile;
      updateTrialBadge(profile);
      return profile;
    })
    .catch(function(err) {
      console.error('Failed to load user profile:', err);
    });
}

function updateTrialBadge(profile) {
  var badge = document.getElementById('trial-badge');
  if (!badge) return;

  if (profile.role === 'admin') {
    badge.innerHTML = '<i class="bi bi-shield-check"></i> Admin';
    badge.className = 'trial-badge badge-admin';
    badge.classList.remove('d-none');
    return;
  }

  var paidPlanNames = {
    'active': 'Plan Activo',
    'basico': 'Basico',
    'profesional': 'Profesional',
    'premium': 'Premium',
    'enterprise': 'Enterprise'
  };

  if (paidPlanNames[profile.plan]) {
    badge.innerHTML = '<i class="bi bi-check-circle"></i> ' + paidPlanNames[profile.plan];
    badge.className = 'trial-badge badge-active';
    badge.classList.remove('d-none');
    return;
  }

  if (profile.plan === 'trial' && profile.trialDaysLeft > 0) {
    badge.innerHTML = '<i class="bi bi-clock"></i> Prueba: ' + profile.trialDaysLeft + ' dias';
    badge.className = 'trial-badge badge-trial';
    if (profile.trialDaysLeft <= 3) {
      badge.className += ' badge-trial-urgent';
    }
    badge.classList.remove('d-none');
    return;
  }

  if (profile.plan === 'expired' || (profile.plan === 'trial' && profile.trialDaysLeft <= 0)) {
    badge.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Expirado';
    badge.className = 'trial-badge badge-expired';
    badge.classList.remove('d-none');
    showTrialExpiredModal(null, profile.plan === 'expired');
    return;
  }
}

function showTrialExpiredModal(trialEndsAt, isInactive) {
  // Remove existing modal if any
  var existing = document.getElementById('trial-expired-modal');
  if (existing) existing.remove();

  var title = isInactive ? 'Cuenta Inactiva' : 'Periodo de Prueba Expirado';
  var message = isInactive
    ? 'Tu cuenta esta inactiva. Contacta al administrador para activar tu plan.'
    : 'Tu periodo de prueba ha expirado. Contacta al administrador para continuar usando el servicio.';

  var modal = document.createElement('div');
  modal.id = 'trial-expired-modal';
  modal.className = 'trial-modal-overlay';
  modal.innerHTML =
    '<div class="trial-modal-card">' +
      '<div class="trial-modal-icon"><i class="bi bi-exclamation-triangle-fill"></i></div>' +
      '<h2>' + title + '</h2>' +
      '<p>' + message + '</p>' +
      (trialEndsAt ? '<p class="trial-date">Expiro: ' + new Date(trialEndsAt).toLocaleDateString() + '</p>' : '') +
      '<div class="trial-modal-actions">' +
        '<button class="btn-primary" onclick="logout()">Cerrar Sesion</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
}

// Account blocked modal (suspended/disabled)
function showAccountBlockedModal(type, message) {
  var existing = document.getElementById('account-blocked-modal');
  if (existing) existing.remove();

  var title = type === 'suspended' ? 'Cuenta Suspendida' : 'Cuenta Deshabilitada';
  var msg = message || (type === 'suspended'
    ? 'Tu cuenta ha sido suspendida. Contacta al administrador.'
    : 'Tu cuenta ha sido deshabilitada. Contacta al administrador.');
  var iconColor = type === 'suspended' ? '#f59e0b' : '#ef4444';

  var modal = document.createElement('div');
  modal.id = 'account-blocked-modal';
  modal.className = 'trial-modal-overlay';
  modal.innerHTML =
    '<div class="trial-modal-card">' +
      '<div class="trial-modal-icon"><i class="bi bi-shield-exclamation" style="color:' + iconColor + ';"></i></div>' +
      '<h2>' + title + '</h2>' +
      '<p>' + msg + '</p>' +
      '<div class="trial-modal-actions">' +
        '<button class="btn-primary" onclick="logout()">Cerrar Sesion</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
}

// ========== Country Selector ==========

var COUNTRY_FLAGS = {
  PY: '\u{1F1F5}\u{1F1FE}', AR: '\u{1F1E6}\u{1F1F7}', BR: '\u{1F1E7}\u{1F1F7}',
  CL: '\u{1F1E8}\u{1F1F1}', UY: '\u{1F1FA}\u{1F1FE}', CO: '\u{1F1E8}\u{1F1F4}',
  PE: '\u{1F1F5}\u{1F1EA}', EC: '\u{1F1EA}\u{1F1E8}', BO: '\u{1F1E7}\u{1F1F4}',
  VE: '\u{1F1FB}\u{1F1EA}', MX: '\u{1F1F2}\u{1F1FD}', US: '\u{1F1FA}\u{1F1F8}',
  ES: '\u{1F1EA}\u{1F1F8}'
};

/**
 * Check if country selection is needed and show modal if so.
 * Returns a promise that resolves when country is confirmed.
 */
function checkCountrySelection() {
  return new Promise(function(resolve) {
    var confirmed = localStorage.getItem('countryConfirmed');
    if (confirmed) {
      updateCountryIndicator();
      resolve();
      return;
    }
    showCountrySelectorModal(resolve);
  });
}

/**
 * Show blocking country selector modal.
 */
function showCountrySelectorModal(onConfirm) {
  // Remove existing if present
  var existing = document.getElementById('country-selector-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'country-selector-modal';
  modal.className = 'trial-modal-overlay';

  modal.innerHTML =
    '<div class="trial-modal-card country-selector-card">' +
      '<div class="trial-modal-icon" style="color: var(--accent);">' +
        '<i class="bi bi-globe-americas"></i>' +
      '</div>' +
      '<h2>Selecciona tu pais</h2>' +
      '<p>El pais determina como se validan los numeros de telefono</p>' +
      '<div class="country-select-wrapper">' +
        '<select id="countrySelectDropdown" class="country-select">' +
          '<option value="" disabled selected>-- Elige un pais --</option>' +
        '</select>' +
      '</div>' +
      '<div id="countrySelectError" class="country-select-error"></div>' +
      '<div class="trial-modal-actions">' +
        '<button class="btn-primary" id="confirmCountryBtn" disabled>Confirmar</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  // Fetch countries and populate dropdown
  authFetch('/phone/countries')
    .then(function(res) { return res.json(); })
    .then(function(countries) {
      var select = document.getElementById('countrySelectDropdown');
      if (!select) return;

      var currentCountry = (window.userProfile && window.userProfile.country) || '';

      Object.keys(countries).forEach(function(code) {
        var c = countries[code];
        var flag = COUNTRY_FLAGS[code] || '';
        var option = document.createElement('option');
        option.value = code;
        option.textContent = flag + ' ' + c.name + ' (+' + c.code + ')';
        if (code === currentCountry) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      // Enable confirm button when selection changes
      select.addEventListener('change', function() {
        var btn = document.getElementById('confirmCountryBtn');
        if (btn) btn.disabled = !select.value;
      });

      // If current country was pre-selected, enable button
      if (select.value) {
        var btn = document.getElementById('confirmCountryBtn');
        if (btn) btn.disabled = false;
      }
    })
    .catch(function() {
      var errEl = document.getElementById('countrySelectError');
      if (errEl) errEl.textContent = 'Error al cargar paises. Recarga la pagina.';
    });

  // Confirm button handler
  document.getElementById('confirmCountryBtn').addEventListener('click', function() {
    var select = document.getElementById('countrySelectDropdown');
    var selectedCode = select ? select.value : '';
    if (!selectedCode) return;

    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    authFetch('/user/country', {
      method: 'PUT',
      body: JSON.stringify({ country: selectedCode })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        localStorage.setItem('countryConfirmed', selectedCode);
        if (window.userProfile) {
          window.userProfile.country = selectedCode;
          userProfile = window.userProfile;
        }
        updateCountryIndicator();
        // Refresh country configs cache and update placeholders
        _countryConfigsCache = null;
        getCountryConfigs().then(function() { updatePhonePlaceholders(); }).catch(function() {});
        var m = document.getElementById('country-selector-modal');
        if (m) m.remove();
        if (typeof onConfirm === 'function') onConfirm();
      } else {
        throw new Error(data.error || 'Error al guardar');
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Confirmar';
      var errEl = document.getElementById('countrySelectError');
      if (errEl) errEl.textContent = err.message || 'Error al guardar pais';
    });
  });
}

/**
 * Show country change modal (non-blocking, from settings/navbar).
 */
function showCountryChangeModal() {
  var existing = document.getElementById('country-change-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'country-change-modal';
  modal.className = 'trial-modal-overlay';

  modal.innerHTML =
    '<div class="trial-modal-card country-selector-card">' +
      '<div class="trial-modal-icon" style="color: var(--accent);">' +
        '<i class="bi bi-globe-americas"></i>' +
      '</div>' +
      '<h2>Cambiar pais</h2>' +
      '<p class="country-change-warning">' +
        '<i class="bi bi-exclamation-triangle"></i> ' +
        'Cambiar el pais afectara la validacion de numeros de telefono' +
      '</p>' +
      '<div class="country-select-wrapper">' +
        '<select id="countryChangeDropdown" class="country-select">' +
          '<option value="" disabled>-- Elige un pais --</option>' +
        '</select>' +
      '</div>' +
      '<div id="countryChangeError" class="country-select-error"></div>' +
      '<div class="trial-modal-actions" style="display:flex; gap:0.5rem; justify-content:center;">' +
        '<button class="btn-primary" id="confirmCountryChangeBtn" disabled>Guardar</button>' +
        '<button class="btn-primary" id="cancelCountryChangeBtn" ' +
          'style="background:var(--bg-tertiary,#242b33); color:var(--text-primary,#e7e9ea);">' +
          'Cancelar</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  // Fetch countries
  authFetch('/phone/countries')
    .then(function(res) { return res.json(); })
    .then(function(countries) {
      var select = document.getElementById('countryChangeDropdown');
      if (!select) return;

      var currentCountry = (window.userProfile && window.userProfile.country) || 'PY';

      Object.keys(countries).forEach(function(code) {
        var c = countries[code];
        var flag = COUNTRY_FLAGS[code] || '';
        var option = document.createElement('option');
        option.value = code;
        option.textContent = flag + ' ' + c.name + ' (+' + c.code + ')';
        if (code === currentCountry) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      select.addEventListener('change', function() {
        var btn = document.getElementById('confirmCountryChangeBtn');
        if (btn) btn.disabled = !select.value || select.value === currentCountry;
      });
    })
    .catch(function() {
      var errEl = document.getElementById('countryChangeError');
      if (errEl) errEl.textContent = 'Error al cargar paises.';
    });

  // Save
  document.getElementById('confirmCountryChangeBtn').addEventListener('click', function() {
    var select = document.getElementById('countryChangeDropdown');
    var selectedCode = select ? select.value : '';
    if (!selectedCode) return;

    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    authFetch('/user/country', {
      method: 'PUT',
      body: JSON.stringify({ country: selectedCode })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        localStorage.setItem('countryConfirmed', selectedCode);
        if (window.userProfile) {
          window.userProfile.country = selectedCode;
          userProfile = window.userProfile;
        }
        updateCountryIndicator();
        updateCountryInfoBadges();
        // Refresh country configs cache and update placeholders
        _countryConfigsCache = null;
        getCountryConfigs().then(function() { updatePhonePlaceholders(); }).catch(function() {});
        var m = document.getElementById('country-change-modal');
        if (m) m.remove();
        showAlert('Pais actualizado a ' + (COUNTRY_FLAGS[selectedCode] || '') + ' ' + selectedCode, 'success');
      } else {
        throw new Error(data.error || 'Error al guardar');
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Guardar';
      var errEl = document.getElementById('countryChangeError');
      if (errEl) errEl.textContent = err.message || 'Error al guardar pais';
    });
  });

  // Cancel
  document.getElementById('cancelCountryChangeBtn').addEventListener('click', function() {
    var m = document.getElementById('country-change-modal');
    if (m) m.remove();
  });
}

/**
 * Update the country indicator in the navbar.
 */
function updateCountryIndicator() {
  var country = (window.userProfile && window.userProfile.country) || 'PY';
  var flag = COUNTRY_FLAGS[country] || '';

  var flagEl = document.getElementById('country-flag');
  var codeEl = document.getElementById('country-code-label');
  var indicator = document.getElementById('country-indicator');

  if (flagEl) flagEl.textContent = flag;
  if (codeEl) codeEl.textContent = country;
  if (indicator) {
    indicator.title = 'Pais: ' + country + ' — Click para cambiar';
    indicator.classList.remove('d-none');
  }

  // Also update profile dropdown country display
  var profileFlag = document.getElementById('profile-country-flag');
  var profileName = document.getElementById('profile-country-name');
  if (profileFlag) profileFlag.textContent = flag;
  if (profileName) profileName.textContent = country;

  updateCountryInfoBadges();
}

/**
 * Update country info badges in contacts and send tabs.
 */
function updateCountryInfoBadges() {
  var country = (window.userProfile && window.userProfile.country) || 'PY';
  var flag = COUNTRY_FLAGS[country] || '';

  // Fetch country details for prefix
  authFetch('/phone/countries')
    .then(function(res) { return res.json(); })
    .then(function(countries) {
      var config = countries[country];
      if (!config) return;

      // Send tab badge
      var sendBadge = document.getElementById('send-country-info');
      var sendFlag = document.getElementById('send-country-flag');
      var sendPrefix = document.getElementById('send-country-prefix');
      if (sendBadge) {
        sendBadge.classList.remove('d-none');
        if (sendFlag) sendFlag.textContent = flag;
        if (sendPrefix) sendPrefix.textContent = 'Prefijo: +' + config.code;
      }

      // Contacts tab badge
      var contactsBadge = document.getElementById('contacts-country-info');
      var contactsFlag = document.getElementById('contacts-country-flag');
      var contactsText = document.getElementById('contacts-country-text');
      if (contactsBadge) {
        contactsBadge.classList.remove('d-none');
        if (contactsFlag) contactsFlag.textContent = flag;
        if (contactsText) contactsText.textContent = 'Validacion: ' + config.name + ' (+' + config.code + ')';
      }
    })
    .catch(function() {
      // Silently fail — non-critical UI update
    });
}

// ========== Profile Menu ==========

/**
 * Setup profile dropdown menu — toggle on click, close on outside click.
 */
function setupProfileMenu() {
  var wrapper = document.querySelector('.profile-menu-wrapper');
  var trigger = document.getElementById('profile-menu-trigger');
  var dropdown = document.getElementById('profile-dropdown');
  if (!wrapper || !trigger || !dropdown) return;

  // Toggle dropdown
  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    wrapper.classList.toggle('open');
    if (wrapper.classList.contains('open')) {
      updateProfileDropdown();
    }
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove('open');
    }
  });

  // Country change button
  var countryBtn = document.getElementById('profile-change-country');
  if (countryBtn) {
    countryBtn.addEventListener('click', function() {
      wrapper.classList.remove('open');
      showCountryChangeModal();
    });
  }

  // Logout button
  var logoutBtn = document.getElementById('profile-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      wrapper.classList.remove('open');
      logout();
    });
  }
}

/**
 * Update profile dropdown content with current user data.
 */
function updateProfileDropdown() {
  var profile = window.userProfile;
  var user = currentUser;

  // Name and email
  var nameEl = document.getElementById('profile-display-name');
  var emailEl = document.getElementById('profile-display-email');
  if (nameEl) nameEl.textContent = (user && user.displayName) || (profile && profile.name) || 'Usuario';
  if (emailEl) emailEl.textContent = (user && user.email) || '';

  // Country
  var country = (profile && profile.country) || '';
  var flagEl = document.getElementById('profile-country-flag');
  var nameCountryEl = document.getElementById('profile-country-name');
  if (flagEl) flagEl.textContent = country ? (COUNTRY_FLAGS[country] || '') : '';
  if (nameCountryEl) nameCountryEl.textContent = country || 'No configurado';

  // Plan badge
  var planBadge = document.getElementById('profile-plan-badge');
  if (planBadge && profile) {
    if (profile.role === 'admin') {
      planBadge.textContent = 'Admin';
      planBadge.className = 'profile-plan-badge plan-admin';
    } else if (['active', 'basico', 'profesional', 'premium', 'enterprise'].indexOf(profile.plan) !== -1) {
      var dropdownPlanNames = { active: 'Plan Activo', basico: 'Basico', profesional: 'Profesional', premium: 'Premium', enterprise: 'Enterprise' };
      planBadge.textContent = dropdownPlanNames[profile.plan] || 'Plan Activo';
      planBadge.className = 'profile-plan-badge plan-active';
    } else if (profile.plan === 'trial') {
      var days = profile.trialDaysLeft || 0;
      planBadge.textContent = 'Prueba: ' + days + ' dias';
      planBadge.className = 'profile-plan-badge plan-trial';
    } else {
      planBadge.textContent = 'Expirado';
      planBadge.className = 'profile-plan-badge plan-expired';
    }
  }
}

// ========== Country Helpers ==========

/**
 * Country dial code cache (populated from /phone/countries).
 */
var _countryConfigsCache = null;

/**
 * Get country configs from the server (cached).
 * @returns {Promise<Object>} Map of country code to config
 */
function getCountryConfigs() {
  if (_countryConfigsCache) {
    return Promise.resolve(_countryConfigsCache);
  }
  return authFetch('/phone/countries')
    .then(function(res) { return res.json(); })
    .then(function(countries) {
      _countryConfigsCache = countries;
      return countries;
    });
}

/**
 * Get the current user's country ISO code (e.g. 'AR', 'PY').
 * @returns {string}
 */
function getUserCountry() {
  return (window.userProfile && window.userProfile.country) || 'PY';
}

/**
 * Get the current user's country dial code (e.g. '54' for Argentina, '595' for Paraguay).
 * Returns from cache if available, otherwise returns a default.
 * @returns {string}
 */
function getCountryDialCode() {
  var country = getUserCountry();
  if (_countryConfigsCache && _countryConfigsCache[country]) {
    return _countryConfigsCache[country].code;
  }
  // Fallback map for common codes
  var fallback = {
    PY: '595', AR: '54', BR: '55', CL: '56', UY: '598',
    CO: '57', PE: '51', EC: '593', BO: '591', VE: '58',
    MX: '52', US: '1', ES: '34'
  };
  return fallback[country] || '595';
}

/**
 * Format a phone number for display based on detected or user country.
 * Handles any country code, not just 595.
 * E.g. "5491112345678" → "+54 911 123 456 78"
 * @param {string} phone - Raw or normalized phone number
 * @returns {string} Formatted display string
 */
function formatPhoneForDisplay(phone) {
  if (!phone) return '';
  var digits = String(phone).replace(/\D/g, '');
  if (!digits) return phone;

  // Try to match against known country configs
  var configs = _countryConfigsCache;
  if (configs) {
    // Sort by code length descending so longer codes match first
    var entries = Object.keys(configs).map(function(k) { return { key: k, config: configs[k] }; });
    entries.sort(function(a, b) { return (b.config.code || '').length - (a.config.code || '').length; });

    for (var i = 0; i < entries.length; i++) {
      var cfg = entries[i].config;
      if (digits.indexOf(cfg.code) === 0 && digits.length === cfg.totalLength) {
        var local = digits.substring(cfg.code.length);
        // Split local into groups of 3 from right
        var groups = [];
        var remaining = local;
        while (remaining.length > 3) {
          groups.unshift(remaining.slice(-3));
          remaining = remaining.slice(0, -3);
        }
        if (remaining.length > 0) groups.unshift(remaining);
        return '+' + cfg.code + ' ' + groups.join(' ');
      }
    }
  }

  // Fallback: just prefix with +
  return '+' + digits;
}

/**
 * Update phone input placeholders to use the user's country code.
 * Call this after country configs are loaded.
 */
function updatePhonePlaceholders() {
  var dialCode = getCountryDialCode();
  var placeholder = '+' + dialCode + '...';

  var ids = ['contactPhone', 'editContactPhone'];
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.placeholder = placeholder;
  });
}

// ========== Plan Feature Gating ==========

var planFeatures = null;

/**
 * Load the user's plan features from the backend.
 * Call after loadUserProfile().
 */
function loadPlanFeatures() {
  return authFetch('/user/plan-features')
    .then(function(res) {
      if (!res || !res.ok) return null;
      return res.json();
    })
    .then(function(data) {
      if (!data) return;
      planFeatures = data;
      window.planFeatures = data;
      applyPlanRestrictions(data);
      return data;
    })
    .catch(function(err) {
      console.error('Failed to load plan features:', err);
    });
}

/**
 * Check if a boolean feature is available in the current plan.
 * Frontend restriction removed: always allow.
 * @param {string} featureName - e.g. 'chatbot', 'inbox', 'api', 'campaigns'
 * @returns {boolean}
 */
function checkFeature(featureName) {
  return true;
}

/**
 * Check a numeric limit feature.
 * Frontend restriction removed: always unlimited.
 * @param {string} limitName - e.g. 'send', 'contacts', 'templates'
 * @returns {{ limit: number, used: number, remaining: number, unlimited: boolean }}
 */
function checkLimit(limitName) {
  return { limit: -1, used: 0, remaining: -1, unlimited: true };
}

/**
 * Apply plan restrictions to the UI.
 * Restrictions removed: no tabs are locked and no lock icons are added.
 */
function applyPlanRestrictions(data) {
  if (!data) return;

  // Keep the plan data available globally, but do not block the interface.
  planFeatures = data;
  window.planFeatures = data;

  // Remove any lock icons/classes that may have been rendered before.
  document.querySelectorAll(".tab-locked").forEach(function (el) {
    el.classList.remove("tab-locked");
  });
  document.querySelectorAll(".lock-icon").forEach(function (el) {
    el.remove();
  });

  // Keep badge update only for display.
  updatePlanBadge(data.plan, data.role);
}

/**
 * Update the trial badge to show the actual plan name.
 */
function updatePlanBadge(plan, role) {
  var badge = document.getElementById('trial-badge');
  if (!badge) return;

  if (role === 'admin') return; // admin badge already handled

  var planNames = {
    'basico': 'Basico',
    'profesional': 'Profesional',
    'premium': 'Premium',
    'enterprise': 'Enterprise',
    'active': 'Plan Activo'
  };

  if (planNames[plan]) {
    badge.innerHTML = '<i class="bi bi-check-circle"></i> ' + planNames[plan];
    badge.className = 'trial-badge badge-active';
    badge.classList.remove('d-none');
  }
}

/**
 * Show upgrade modal when a restricted feature is accessed.
 * Popup removed: no modal is shown.
 */
function showPlanUpgradeModal(feature, message, currentPlan) {
  console.warn("Funcion restringida ignorada:", {
    feature: feature,
    message: message,
    currentPlan: currentPlan,
  });
}

// Global exports
window.authFetch = authFetch;
window.showAlert = showAlert;
window.showTab = showTab;
window.setupMoreMenu = setupMoreMenu;
window.buildQuery = buildQuery;
window.getChartTextColor = getChartTextColor;
window.logout = logout;
window.initFirebaseAuth = initFirebaseAuth;
window.loadUserProfile = loadUserProfile;
window.showTrialExpiredModal = showTrialExpiredModal;
window.createAppSession = createAppSession;
window.showSessionConflictModal = showSessionConflictModal;
window.showAccountBlockedModal = showAccountBlockedModal;
window.checkCountrySelection = checkCountrySelection;
window.showCountryChangeModal = showCountryChangeModal;
window.updateCountryIndicator = updateCountryIndicator;
window.updateCountryInfoBadges = updateCountryInfoBadges;
window.COUNTRY_FLAGS = COUNTRY_FLAGS;
window.userProfile = userProfile;
window.setupProfileMenu = setupProfileMenu;
window.updateProfileDropdown = updateProfileDropdown;
window.getCountryConfigs = getCountryConfigs;
window.getUserCountry = getUserCountry;
window.getCountryDialCode = getCountryDialCode;
window.formatPhoneForDisplay = formatPhoneForDisplay;
window.updatePhonePlaceholders = updatePhonePlaceholders;
window.loadPlanFeatures = loadPlanFeatures;
window.checkFeature = checkFeature;
window.checkLimit = checkLimit;
window.planFeatures = planFeatures;
window.showPlanUpgradeModal = showPlanUpgradeModal;
window.applyPlanRestrictions = applyPlanRestrictions;
