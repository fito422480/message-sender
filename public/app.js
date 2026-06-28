/** ======== Configuration ======== */
const CONFIG = {
  checkInterval: 15000, // Cambio de 3s a 15s para reducir carga del servidor
  statusEndpoint: '/connection-status',
  keycloakConfig: {
    url: 'https://auth.mindtechpy.net',
    realm: 'message-sender',
    clientId: 'message-sender-web'  // Usar el cliente web correcto
  },
  // Development mode fallback
  isDevelopment: false, // Siempre usar Keycloak
  // Prevent auth loops
  maxAuthAttempts: 3,
  authAttemptKey: 'keycloak_auth_attempts'
};

/** ======== Debug Helper ======== */
function logDebug(...args) {
  if (CONFIG.isDevelopment) {
    console.log('[DEBUG]', ...args);
  }
}

/** ======== Multi-Session State ======== */
let currentUser = {
  id: null,
  name: null,
  email: null
};

/** ======== User Interface Functions ======== */

// Función de diagnóstico para debug
function diagnoseKeycloak() {
  console.log('🔍 Diagnóstico de Keycloak:', {
    keycloakInitialized: !!keycloak,
    authenticated: keycloak?.authenticated,
    token: keycloak?.token ? 'Presente (longitud: ' + keycloak.token.length + ')' : 'Ausente',
    tokenParsed: keycloak?.tokenParsed,
    currentUser,
    config: CONFIG.keycloakConfig,
    url: window.location.href
  });

  if (keycloak?.token) {
    try {
      const payload = JSON.parse(atob(keycloak.token.split('.')[1]));
      console.log('📋 Payload del token:', payload);
    } catch (e) {
      console.error('❌ Error decodificando token:', e);
    }
  }
}

// Función de diagnóstico específica para el botón de logout
function diagnoseLogoutButton() {
  const logoutBtn = document.getElementById('logout-btn');
  console.log('🔍 Diagnóstico del botón de logout:', {
    buttonExists: !!logoutBtn,
    buttonVisible: logoutBtn?.offsetParent !== null,
    buttonDisabled: logoutBtn?.disabled,
    eventListeners:
      (logoutBtn && typeof getEventListeners !== 'undefined')
        ? getEventListeners(logoutBtn)
        : 'N/A (solo disponible en DevTools)',
    buttonHTML: logoutBtn?.outerHTML
  });

  if (logoutBtn) {
    console.log('🖱️ Intentando hacer click programático...');
    logoutBtn.click();
  }
}// Hacer disponible globalmente para debug
window.diagnoseKeycloak = diagnoseKeycloak;
window.diagnoseLogoutButton = diagnoseLogoutButton;
window.logoutKeycloak = logoutKeycloak;

function updateUserInfoNavbar(user) {
  const userInfoElement = document.getElementById('user-info');
  const userNameElement = document.getElementById('user-name');
  const userEmailElement = document.getElementById('user-email');

  if (userInfoElement && userNameElement && userEmailElement) {
    userNameElement.textContent = user.name || 'Usuario';
    userEmailElement.textContent = user.email || 'Sin email';
    userInfoElement.classList.remove('d-none');

    logDebug('Navbar actualizado con usuario:', user);
  }
}

/** ======== Keycloak Authentication ======== */
let keycloak = null;
let isAuthenticated = false;
let refreshing = false;
let refreshTimer = null;

// Inicializa Keycloak OBLIGATORIAMENTE (como en app-old.js)
async function initKeycloak() {
  try {
    // Verificar si ya estamos en un loop de autenticación
    const authAttempts = parseInt(sessionStorage.getItem(CONFIG.authAttemptKey) || '0');
    if (authAttempts >= CONFIG.maxAuthAttempts) {
      console.error('❌ Demasiados intentos de autenticación. Parando para evitar bucle.');
      hideLoadingScreen();
      showAlert('Error de autenticación persistente. Verifica la configuración de Keycloak.', 'error', 'Error crítico');
      return false;
    }

    showLoadingScreen('Inicializando autenticación...');

    console.log('🔧 Configuración Keycloak:', CONFIG.keycloakConfig);
    console.log('🌍 URL actual:', window.location.href);
    console.log('🔄 Intento de autenticación:', authAttempts + 1);
    console.log('🌐 Entorno detectado:', {
      hostname: window.location.hostname,
      origin: window.location.origin,
      nodeEnv: 'production (configurado en .env)'
    });

    // Incrementar contador de intentos
    sessionStorage.setItem(CONFIG.authAttemptKey, (authAttempts + 1).toString());

    keycloak = new Keycloak(CONFIG.keycloakConfig);

    console.log('🔄 Iniciando Keycloak...');

    // Configuración dinámica basada en el entorno
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = window.location.origin;

    console.log('🌍 Entorno detectado:', {
      hostname: window.location.hostname,
      isLocalhost,
      baseUrl,
      keycloakUrl: CONFIG.keycloakConfig.url
    });

    const authenticated = await keycloak.init({
      onLoad: 'login-required', // Forzar login para asegurar autenticación
      checkLoginIframe: false,
      pkceMethod: 'S256',
      enableLogging: true,
      redirectUri: baseUrl + '/',
      silentCheckSsoRedirectUri: baseUrl + '/silent-check-sso.html',
      // Configuraciones específicas para producción
      flow: 'standard',
      responseMode: 'fragment'
    });

    console.log('✅ Keycloak inicializado. Autenticado:', authenticated);
    console.log('🔐 Token disponible:', !!keycloak.token);
    console.log('🎯 Token length:', keycloak.token ? keycloak.token.length : 0);

    if (keycloak.token) {
      console.log('📋 Info del token:', {
        sub: keycloak.tokenParsed?.sub,
        name: keycloak.tokenParsed?.name,
        email: keycloak.tokenParsed?.email,
        exp: new Date(keycloak.tokenParsed?.exp * 1000),
        aud: keycloak.tokenParsed?.aud,
        iss: keycloak.tokenParsed?.iss
      });
    }

    if (!authenticated) {
      console.log('🔐 Usuario no autenticado, redirigiendo al login...');
      hideLoadingScreen();

      // Verificar si venimos de una redirección de login fallida
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('error')) {
        console.error('❌ Error en la redirección de Keycloak:', urlParams.get('error'));
        showAlert('Error de autenticación. Verifica tus credenciales.', 'error', 'Error de login');
        sessionStorage.removeItem(CONFIG.authAttemptKey);
        return false;
      }

      // Usar setTimeout para evitar loops inmediatos
      setTimeout(() => {
        keycloak.login({
          redirectUri: window.location.origin + window.location.pathname
        });
      }, 1000);
      return false;
    }

    // Si llegamos aquí, la autenticación fue exitosa - resetear contador
    sessionStorage.removeItem(CONFIG.authAttemptKey);

    isAuthenticated = true;
    console.log('✅ Autenticación exitosa');
    console.log('🔍 Token info:', keycloak.tokenParsed);

    // Extraer información del usuario
    if (keycloak.tokenParsed) {
      currentUser.id = keycloak.tokenParsed.sub;
      currentUser.name = keycloak.tokenParsed.name || keycloak.tokenParsed.preferred_username || keycloak.tokenParsed.email;
      currentUser.email = keycloak.tokenParsed.email;

      console.log('👤 Usuario autenticado exitosamente:', {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        roles: keycloak.tokenParsed.resource_access,
        tokenExpires: new Date(keycloak.tokenParsed.exp * 1000).toLocaleString()
      });

      // Actualizar navbar con información del usuario de Keycloak
      updateUserInfoNavbar(currentUser);

      // Verificar que el usuario tiene los roles necesarios
      const hasApiRole = keycloak.tokenParsed.resource_access?.['message-sender-api']?.roles?.includes('sender_api');
      if (!hasApiRole) {
        console.warn('⚠️ Usuario no tiene el rol sender_api en message-sender-api');
        showAlert('Tu usuario no tiene permisos para usar esta aplicación. Contacta al administrador.', 'warning', 'Permisos insuficientes');
      } else {
        console.log('✅ Usuario tiene los permisos necesarios');
      }
    } else {
      console.error('❌ No se pudo obtener información del token');
    }

    // Renueva justo antes de expirar (sin loops)
    keycloak.onTokenExpired = async () => {
      if (refreshing) return;
      refreshing = true;
      console.log('🔄 Token expirado, renovando...');
      try {
        await keycloak.updateToken(30); // renueva si quedan <30s
        console.log('✅ Token renovado exitosamente');
      } catch (e) {
        console.error('❌ Fallo refrescando token', e);
        showAlert('Sesión expirada. Inicia sesión nuevamente.', 'warning');
        sessionStorage.removeItem(CONFIG.authAttemptKey); // Reset counter
        setTimeout(() => {
          keycloak.login();
        }, 2000);
      } finally {
        refreshing = false;
      }
    };

    // "Pulso" suave: cada 30s, si faltan <60s de token, intenta renovar
    const tick = async () => {
      clearTimeout(refreshTimer);
      try {
        if (!keycloak.authenticated) return;

        const expMs = keycloak.tokenParsed?.exp ? keycloak.tokenParsed.exp * 1000 : 0;
        if (expMs) {
          const delta = expMs - Date.now();
          if (delta < 60_000 && !refreshing) {
            console.log('🔄 Token próximo a expirar, renovando preventivamente...');
            await keycloak.updateToken(30);
          }
        }
      } catch (e) {
        console.warn('⚠️ Error en renovación preventiva:', e.message);
      }
      refreshTimer = setTimeout(tick, 30_000); // Aumentado a 30 segundos
    };
    tick();

    hideLoadingScreen();
    showAlert('Bienvenido al sistema', 'success', 'Autenticación exitosa');

    console.log('✅ Inicialización de Keycloak completada exitosamente');
    return true; // Retornar true en caso de éxito

  } catch (error) {
    console.error('❌ Error de autenticación:', error);
    hideLoadingScreen();

    // Reset contador en caso de error crítico
    sessionStorage.removeItem(CONFIG.authAttemptKey);

    // Verificar tipo de error
    if (error.message?.includes('CORS') || error.message?.includes('network')) {
      showAlert('Error de conectividad con Keycloak. Verifica tu conexión.', 'error', 'Error de red');
    } else if (error.message?.includes('client')) {
      showAlert('Error de configuración del cliente Keycloak.', 'error', 'Error de configuración');
    } else {
      showAlert('Error inesperado en la autenticación.', 'error', 'Error de autenticación');
    }

    // No recargar automáticamente para evitar loops
    console.log('🛑 Deteniendo para evitar bucle infinito. Revisa la configuración de Keycloak.');
    return false;
  }
}

// Helper: fetch con Authorization OBLIGATORIO (como en app-old.js)
async function authFetch(url, options = {}) {
  try {
    // Verificar que Keycloak esté inicializado
    if (!keycloak) {
      console.error('❌ Keycloak no está inicializado');
      throw new Error('Keycloak no está inicializado');
    }

    // Verificar autenticación
    if (!keycloak.authenticated) {
      console.error('❌ Usuario no autenticado');
      throw new Error('Usuario no autenticado');
    }

    // Intentar actualizar token si es necesario (30 segundos antes de expirar)
    try {
      const tokenRefreshed = await keycloak.updateToken(30);
      if (tokenRefreshed) {
        console.log('🔄 Token renovado automáticamente');
      }
    } catch (refreshError) {
      console.error('❌ Error renovando token:', refreshError);
      // Si falla la renovación, redirigir al login
      keycloak.login();
      throw new Error('Token expirado, redirigiendo al login');
    }

    // Verificar que tenemos un token válido
    if (!keycloak.token) {
      console.error('❌ No hay token disponible después de la renovación');
      keycloak.login();
      throw new Error('No hay token de autenticación disponible');
    }

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${keycloak.token}`);

    console.log('🔐 Enviando petición autenticada:', {
      url,
      userId: keycloak.tokenParsed?.sub,
      userName: keycloak.tokenParsed?.name || keycloak.tokenParsed?.preferred_username,
      tokenExpires: new Date(keycloak.tokenParsed?.exp * 1000).toLocaleString()
    });

    const response = await fetch(url, { ...options, headers });

    // Si recibimos 401, el token puede estar inválido
    if (response.status === 401) {
      console.error('❌ Respuesta 401 - Token inválido o expirado');
      keycloak.login();
      throw new Error('Token inválido, redirigiendo al login');
    }

    return response;

  } catch (error) {
    console.error('❌ Error en authFetch:', error);
    throw error;
  }
}

// Función para cerrar sesión de Keycloak con logout robusto de WhatsApp
async function logoutKeycloak() {
  try {
    console.log('🚪 Iniciando proceso de logout robusto...');

    // Verificar que Keycloak esté disponible
    if (!keycloak) {
      console.error('❌ Keycloak no está disponible para logout');
      showAlert('Error: Sistema de autenticación no disponible', 'error');
      return;
    }

    // Mostrar confirmación mejorada
    const confirmLogout = confirm('¿Estás seguro de que deseas cerrar sesión?\n\n✅ Se cerrará tu sesión de Keycloak\n✅ Se desvinculará WhatsApp de este dispositivo (proceso robusto)\n✅ Tendrás que volver a escanear el código QR\n\n⏱️ Este proceso puede tomar unos segundos...');
    if (!confirmLogout) {
      console.log('🚫 Logout cancelado por el usuario');
      return;
    }

    console.log('✅ Confirmación de logout recibida, procediendo con proceso robusto...');

    // Crear indicador de progreso mejorado
    showLoadingScreen('Iniciando logout robusto...');

    // Crear div de progreso detallado
    const progressDiv = document.createElement('div');
    progressDiv.id = 'logout-progress-detail';
    progressDiv.innerHTML = `
      <div style="position: fixed; top: 20px; right: 20px; 
                  background: white; padding: 15px; border-radius: 8px; 
                  box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10001; 
                  min-width: 300px; border-left: 4px solid #007bff;">
        <h6 style="margin: 0 0 10px 0; color: #333;">🔄 Progreso del Logout</h6>
        <div id="logout-step" style="font-size: 14px; margin-bottom: 8px;">Iniciando...</div>
        <div style="height: 4px; background: #f0f0f0; border-radius: 2px; margin-bottom: 8px;">
          <div id="logout-progress-bar" style="height: 100%; background: #007bff; border-radius: 2px; width: 0%; transition: width 0.3s;"></div>
        </div>
        <div id="logout-details" style="font-size: 12px; color: #666;"></div>
      </div>
    `;
    document.body.appendChild(progressDiv);

    const updateProgress = (percent, step, details = '') => {
      const stepEl = document.getElementById('logout-step');
      const barEl = document.getElementById('logout-progress-bar');
      const detailsEl = document.getElementById('logout-details');

      if (stepEl) stepEl.textContent = step;
      if (barEl) barEl.style.width = percent + '%';
      if (detailsEl) detailsEl.textContent = details;
    };

    // PASO 1: Cerrar sesión de WhatsApp con proceso robusto
    try {
      updateProgress(20, '📱 Cerrando sesión de WhatsApp...', 'Iniciando logout robusto...');
      console.log('📱 Cerrando sesión de WhatsApp con proceso robusto...');

      const whatsappLogout = await authFetch('/logout-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (whatsappLogout.ok) {
        const result = await whatsappLogout.json();
        console.log('✅ WhatsApp logout resultado:', result);

        updateProgress(60, '✅ WhatsApp: ' + result.message,
          `${result.attempts} intentos, ${result.finalState?.fullyDisconnected ? 'completamente desvinculado' : 'parcialmente desvinculado'}`);

        // Mostrar recomendación si está disponible
        if (result.recommendation) {
          console.log('💡 Recomendación:', result.recommendation);
          setTimeout(() => {
            updateProgress(65, result.recommendation, '');
          }, 1000);
        }

        // Verificación adicional del estado
        if (result.finalState && !result.finalState.fullyDisconnected) {
          updateProgress(70, '🔍 Verificando desvinculación...', 'Comprobando estado final...');

          try {
            // Esperar un momento antes de verificar
            await new Promise(resolve => setTimeout(resolve, 2000));

            const statusResponse = await authFetch('/logout-status');
            if (statusResponse.ok) {
              const status = await statusResponse.json();
              console.log('📊 Estado de verificación:', status);

              if (status.state === 'disconnected') {
                updateProgress(75, '✅ Verificación: dispositivo desvinculado', '');
              } else {
                updateProgress(75, '⚠️ Verificación: desvinculación parcial',
                  'El dispositivo puede tardar unos minutos en desaparecer de WhatsApp');
              }
            }
          } catch (statusError) {
            console.log('⚠️ Error en verificación:', statusError.message);
            updateProgress(75, '⚠️ No se pudo verificar estado', 'Continuando con Keycloak...');
          }
        } else {
          updateProgress(75, '✅ WhatsApp completamente desvinculado', 'Verificación exitosa');
        }

      } else {
        updateProgress(40, '⚠️ Problema con logout de WhatsApp', 'Continuando con Keycloak...');
        console.warn('⚠️ Error al cerrar WhatsApp, continuando con logout de Keycloak');
      }
    } catch (whatsappError) {
      updateProgress(35, '❌ Error en WhatsApp logout', whatsappError.message);
      console.warn('⚠️ Error al cerrar WhatsApp:', whatsappError.message);
      console.log('Continuando con logout de Keycloak...');
    }

    // PASO 2: Limpiar datos locales
    updateProgress(80, '🧹 Limpiando datos locales...', 'Eliminando información de sesión');
    console.log('🧹 Limpiando datos locales...');
    sessionStorage.removeItem(CONFIG.authAttemptKey);
    sessionStorage.clear();
    localStorage.clear();

    // PASO 3: Reiniciar estado de la aplicación
    updateProgress(85, '🔄 Reiniciando estado de aplicación...', '');
    isAuthenticated = false;
    currentUser = { id: null, name: null, email: null };

    updateProgress(90, '🔐 Cerrando sesión en Keycloak...', 'Preparando redirección');
    console.log('🔄 Iniciando logout en Keycloak...');

    // Cerrar sesión en Keycloak con URL de redirección
    const logoutUrl = keycloak.createLogoutUrl({
      redirectUri: window.location.origin + window.location.pathname
    });

    updateProgress(100, '✅ Logout completado', 'Redirigiendo...');
    console.log('🌐 Redirigiendo a:', logoutUrl);

    // Dar tiempo para mostrar el progreso completo
    setTimeout(() => {
      // Limpiar progreso antes de redireccionar
      if (document.getElementById('logout-progress-detail')) {
        document.body.removeChild(progressDiv);
      }

      // Redireccionar manualmente para mayor control
      window.location.href = logoutUrl;
    }, 1500);

  } catch (error) {
    console.error('❌ Error durante el logout robusto:', error);
    hideLoadingScreen();

    // Limpiar progreso en caso de error
    const progressEl = document.getElementById('logout-progress-detail');
    if (progressEl) {
      document.body.removeChild(progressEl);
    }

    showAlert(
      'Error al cerrar sesión.\n\n' +
      'Por favor verifica manualmente:\n' +
      '• Tu sesión en WhatsApp (Dispositivos vinculados)\n' +
      '• Tu sesión en Keycloak\n\n' +
      'Si el problema persiste, contacta al administrador.',
      'error',
      'Error de logout robusto'
    );

    // Como fallback, recargar la página después de un momento
    setTimeout(() => {
      if (confirm('¿Deseas recargar la página para intentar nuevamente?')) {
        window.location.reload();
      }
    }, 3000);
  }
}

/** ======== Loading Screen Management ======== */
function showLoadingScreen(message = 'Cargando...') {
  const loadingScreen = document.getElementById('loading-screen');
  const loadingMessage = document.getElementById('loadingMessage');

  if (loadingMessage) loadingMessage.textContent = message;
  if (loadingScreen) loadingScreen.classList.remove('d-none');
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    setTimeout(() => {
      loadingScreen.classList.add('d-none');
    }, 500);
  }
}

/** ======== Enhanced Alert System ======== */
let alertContainer = null;

function createAlertContainer() {
  if (alertContainer) return;

  alertContainer = document.createElement('div');
  alertContainer.className = 'alert-container';
  alertContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    max-width: 400px;
  `;
  document.body.appendChild(alertContainer);
}

function showAlert(message, type = 'info', title = '') {
  createAlertContainer();

  const alertId = 'alert-' + Date.now();
  const typeClass = `alert-${type}`;
  const iconMap = {
    success: 'bi-check-circle-fill',
    error: 'bi-exclamation-triangle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info: 'bi-info-circle-fill'
  };

  const alertElement = document.createElement('div');
  alertElement.id = alertId;
  alertElement.className = `alert ${typeClass} alert-dismissible fade show modern-alert`;
  alertElement.style.cssText = `
    margin-bottom: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    border: none;
    border-left: 4px solid var(--primary-500);
  `;

  alertElement.innerHTML = `
    <div class="d-flex align-items-start">
      <i class="bi ${iconMap[type] || iconMap.info} me-2 mt-1"></i>
      <div class="flex-grow-1">
        ${title ? `<strong class="alert-title">${title}</strong><br>` : ''}
        <span class="alert-message">${message}</span>
      </div>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="alert"></button>
    </div>
  `;

  alertContainer.appendChild(alertElement);

  // Auto-dismiss after 5 seconds for non-error alerts
  if (type !== 'error') {
    setTimeout(() => {
      const alert = document.getElementById(alertId);
      if (alert) {
        const bsAlert = new bootstrap.Alert(alert);
        bsAlert.close();
      }
    }, 5000);
  }
}

/** ======== Tab Navigation ======== */
async function showTab(tabName) {
  // Check if tab is disabled
  const targetBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (targetBtn && targetBtn.classList.contains('disabled')) {
    showAlert('Esta sección está deshabilitada. Conecte WhatsApp primero.', 'warning', 'Acceso restringido');
    return;
  }

  // Validation for send tab - allow access when authenticated, but show warning if not ready
  if (tabName === 'send') {
    try {
      const res = await authFetch(CONFIG.statusEndpoint);
      const status = await res.json();
      const isConnected = status && (status.isReady === true || status.status === 'authenticated' || status.connectionState === 'authenticated');

      if (!isConnected) {
        showAlert('Debe conectar WhatsApp primero', 'warning', 'Conexión requerida');
        return;
      }

      // If authenticated but not ready, show info message
      if (!status.isReady && (status.status === 'authenticated' || status.connectionState === 'authenticated')) {
        showAlert('WhatsApp está autenticado y sincronizando. El botón de envío se habilitará automáticamente cuando esté listo.', 'info', 'Sincronización en proceso');
      }
    } catch (e) {
      showAlert('Error al verificar estado de conexión', 'error');
      return;
    }
  }

  // Initialize QR only when showing link tab and not connected
  if (tabName === 'link') {
    try {
      const res = await authFetch(CONFIG.statusEndpoint);
      const status = await res.json();
      if (!status.isReady) {
        initializeQR(); // Solo cargar QR si no está conectado
      }
    } catch (e) {
      initializeQR(); // En caso de error, asumir que no está conectado
    }
  }

  // Update tab buttons
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    }
  });

  // Update tab content
  document.querySelectorAll('.tab-pane').forEach(content => {
    content.classList.remove('active');
    if (content.id === tabName) {
      content.classList.add('active');
    }
  });

  // Reinitialize interactive components when showing send tab
  if (tabName === 'send') {
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      setupVariablesSystem();
      setupEmojiPicker();
    }, 100);
  }

  if (tabName === 'analytics') {
    loadAnalyticsDashboard();
    loadContacts();
  }

  // Update URL hash
  window.location.hash = tabName;
}

/** ======== QR Code Management ======== */
let qrInitialized = false;
let currentQrObjectUrl = null;

function revokeQrObjectUrl() {
  if (currentQrObjectUrl) {
    URL.revokeObjectURL(currentQrObjectUrl);
    currentQrObjectUrl = null;
  }
}

async function loadAuthenticatedQrImage() {
  const qrImage = document.getElementById('qrImage');
  if (!qrImage) return false;

  try {
    const response = await authFetch('/qr', {
      headers: { Accept: 'image/png', 'Cache-Control': 'no-cache' },
      cache: 'no-store'
    });

    if (!response.ok) {
      if (response.status === 404) {
        logDebug('QR aún no disponible para el usuario, solicita refresh.');
        return false;
      }
      throw new Error(`Estado inesperado al obtener QR: ${response.status}`);
    }

    const blob = await response.blob();
    revokeQrObjectUrl();
    currentQrObjectUrl = URL.createObjectURL(blob);
    qrImage.src = currentQrObjectUrl;
    qrInitialized = true;
    logDebug('QR cargado vía petición autenticada.');
    return true;
  } catch (error) {
    console.error('Error obteniendo QR autenticado:', error);
    return false;
  }
}

async function initializeQR(force = false) {
  if (qrInitialized && !force) return;
  await loadAuthenticatedQrImage();
}

// Variable para prevenir llamadas simultáneas
let isRefreshingQR = false;

async function refreshQR() {
  // Prevenir múltiples llamadas simultáneas
  if (isRefreshingQR) {
    console.log('🚫 Ya hay un refresh de QR en progreso, ignorando llamada adicional');
    return;
  }

  isRefreshingQR = true;

  const refreshBtn = document.getElementById('refreshQrBtn');

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Refrescando...';
  }

  try {
    const response = await authFetch('/refresh-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();

    if (result.success) {
      showAlert('Código QR actualizado', 'success', 'QR Refrescado');
      // Wait a bit for the QR to be generated and then refresh the image
      setTimeout(() => {
        initializeQR(true);
        logDebug('QR refrescado manualmente para usuario:', currentUser.id);
      }, 1000);
    } else {
      showAlert(result.message || 'No se pudo refrescar el QR', 'warning', 'Error QR');
    }
  } catch (error) {
    console.error('Error al actualizar QR:', error);
    showAlert('Error al solicitar nuevo código QR', 'error', 'Error QR');
  } finally {
    // Restablecer estado y botón
    isRefreshingQR = false;

    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i><span>Refrescar código</span>';
    }
  }
}

window.addEventListener('beforeunload', () => {
  revokeQrObjectUrl();
});

/** ======== Clear Redis Session (resolver conflictos) ======== */
async function clearRedisSession() {
  const clearBtn = document.getElementById('clearRedisBtn');

  // Confirmación del usuario
  if (!confirm('¿Limpiar el cache de Redis?\n\nEsto eliminará la sesión antigua y puede resolver errores de conflicto.\n\n⚠️ Solo hazlo si tienes problemas de conexión.')) {
    return;
  }

  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Limpiando...';
  }

  try {
    const response = await authFetch('/auth/clear-redis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();

    if (result.success) {
      showAlert(result.message || 'Cache limpiado exitosamente', 'success', '✅ Cache Limpiado');

      // Esperar un momento y luego refrescar el QR
      setTimeout(() => {
        showAlert('Generando nuevo código QR...', 'info', 'QR');
        initializeQR(true);
      }, 1500);
    } else {
      showAlert(result.message || 'No se pudo limpiar el cache', 'warning', '⚠️ Error');
    }
  } catch (error) {
    console.error('Error al limpiar Redis:', error);
    showAlert('Error al limpiar el cache de Redis', 'error', '❌ Error');
  } finally {
    if (clearBtn) {
      clearBtn.disabled = false;
      clearBtn.innerHTML = '<i class="bi bi-trash3"></i><span>Limpiar cache</span>';
    }
  }
}

// Hacer disponible globalmente
window.clearRedisSession = clearRedisSession;

/** ======== Connection Status Management ======== */
let isCurrentlyConnected = false;
let statusCheckTimer = null;

// Fallback function to fetch user info when authenticated but userInfo not provided
async function fetchUserInfoFallback() {
  try {
    // Try to get additional info from backend
    const res = await authFetch(CONFIG.statusEndpoint);
    const status = await res.json();

    if (status.userInfo) {
      const nick = document.getElementById('user-nickname');
      const phone = document.getElementById('user-phone');
      if (nick) nick.textContent = status.userInfo.pushname || 'Usuario de WhatsApp';
      if (phone) phone.textContent = status.userInfo.phoneNumber || '—';
    } else {
      // Show generic authenticated state
      const nick = document.getElementById('user-nickname');
      const phone = document.getElementById('user-phone');
      if (nick) nick.textContent = 'Usuario autenticado';
      if (phone) phone.textContent = 'Sincronizando datos...';
    }
  } catch (e) {
    logDebug('Error fetching user info fallback:', e);
    // Show generic authenticated state as final fallback
    const nick = document.getElementById('user-nickname');
    const phone = document.getElementById('user-phone');
    if (nick) nick.textContent = 'Usuario autenticado';
    if (phone) phone.textContent = 'Conectado';
  }
}

function updateConnectionStatus(status) {
  const statusElement = document.querySelector('#connection-status');
  const statusText = statusElement?.querySelector('.status-text');

  if (!statusElement || !statusText) return;

  const isConnected = status && (status.isReady === true || status.status === 'authenticated' || status.connectionState === 'authenticated');
  const isFullyReady = status && status.isReady === true;

  if (isConnected) {
    statusElement.classList.add('connected');

    if (isFullyReady) {
      const userInfo = status.userInfo || {};
      const phoneNumber = userInfo.phoneNumber || '';

      statusText.innerHTML = `
        <div>WhatsApp Conectado</div>
        ${phoneNumber ? `<small style=\"opacity: 0.8;\">Tel: ${phoneNumber}</small>` : ''}
      `;
      if (status.state) {
        statusText.innerHTML += `<small style=\"opacity: 0.8;\">Estado: ${status.state}</small>`;
      }

      if (!isCurrentlyConnected) {
        showAlert(`¡WhatsApp conectado exitosamente!`, 'success', '✅ Conexión establecida');
        // Auto-switch to send tab after successful connection
        setTimeout(() => showTab('send'), 1500);
      }
      isCurrentlyConnected = true;
    } else {
      statusText.innerHTML = `
        <div>Autenticando WhatsApp...</div>
        <small style=\"opacity: 0.8;\">${status.state || 'Sincronizando'}</small>
      `;
      isCurrentlyConnected = false; // No considerar completamente conectado hasta que isReady sea true
    }
  } else {
    statusElement.classList.remove('connected');
    statusText.innerHTML = `
      <div>WhatsApp Desconectado</div>
      <small style=\"opacity: 0.8;\">${(status && status.state) || 'Escanear QR'}</small>
    `;

    // Alert user if they were previously connected
    if (isCurrentlyConnected) {
      showAlert(
        'Se perdió la conexión con WhatsApp.\n' +
        'Por favor reconecta escaneando el código QR nuevamente.',
        'warning',
        '⚠️ Conexión perdida'
      );
    }

    isCurrentlyConnected = false;
  }
}

function updateSendButtonState(isReady, status) {
  const sendBtn = document.getElementById('sendMessageBtn');
  const btnText = sendBtn?.querySelector('.btn-text');
  const sendTabDescription = document.getElementById('sendTabDescription');
  const connectionDescription = document.getElementById('connectionDescription');

  logDebug('Actualizando estado del botón de envío:', { isReady, status, sendBtn: !!sendBtn, btnText: !!btnText });

  if (!sendBtn || !btnText) {
    logDebug('Botón de envío no encontrado en el DOM');
    return;
  }

  if (isReady) {
    sendBtn.disabled = false;
    sendBtn.classList.remove('disabled');
    btnText.textContent = 'Enviar mensajes';
    if (sendTabDescription) sendTabDescription.textContent = 'Configurar y enviar';
    if (connectionDescription) connectionDescription.textContent = 'Tu WhatsApp está vinculado y listo para enviar mensajes';
    logDebug('Botón habilitado para envío');
  } else if (status && (status.status === 'authenticated' || status.connectionState === 'authenticated')) {
    sendBtn.disabled = true;
    sendBtn.classList.add('disabled');
    btnText.textContent = 'Sincronizando...';
    if (sendTabDescription) sendTabDescription.textContent = 'Sincronizando datos...';
    if (connectionDescription) connectionDescription.textContent = 'WhatsApp autenticado, sincronizando datos para habilitar envío de mensajes';
    logDebug('Botón en estado de sincronización');
  } else {
    sendBtn.disabled = true;
    sendBtn.classList.add('disabled');
    btnText.textContent = 'Conectar WhatsApp primero';
    if (sendTabDescription) sendTabDescription.textContent = 'Conectar primero';
    if (connectionDescription) connectionDescription.textContent = 'Conecta tu WhatsApp para comenzar';
    logDebug('Botón deshabilitado - no conectado');
  }
}

function updateInterface(status) {
  logDebug('Actualizando interfaz con estado:', status);

  updateConnectionStatus(status);

  const qrContainer = document.getElementById('qr-container');
  const authMessage = document.getElementById('authenticated-message');

  if (!qrContainer || !authMessage) {
    logDebug('Elementos críticos de UI no encontrados');
    return;
  }

  // Check if authenticated (either ready or authenticated state)
  const isConnected = status && (status.isReady === true || status.status === 'authenticated' || status.connectionState === 'authenticated');
  const isFullyReady = status && status.isReady === true;

  if (isConnected) {
    // Connected state (authenticated or ready)
    qrContainer.classList.add('d-none');
    authMessage.classList.remove('d-none');

    // Update user info
    if (status.userInfo) {
      const nick = document.getElementById('user-nickname');
      const phone = document.getElementById('user-phone');
      if (nick) nick.textContent = status.userInfo.pushname || 'Usuario de WhatsApp';
      if (phone) phone.textContent = status.userInfo.phoneNumber || '—';
    } else if (status.status === 'authenticated') {
      // Show generic info when authenticated but no user details yet
      const nick = document.getElementById('user-nickname');
      const phone = document.getElementById('user-phone');
      if (nick) nick.textContent = 'Usuario autenticado';
      if (phone) phone.textContent = 'Esperando sincronización...';
    }

    // Update stats
    updateHeroStats(status);

    // Update send button state
    updateSendButtonState(isFullyReady, status);

    // Enable send tab navigation when authenticated (even if not fully ready)
    const sendTabBtn = document.querySelector('[data-tab="send"]');
    if (sendTabBtn) {
      sendTabBtn.classList.remove('disabled');
    }
  } else {
    // Disconnected state
    qrContainer.classList.remove('d-none');
    authMessage.classList.add('d-none');

    // Update send button state for disconnected
    updateSendButtonState(false, status);

    // Disable send tab navigation
    const sendTabBtn = document.querySelector('[data-tab="send"]');
    if (sendTabBtn) {
      sendTabBtn.classList.add('disabled');
    }

    // NO refrescar automáticamente el QR - solo cuando el usuario lo solicite
    // La imagen del QR se carga inicialmente y solo se actualiza manualmente
  }

  // Alert for inactivity (optional)
  if (status?.isReady && status?.lastActivity) {
    const inactivitySecs = Math.round((Date.now() - new Date(status.lastActivity).getTime()) / 1000);
    if (inactivitySecs > 1800) {
      showAlert('La conexión ha estado inactiva por mucho tiempo. Considere reiniciarla.', 'warning');
    }
  }
}

function updateHeroStats(status) {
  // Update hero section stats with real data
  const totalSentToday = document.getElementById('totalSentToday');
  const successRate = document.getElementById('successRate');
  const avgSpeed = document.getElementById('avgSpeed');

  if (totalSentToday && status.stats?.sentToday !== undefined) {
    animateNumber(totalSentToday, parseInt(totalSentToday.textContent) || 0, status.stats.sentToday);
  }

  if (successRate && status.stats?.successRate !== undefined) {
    successRate.textContent = `${status.stats.successRate}%`;
  }

  if (avgSpeed && status.stats?.avgSpeed !== undefined) {
    avgSpeed.textContent = `${status.stats.avgSpeed}s`;
  }
}

function animateNumber(element, start, end, duration = 1000) {
  const range = end - start;
  const increment = range / (duration / 16);
  let current = start;

  const timer = setInterval(() => {
    current += increment;
    if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
      current = end;
      clearInterval(timer);
    }
    element.textContent = Math.floor(current).toLocaleString();
  }, 16);
}

// Variables para calcular velocidad en tiempo real
let lastSentCount = 0;
let lastUpdateTime = Date.now();
let speedHistory = [];

function calculateRealTimeSpeed(currentSent, total) {
  const now = Date.now();
  const timeDiff = (now - lastUpdateTime) / 1000; // segundos

  if (timeDiff > 0 && currentSent > lastSentCount) {
    const messagesSent = currentSent - lastSentCount;
    const currentSpeed = messagesSent / timeDiff;

    // Mantener historial de velocidades para suavizar
    speedHistory.push(currentSpeed);
    if (speedHistory.length > 10) {
      speedHistory.shift(); // Mantener solo los últimos 10 valores
    }

    // Promedio de velocidades para suavizar fluctuaciones
    const avgSpeed = speedHistory.reduce((sum, speed) => sum + speed, 0) / speedHistory.length;

    lastSentCount = currentSent;
    lastUpdateTime = now;

    return Math.round(avgSpeed * 60); // mensajes por minuto
  }

  // Si no hay cambios, devolver la velocidad promedio histórica
  if (speedHistory.length > 0) {
    const avgSpeed = speedHistory.reduce((sum, speed) => sum + speed, 0) / speedHistory.length;
    return Math.round(avgSpeed * 60);
  }

  return 0;
}

let statusCheckPromise = null;

async function checkStatus() {
  // Evitar múltiples llamadas concurrentes
  if (statusCheckPromise) {
    return statusCheckPromise;
  }

  statusCheckPromise = performStatusCheck();
  const result = await statusCheckPromise;
  statusCheckPromise = null;
  return result;
}

async function performStatusCheck() {
  try {
    console.log('🔄 Realizando status check...');
    console.log('🔐 Estado de autenticación:', {
      keycloakExists: !!keycloak,
      isAuthenticated: keycloak?.authenticated,
      hasToken: !!keycloak?.token,
      tokenLength: keycloak?.token?.length || 0
    });

    const url = `${CONFIG.statusEndpoint}?t=${Date.now()}`;
    console.log('📡 Enviando petición a:', url);

    const res = await authFetch(url);

    console.log('📨 Respuesta recibida:', {
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries())
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = await res.json();

    console.log('✅ Status obtenido:', status);
    updateInterface(status);
    return status;
  } catch (e) {
    console.error('❌ Status check error:', e);
    return null;
  }
}

function startStatusCheck() {
  // Initial check
  setTimeout(async () => {
    await checkStatus();
    // Set up interval
    statusCheckTimer = setInterval(checkStatus, CONFIG.checkInterval);
  }, 500);
}

/** ======== Message Form Management ======== */
let currentMessageType = 'none';

function setupMessageTypeHandlers() {
  const messageTypeInputs = document.querySelectorAll('input[name="messageType"]');

  messageTypeInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      currentMessageType = e.target.value;
      toggleMediaSections(currentMessageType);
    });
  });

  // Initialize with default
  toggleMediaSections(currentMessageType);
}

function toggleMediaSections(type) {
  const sections = {
    'singleImageSection': type === 'single',
    'multipleImagesSection': type === 'multiple',
    'audioSection': type === 'audio'
  };

  Object.entries(sections).forEach(([sectionId, shouldShow]) => {
    const section = document.getElementById(sectionId);
    if (section) {
      if (shouldShow) {
        section.classList.remove('d-none');
      } else {
        section.classList.add('d-none');
      }
    }
  });

  // Clear file inputs when switching types
  if (type !== 'single') clearFileInput('singleImage');
  if (type !== 'multiple') clearFileInput('images');
  if (type !== 'audio') clearFileInput('audioFile');
}

function clearFileInput(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = '';
    updateFileInfo(inputId, null);
  }
}

function updateFileInfo(inputId, files) {
  const infoId = inputId + 'Info';
  const infoElement = document.getElementById(infoId);

  if (!infoElement) return;

  if (!files || files.length === 0) {
    infoElement.classList.remove('show');
    return;
  }

  let infoContent = '';
  Array.from(files).forEach(file => {
    const sizeStr = formatFileSize(file.size);
    infoContent += `
      <div class="file-info-item">
        <span class="file-name">${file.name}</span>
        <span class="file-size">${sizeStr}</span>
      </div>
    `;
  });

  infoElement.innerHTML = infoContent;
  infoElement.classList.add('show');
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function setupFileInputHandlers() {
  const fileInputs = ['csvFile', 'singleImage', 'images', 'audioFile'];

  fileInputs.forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('change', (e) => {
        updateFileInfo(inputId, e.target.files);
      });
    }
  });
}

function updateCharacterCount() {
  const textarea = document.getElementById('message');
  const charCount = document.getElementById('charCount');

  if (textarea && charCount) {
    const length = textarea.value.length;
    charCount.textContent = length;

    // Color coding for character limit
    if (length > 3500) {
      charCount.style.color = 'var(--error-500)';
    } else if (length > 3000) {
      charCount.style.color = 'var(--warning-500)';
    } else {
      charCount.style.color = 'var(--text-tertiary)';
    }
  }
}

function setupMessageTextarea() {
  const textarea = document.getElementById('message');

  if (textarea) {
    // Solo agregar el listener de character count, no input
    // El highlighting se maneja en setupVariablesSystem
    textarea.addEventListener('input', updateCharacterCount);
    // Initialize character count
    updateCharacterCount();
  }
}

/** ======== Emoji Picker ======== */
const emojiCategories = {
  smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🫠', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🫢', '🫣', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😶‍🌫️', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '😵‍💫', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐'],
  people: ['👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '🫵', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '🫦', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '🧔‍♂️', '🧔‍♀️', '👨‍🦰', '👨‍🦱', '👨‍🦳', '👨‍🦲', '👩', '👩‍🦰', '🧑‍🦰', '👩‍🦱', '🧑‍🦱', '👩‍🦳', '🧑‍🦳', '👩‍🦲', '🧑‍🦲', '👱‍♀️', '👱‍♂️'],
  nature: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛'],
  food: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯'],
  activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️‍♀️', '🏋️', '🏋️‍♂️', '🤼‍♀️', '🤼', '🤼‍♂️', '🤸‍♀️', '🤸', '🤸‍♂️', '⛹️‍♀️', '⛹️', '⛹️‍♂️', '🤺', '🤾‍♀️', '🤾', '🤾‍♂️', '🏌️‍♀️', '🏌️', '🏌️‍♂️', '🏇', '🧘‍♀️', '🧘', '🧘‍♂️', '🏄‍♀️', '🏄', '🏄‍♂️', '🏊‍♀️', '🏊', '🏊‍♂️', '🤽‍♀️', '🤽', '🤽‍♂️', '🚣‍♀️', '🚣', '🚣‍♂️', '🧗‍♀️', '🧗', '🧗‍♂️', '🚵‍♀️', '🚵', '🚵‍♂️', '🚴‍♀️', '🚴', '🚴‍♂️', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🤹‍♂️', '🤹‍♀️', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎵', '🎶', '🪘', '🥁', '🪗', '🎹', '🎷', '🎺', '🪕', '🎸', '🪈', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
  travel: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛹', '🛼', '🚁', '🛸', '✈️', '🛩️', '🛫', '🛬', '🪂', '💺', '🚀', '🛰️', '🚉', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛩️', '🛫', '🛬', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🪝', '⛽', '🚧', '🚨', '🚥', '🚦', '🛑', '🚏', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🛕', '🕍', '🕊️', '🏞️', '🏜️', '🏝️', '🏖️'],
  objects: ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🪫', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛏️', '🛋️', '🪞', '🚿', '🛁', '🚽', '🪤', '🪒', '🧴', '🧷', '🧹', '🧺', '🧻', '🪣', '🧼', '🪥', '🧽', '🧯', '🛒'],
  symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'],
  flags: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇦🇨', '🇦🇩', '🇦🇪', '🇦🇫', '🇦🇬', '🇦🇮', '🇦🇱', '🇦🇲', '🇦🇴', '🇦🇶', '🇦🇷', '🇦🇸', '🇦🇹', '🇦🇺', '🇦🇼', '🇦🇽', '🇦🇿', '🇧🇦', '🇧🇧', '🇧🇩', '🇧🇪', '🇧🇫', '🇧🇬', '🇧🇭', '🇧🇮', '🇧🇯', '🇧🇱', '🇧🇲', '🇧🇳', '🇧🇴', '🇧🇶', '🇧🇷', '🇧🇸', '🇧🇹', '🇧🇻', '🇧🇼', '🇧🇾', '🇧🇿', '🇨🇦', '🇨🇨', '🇨🇩', '🇨🇫', '🇨🇬', '🇨🇭', '🇨🇮', '🇨🇰', '🇨🇱', '🇨🇲', '🇨🇳', '🇨🇴', '🇨🇵', '🇨🇷', '🇨🇺', '🇨🇻', '🇨🇼', '🇨🇽', '🇨🇾', '🇨🇿', '🇩🇪', '🇩🇬', '🇩🇯', '🇩🇰', '🇩🇲', '🇩🇴', '🇩🇿', '🇪🇦', '🇪🇨', '🇪🇪', '🇪🇬', '🇪🇭', '🇪🇷', '🇪🇸', '🇪🇹', '🇪🇺', '🇫🇮', '🇫🇯', '🇫🇰', '🇫🇲', '🇫🇴', '🇫🇷', '🇬🇦', '🇬🇧', '🇬🇩', '🇬🇪', '🇬🇫', '🇬🇬', '🇬🇭', '🇬🇮', '🇬🇱', '🇬🇲', '🇬🇳', '🇬🇵', '🇬🇶', '🇬🇷', '🇬🇸', '🇬🇹', '🇬🇺', '🇬🇼', '🇬🇾', '🇭🇰', '🇭🇲', '🇭🇳', '🇭🇷', '🇭🇹', '🇭🇺', '🇮🇨', '🇮🇩', '🇮🇪', '🇮🇱', '🇮🇲', '🇮🇳', '🇮🇴', '🇮🇶', '🇮🇷', '🇮🇸', '🇮🇹', '🇯🇪', '🇯🇲', '🇯🇴', '🇯🇵', '🇰🇪', '🇰🇬', '🇰🇭', '🇰🇮', '🇰🇲', '🇰🇳', '🇰🇵', '🇰🇷', '🇰🇼', '🇰🇾', '🇰🇿', '🇱🇦', '🇱🇧', '🇱🇨', '🇱🇮', '🇱🇰', '🇱🇷', '🇱🇸', '🇱🇹', '🇱🇺', '🇱🇻', '🇱🇾', '🇲🇦', '🇲🇨', '🇲🇩', '🇲🇪', '🇲🇫', '🇲🇬', '🇲🇭', '🇲🇰', '🇲🇱', '🇲🇲', '🇲🇳', '🇲🇴', '🇲🇵', '🇲🇶', '🇲🇷', '🇲🇸', '🇲🇹', '🇲🇺', '🇲🇻', '🇲🇼', '🇲🇽', '🇲🇾', '🇲🇿', '🇳🇦', '🇳🇨', '🇳🇪', '🇳🇫', '🇳🇬', '🇳🇮', '🇳🇱', '🇳🇴', '🇳🇵', '🇳🇷', '🇳🇺', '🇳🇿', '🇴🇲', '🇵🇦', '🇵🇪', '🇵🇫', '🇵🇬', '🇵🇭', '🇵🇰', '🇵🇱', '🇵🇲', '🇵🇳', '🇵🇷', '🇵🇸', '🇵🇹', '🇵🇼', '🇵🇾', '🇶🇦', '🇷🇪', '🇷🇴', '🇷🇸', '🇷🇺', '🇷🇼', '🇸🇦', '🇸🇧', '🇸🇨', '🇸🇩', '🇸🇪', '🇸🇬', '🇸🇭', '🇸🇮', '🇸🇯', '🇸🇰', '🇸🇱', '🇸🇲', '🇸🇳', '🇸🇴', '🇸🇷', '🇸🇸', '🇸🇹', '🇸🇻', '🇸🇽', '🇸🇾', '🇸🇿', '🇹🇦', '🇹🇨', '🇹🇩', '🇹🇫', '🇹🇬', '🇹🇭', '🇹🇯', '🇹🇰', '🇹🇱', '🇹🇲', '🇹🇳', '🇹🇴', '🇹🇷', '🇹🇹', '🇹🇻', '🇹🇼', '🇹🇿', '🇺🇦', '🇺🇬', '🇺🇲', '🇺🇳', '🇺🇸', '🇺🇾', '🇺🇿', '🇻🇦', '🇻🇨', '🇻🇪', '🇻🇬', '🇻🇮', '🇻🇳', '🇻🇺', '🇼🇫', '🇼🇸', '🇽🇰', '🇾🇪', '🇾🇹', '🇿🇦', '🇿🇲', '🇿🇼', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴󠁧󠁢󠁷󠁬󠁳󠁿']
};

let currentEmojiCategory = 'smileys';
let emojiSystemInitialized = false;

function setupEmojiPicker() {
  // Evitar inicialización múltiple
  if (emojiSystemInitialized) {
    return;
  }

  const emojiBtn = document.getElementById('emojiBtn');
  const emojiPicker = document.getElementById('emojiPicker');
  const emojiGrid = document.getElementById('emojiGrid');
  const textarea = document.getElementById('message');

  if (!emojiBtn || !emojiPicker || !emojiGrid || !textarea) {
    return;
  }

  // Marcar como inicializado
  emojiSystemInitialized = true;

  // Toggle emoji picker
  emojiBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    emojiPicker.classList.toggle('d-none');
    if (!emojiPicker.classList.contains('d-none')) {
      populateEmojis(currentEmojiCategory);
    }
  });

  // Close picker when clicking outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
      emojiPicker.classList.add('d-none');
    }
  });

  // Category buttons
  const categoryButtons = emojiPicker.querySelectorAll('.emoji-category');
  categoryButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const category = btn.getAttribute('data-category');

      // Update active category
      categoryButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentEmojiCategory = category;
      populateEmojis(category);
    });
  });

  function populateEmojis(category) {
    const emojis = emojiCategories[category] || emojiCategories.smileys;
    emojiGrid.innerHTML = '';

    emojis.forEach(emoji => {
      const emojiBtn = document.createElement('button');
      emojiBtn.className = 'emoji-item';
      emojiBtn.textContent = emoji;
      emojiBtn.type = 'button';

      emojiBtn.addEventListener('click', (e) => {
        e.preventDefault();
        insertEmoji(emoji);
      });

      emojiGrid.appendChild(emojiBtn);
    });
  }

  function insertEmoji(emoji) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    // Insert emoji at cursor position
    const newText = text.substring(0, start) + emoji + text.substring(end);
    textarea.value = newText;

    // Update cursor position
    const newCursorPos = start + emoji.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    // Focus back to textarea
    textarea.focus();

    // Trigger input event to update character count
    textarea.dispatchEvent(new Event('input'));

    // Close picker after selection
    emojiPicker.classList.add('d-none');
  }

  // Initialize with default category
  populateEmojis(currentEmojiCategory);
}

/** ======== Message Status & Progress ======== */
let messageProgressPoll = null;
let heartbeatTimer = null;

// Variable global para rastrear si ya se notificó la cancelación
let cancelNotificationShown = false;
let lastKnownState = null;

function updateMessageStatus(status) {
  const { sent, total, errors, messages, completed, canceled, state } = status || {};

  // Update progress bar with smooth animation
  const progress = total > 0 ? Math.round((sent / total) * 100) : 0;
  const progressFill = document.querySelector('.progress-fill');
  const progressPercentage = document.querySelector('.progress-percentage');

  if (progressFill) {
    // Add active class during sending for faster animation
    if (!completed && total > 0) {
      progressFill.classList.add('active');
    } else {
      progressFill.classList.remove('active');
    }
    // Visual feedback for canceled campaigns
    if (canceled) {
      progressFill.style.backgroundColor = 'var(--warning-500)';
    } else if (completed && errors > 0) {
      progressFill.style.backgroundColor = 'var(--error-500)';
    } else {
      progressFill.style.backgroundColor = ''; // Reset to default
    }
    progressFill.style.width = `${progress}%`;
  }
  if (progressPercentage) {
    progressPercentage.textContent = `${progress}%`;
  }

  // Update stat cards with smooth number animation
  updateStatCard('totalCount', total || 0);
  updateStatCard('sentCount', sent || 0);
  updateStatCard('errorCount', errors || 0);

  // Calculate and display real-time speed
  const currentSpeed = calculateRealTimeSpeed(sent, total);
  updateStatCard('currentSpeed', currentSpeed);

  // Update status table
  updateStatusTable(messages || []);

  // CRITICAL: Detect campaign cancellation
  if (canceled && !cancelNotificationShown) {
    cancelNotificationShown = true;
    stopProgressPolling();

    const sendBtn = document.getElementById('sendMessageBtn');
    if (sendBtn) {
      sendBtn.classList.remove('loading');
      sendBtn.disabled = false;
    }

    // Show prominent cancellation alert
    showAlert(
      `Campaña cancelada. Enviados: ${sent || 0}/${total || 0} mensajes.\n` +
      `Motivo: ${state === 'no_heartbeat_refresh' ? 'Se perdió la conexión con el navegador' : 'Cancelado manualmente'}`,
      'warning',
      '⚠️ Envío Cancelado'
    );

    return; // Don't process as completed
  }

  // Detect state changes and notify user
  if (state && state !== lastKnownState) {
    lastKnownState = state;

    // Notify about important state changes
    if (state === 'running' && !completed) {
      // Campaign just started
      console.log('📤 Campaña iniciada');
    } else if (state === 'queued') {
      showAlert('Campaña en cola, esperando procesamiento...', 'info', 'En espera');
    }
  }

  // Handle completion (only if not canceled)
  if (completed && !canceled) {
    stopProgressPolling();
    cancelNotificationShown = false; // Reset for next campaign

    const sendBtn = document.getElementById('sendMessageBtn');
    if (sendBtn) {
      sendBtn.classList.remove('loading');
      sendBtn.disabled = false;
    }

    // Add success animation to progress bar
    if (progressFill && (errors || 0) === 0) {
      progressFill.classList.add('success');
      setTimeout(() => {
        progressFill.classList.remove('success');
      }, 3000);
    }

    if ((errors || 0) === 0) {
      showAlert('Todos los mensajes fueron enviados exitosamente', 'success', '✅ Envío completado');
    } else {
      showAlert(
        `Envío completado con ${errors} error${errors > 1 ? 'es' : ''}.\n` +
        `Enviados exitosamente: ${sent}/${total}`,
        'warning',
        '⚠️ Completado con errores'
      );
    }
  }
}

function updateStatCard(statId, value) {
  const element = document.getElementById(statId);
  if (element) {
    const currentValue = parseInt(element.textContent) || 0;
    // Animación más rápida durante envío activo para mejor respuesta
    animateNumber(element, currentValue, value, 300);
  }
}

function updateStatusTable(messages) {
  const tbody = document.getElementById('statusTableBody');
  if (!tbody || !Array.isArray(messages)) return;

  // Clear existing rows if needed
  messages.forEach(message => {
    const key = String(message.number);
    let row = tbody.querySelector(`[data-number="${key}"]`);

    if (!row) {
      row = document.createElement('tr');
      row.setAttribute('data-number', key);
      tbody.appendChild(row);
    }

    const badgeClass = {
      'queued': 'badge-queued',
      'sending': 'badge-sending',
      'sent': 'badge-sent',
      'error': 'badge-error'
    }[message.status] || 'badge-queued';

    const timestamp = message.timestamp ?
      new Date(message.timestamp).toLocaleTimeString() : '—';

    row.innerHTML = `
      <td>${message.number}</td>
      <td><span class="status-badge ${badgeClass}">${message.status}</span></td>
      <td>${timestamp}</td>
      <td>${message.response || message.message || '—'}</td>
    `;

    row.className = message.status === 'error' ? 'status-row-error' : 'status-row-success';
  });
}

let progressPollErrorCount = 0;
const MAX_POLL_ERRORS = 3;

// Enviar heartbeat automático al backend
async function sendHeartbeat() {
  try {
    await authFetch('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('💓 Heartbeat enviado');
  } catch (e) {
    console.warn('⚠️ Error enviando heartbeat:', e.message);
  }
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  // Enviar heartbeat cada 10 segundos (mucho antes del TTL de 300s)
  heartbeatTimer = setInterval(sendHeartbeat, 10000);

  // Enviar uno inmediatamente
  sendHeartbeat();

  console.log('💗 Sistema de heartbeat iniciado');
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('💔 Sistema de heartbeat detenido');
  }
}

function startProgressPolling() {
  if (messageProgressPoll) clearInterval(messageProgressPoll);

  // Reset error counter and cancel notification flag
  progressPollErrorCount = 0;
  cancelNotificationShown = false;
  lastKnownState = null;

  // Iniciar heartbeat automático
  startHeartbeat();

  messageProgressPoll = setInterval(async () => {
    try {
      const res = await authFetch('/message-status');

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const status = await res.json();

      // Reset error counter on success
      progressPollErrorCount = 0;

      updateMessageStatus(status);

      // Stop polling if completed OR canceled
      if (status.completed || status.canceled) {
        stopProgressPolling();
      }
    } catch (e) {
      console.error('Progress polling error:', e);
      progressPollErrorCount++;

      // Alert user after consecutive failures
      if (progressPollErrorCount >= MAX_POLL_ERRORS) {
        stopProgressPolling();

        const sendBtn = document.getElementById('sendMessageBtn');
        if (sendBtn) {
          sendBtn.classList.remove('loading');
          sendBtn.disabled = false;
        }

        showAlert(
          'Se perdió la conexión con el servidor.\n' +
          'El envío puede continuar en segundo plano.\n' +
          'Por favor recarga la página para verificar el estado.',
          'error',
          '❌ Error de conexión'
        );
      }
    }
  }, 1000); // Polling de progreso cada 1000ms para reducir carga
}

function stopProgressPolling() {
  if (messageProgressPoll) {
    clearInterval(messageProgressPoll);
    messageProgressPoll = null;
  }

  // Detener heartbeat también
  stopHeartbeat();
}

async function cancelCampaignFrontend() {
  try {
    const res = await authFetch('/cancel-campaign', { method: 'POST' });
    const result = await res.json();
    if (res.ok) {
      stopProgressPolling();
      showAlert('Envío cancelado', 'warning', 'La campaña fue cancelada');
      // Solicitar estado actualizado
      try {
        const st = await authFetch('/message-status');
        const status = await st.json();
        updateMessageStatus(status);
      } catch { }
    } else {
      showAlert(result?.error || 'No se pudo cancelar', 'error');
    }
  } catch (e) {
    showAlert('Error de red al cancelar', 'error');
    console.error('Cancel error:', e);
  }
}

/** ======== Templates System ======== */
let currentTemplateCount = 1;
let currentActiveTemplate = 1; // Track which template is active for emoji/variables insertion

function generateTemplateFields(count) {
  const container = document.getElementById('templatesContainer');
  if (!container) return;

  container.innerHTML = '';
  currentTemplateCount = count;

  for (let i = 1; i <= count; i++) {
    const templateDiv = document.createElement('div');
    templateDiv.className = 'template-field';
    templateDiv.setAttribute('data-template-index', i);

    // Calculate which lines this template will use
    const lineExamples = [];
    for (let j = 0; j < 3; j++) {
      lineExamples.push(i + (j * count));
    }
    const lineText = lineExamples.join(', ') + '...';

    templateDiv.innerHTML = `
      <div class="template-header">
        <h5>Template ${i}</h5>
        <span class="template-badge">Líneas: ${lineText}</span>
      </div>
      <div class="message-textarea-container">
        <textarea 
          id="template${i}" 
          name="templates[]"
          class="message-textarea"
          placeholder="Escribe el template ${i}... Puedes usar {tratamiento}, {nombre} y {grupo}

Ejemplo: 'Buen día {tratamiento} {nombre} del grupo {grupo}, le escribo para...'

Este template se usará con las líneas ${lineText} del CSV"
          rows="4"
          required
        ></textarea>
      </div>
      <div class="template-tools">
        <div class="character-counter">
          <span id="charCount${i}">0</span>/4096 caracteres
        </div>
        <div class="template-actions">
          <button type="button" class="btn-template-emoji" data-template="${i}" title="Insertar emoji">
            <i class="bi bi-emoji-smile"></i>
          </button>
          <button type="button" class="btn-template-variables" data-template="${i}" title="Insertar variables">
            <i class="bi bi-braces"></i>
          </button>
        </div>
      </div>
    `;

    container.appendChild(templateDiv);

    // Add event listener for character count
    const textarea = templateDiv.querySelector(`#template${i}`);
    textarea.addEventListener('input', () => updateTemplateCharCount(i));

    // Add event listeners for emoji and variables buttons
    const emojiBtn = templateDiv.querySelector('.btn-template-emoji');
    const variablesBtn = templateDiv.querySelector('.btn-template-variables');

    emojiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentActiveTemplate = i;
      const emojiPicker = document.getElementById('emojiPicker');
      emojiPicker.classList.toggle('d-none');
      if (!emojiPicker.classList.contains('d-none')) {
        populateEmojisForTemplate(currentEmojiCategory);
      }
    });

    variablesBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentActiveTemplate = i;
      const variablesHelper = document.getElementById('variablesHelper');
      variablesHelper.classList.toggle('d-none');
    });
  }

  console.log(`✅ Generados ${count} campos de templates`);
}

function updateTemplateCharCount(templateIndex) {
  const textarea = document.getElementById(`template${templateIndex}`);
  const counter = document.getElementById(`charCount${templateIndex}`);

  if (textarea && counter) {
    const length = textarea.value.length;
    counter.textContent = length;

    // Visual feedback for character limit
    if (length > 4096) {
      counter.style.color = 'var(--error-500)';
    } else if (length > 3500) {
      counter.style.color = 'var(--warning-500)';
    } else {
      counter.style.color = 'var(--primary-500)';
    }
  }
}

function setupTemplateCountSelector() {
  const selector = document.getElementById('templateCount');
  if (!selector) return;

  // Generate initial template field (1 template by default)
  generateTemplateFields(1);

  // Listen for changes
  selector.addEventListener('change', (e) => {
    const count = parseInt(e.target.value);
    generateTemplateFields(count);
  });

  console.log('✅ Selector de templates configurado');
}

function collectTemplates() {
  const templates = [];

  for (let i = 1; i <= currentTemplateCount; i++) {
    const textarea = document.getElementById(`template${i}`);
    if (!textarea) {
      console.error(`Template ${i} not found`);
      return null;
    }

    const value = textarea.value.trim();
    if (!value) {
      showAlert(`El template ${i} no puede estar vacío`, 'error', 'Error de validación');
      return null;
    }

    if (value.length > 4096) {
      showAlert(`El template ${i} excede el límite de 4096 caracteres`, 'error', 'Error de validación');
      return null;
    }

    templates.push(value);
  }

  console.log(`✅ Recolectados ${templates.length} templates`);
  return templates;
}

// Helper function to populate emojis for template
function populateEmojisForTemplate(category) {
  const emojis = emojiCategories[category] || emojiCategories.smileys;
  const emojiGrid = document.getElementById('emojiGrid');
  if (!emojiGrid) return;

  emojiGrid.innerHTML = '';

  emojis.forEach(emoji => {
    const emojiBtn = document.createElement('button');
    emojiBtn.className = 'emoji-item';
    emojiBtn.textContent = emoji;
    emojiBtn.type = 'button';

    emojiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      insertEmojiIntoTemplate(emoji);
    });

    emojiGrid.appendChild(emojiBtn);
  });
}

// Helper function to insert emoji into current active template
function insertEmojiIntoTemplate(emoji) {
  const textarea = document.getElementById(`template${currentActiveTemplate}`);
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;

  // Insert emoji at cursor position
  const newText = text.substring(0, start) + emoji + text.substring(end);
  textarea.value = newText;

  // Update cursor position
  const newCursorPos = start + emoji.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);

  // Focus back to textarea
  textarea.focus();

  // Trigger input event to update character count
  textarea.dispatchEvent(new Event('input'));

  // Close picker after selection
  const emojiPicker = document.getElementById('emojiPicker');
  if (emojiPicker) emojiPicker.classList.add('d-none');
}

/** ======== Form Submission ======== */
async function handleMessageFormSubmit(event) {
  event.preventDefault();

  // First, verify WhatsApp connection
  try {
    const statusRes = await authFetch(CONFIG.statusEndpoint);
    const currentStatus = await statusRes.json();
    if (!currentStatus.isReady) {
      showAlert('WhatsApp no está conectado. Por favor conecte primero.', 'error', 'Conexión requerida');
      showTab('link'); // Redirect to connection tab
      return;
    }
  } catch (e) {
    showAlert('Error al verificar estado de conexión', 'error');
    return;
  }

  const sendBtn = document.getElementById('sendMessageBtn');
  const messageStatus = document.getElementById('messageStatus');

  // Show progress section
  if (messageStatus) {
    messageStatus.classList.remove('d-none');
  }

  // Update button state
  if (sendBtn) {
    sendBtn.classList.add('loading');
    sendBtn.disabled = true;
  }

  // Clear previous results
  const tbody = document.getElementById('statusTableBody');
  if (tbody) tbody.innerHTML = '';

  // Reset speed calculation variables
  lastSentCount = 0;
  lastUpdateTime = Date.now();
  speedHistory = [];

  // Get recipient source
  const recipientSource = document.getElementById('recipientSource')?.value || 'csv';
  
  // Validate recipients based on source
  let hasRecipients = false;
  if (recipientSource === 'csv') {
    const csvFile = document.getElementById('csvFile')?.files[0];
    if (!csvFile) {
      showAlert('Debe seleccionar un archivo CSV o TXT', 'error', 'Error de validación');
      resetFormSubmission(sendBtn);
      return;
    }
    hasRecipients = true;
  } else if (recipientSource === 'contacts') {
    if (selectedContactIds.length === 0) {
      showAlert('Debe seleccionar al menos un contacto', 'error', 'Error de validación');
      resetFormSubmission(sendBtn);
      return;
    }
    hasRecipients = true;
  } else if (recipientSource === 'group') {
    const groupName = document.getElementById('groupSelect')?.value;
    if (!groupName) {
      showAlert('Debe seleccionar un grupo', 'error', 'Error de validación');
      resetFormSubmission(sendBtn);
      return;
    }
    hasRecipients = true;
  }

  if (!hasRecipients) {
    showAlert('Debe especificar destinatarios', 'error', 'Error de validación');
    resetFormSubmission(sendBtn);
    return;
  }

  // Validate media files based on type
  if (!validateMediaFiles()) {
    resetFormSubmission(sendBtn);
    return;
  }

  // Collect templates
  const templates = collectTemplates();
  if (!templates || templates.length === 0) {
    resetFormSubmission(sendBtn);
    return;
  }

  // Prepare form data
  const formData = new FormData();
  formData.append('templates', JSON.stringify(templates)); // Send templates as JSON
  formData.append('recipientSource', recipientSource);
  formData.append('mode', currentMessageType);
  
  // Add recipients based on source
  if (recipientSource === 'csv') {
    const csvFile = document.getElementById('csvFile').files[0];
    formData.append('csvFile', csvFile);
  } else if (recipientSource === 'contacts') {
    formData.append('contactIds', JSON.stringify(selectedContactIds));
  } else if (recipientSource === 'group') {
    const groupName = document.getElementById('groupSelect').value;
    formData.append('groupName', groupName);
  }
  
  const campaignName = document.getElementById('campaignName')?.value?.trim();
  if (campaignName) formData.append('campaignName', campaignName);

  // Add media files
  appendMediaFiles(formData);

  try {
    const res = await authFetch('/send-messages', {
      method: 'POST',
      body: formData
    });

    const result = await res.json();

    if (res.ok) {
      showAlert('Envío iniciado correctamente', 'success', 'Proceso iniciado');

      if (result.initialStats) {
        updateMessageStatus(result.initialStats);
      }

      // Start polling for progress
      startProgressPolling();
    } else {
      showAlert(result.error || 'Error al enviar mensajes', 'error', 'Error en envío');
      resetFormSubmission(sendBtn);
    }
  } catch (err) {
    console.error('Form submission error:', err);
    showAlert(`Error: ${err.message}`, 'error', 'Error de conexión');
    resetFormSubmission(sendBtn);
  }
}

function validateMediaFiles() {
  if (currentMessageType === 'single') {
    const singleImage = document.getElementById('singleImage').files[0];
    if (!singleImage) {
      showAlert('Debe seleccionar una imagen', 'warning', 'Archivo requerido');
      return false;
    }
  } else if (currentMessageType === 'multiple') {
    const images = document.getElementById('images').files;
    if (!images || images.length === 0) {
      showAlert('Debe seleccionar al menos una imagen', 'warning', 'Archivos requeridos');
      return false;
    }
  } else if (currentMessageType === 'audio') {
    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) {
      showAlert('Debe seleccionar un archivo de audio', 'warning', 'Archivo requerido');
      return false;
    }
  }
  return true;
}

function appendMediaFiles(formData) {
  if (currentMessageType === 'single') {
    const singleImage = document.getElementById('singleImage').files[0];
    if (singleImage) formData.append('singleImage', singleImage);
  } else if (currentMessageType === 'multiple') {
    const images = document.getElementById('images').files;
    for (let i = 0; i < images.length; i++) {
      formData.append('images', images[i]);
    }
  } else if (currentMessageType === 'audio') {
    const audioFile = document.getElementById('audioFile').files[0];
    if (audioFile) formData.append('audioFile', audioFile);
  }
}

function resetFormSubmission(sendBtn) {
  if (sendBtn) {
    sendBtn.classList.remove('loading');
    sendBtn.disabled = false;
  }
  stopProgressPolling();
}

/** ======== Analytics + Contacts ======== */
let timelineChartInstance = null;
let groupPieChartInstance = null;

function getMonthDateRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function getDateRangePreset(preset) {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from;
  
  switch (preset) {
    case '7d':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      break;
    case '30d':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      break;
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      break;
    case '90d':
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      break;
    default:
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  
  return { from, to };
}

function ensureAnalyticsDateDefaults() {
  const fromInput = document.getElementById('analyticsFrom');
  const toInput = document.getElementById('analyticsTo');
  if (!fromInput || !toInput) return null;
  const range = getDateRangePreset('30d');
  if (!fromInput.value) fromInput.value = range.from;
  if (!toInput.value) toInput.value = range.to;
  return { from: fromInput.value, to: toInput.value };
}

function buildQuery(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

function getChartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#d8dee9';
}

function updateMonthlyKpis(currentMonthData) {
  const sentEl = document.getElementById('monthlySentValue');
  const rateEl = document.getElementById('monthlySuccessRateValue');
  const vsPrevEl = document.getElementById('monthlyVsPrevValue');
  const errEl = document.getElementById('monthlyErrorValue');
  
  // Also update KPI cards
  const kpiMonthlySent = document.getElementById('kpiMonthlySent');
  const kpiSuccessRate = document.getElementById('kpiSuccessRate');
  const kpiMonthlyErrors = document.getElementById('kpiMonthlyErrors');
  const kpiTrendSent = document.getElementById('kpiTrendSent');
  const kpiRingProgress = document.getElementById('kpiRingProgress');
  
  if (!currentMonthData) return;

  const sent = Number(currentMonthData.sent || 0);
  const errors = Number(currentMonthData.errors || 0);
  const rate = Number(currentMonthData.successRate || 0);
  const delta = Number(currentMonthData.deltaPercent || 0);

  if (sentEl) sentEl.textContent = sent.toLocaleString();
  if (rateEl) rateEl.textContent = `${rate.toFixed(1)}%`;
  if (vsPrevEl) {
    const sign = delta > 0 ? '+' : '';
    vsPrevEl.textContent = `${sign}${delta.toFixed(1)}%`;
    vsPrevEl.classList.remove('positive', 'negative');
    vsPrevEl.classList.add(delta >= 0 ? 'positive' : 'negative');
  }
  if (errEl) errEl.textContent = `${errors}`;
  
  // Update KPI cards
  if (kpiMonthlySent) kpiMonthlySent.textContent = sent.toLocaleString();
  if (kpiSuccessRate) kpiSuccessRate.textContent = `${rate.toFixed(1)}%`;
  if (kpiMonthlyErrors) kpiMonthlyErrors.textContent = errors.toLocaleString();
  if (kpiTrendSent) {
    const sign = delta > 0 ? '+' : '';
    kpiTrendSent.innerHTML = `<i class="bi bi-arrow-${delta >= 0 ? 'up' : 'down'}-short"></i>${sign}${delta.toFixed(1)}%`;
    kpiTrendSent.classList.remove('positive', 'negative');
    kpiTrendSent.classList.add(delta >= 0 ? 'positive' : 'negative');
  }
  
  // Update progress ring
  if (kpiRingProgress) {
    kpiRingProgress.setAttribute('stroke-dasharray', `${rate}, 100`);
  }
  
  // Update monthly quick stat
  const monthlyTotalQuick = document.getElementById('monthlyTotalQuick');
  if (monthlyTotalQuick) monthlyTotalQuick.textContent = sent.toLocaleString();
}

function renderTimelineChart(rows = []) {
  const canvas = document.getElementById('timelineChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const labels = rows.map(r => r.bucket);
  const sent = rows.map(r => Number(r.sent || 0));
  const errors = rows.map(r => Number(r.errors || 0));
  const textColor = getChartTextColor();

  if (timelineChartInstance) timelineChartInstance.destroy();
  timelineChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Enviados',
          data: sent,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.2)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Errores',
          data: errors,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.15)',
          tension: 0.35,
          fill: true,
        }
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor } }
      },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: 'rgba(148,163,184,0.15)' } },
        y: { ticks: { color: textColor }, grid: { color: 'rgba(148,163,184,0.15)' }, beginAtZero: true }
      }
    }
  });
}

function renderGroupPieChart(rows = []) {
  const canvas = document.getElementById('groupPieChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const textColor = getChartTextColor();
  const labels = rows.map(r => r.group);
  const values = rows.map(r => Number(r.total || 0));
  const palette = ['#22c55e', '#0ea5e9', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6', '#f97316', '#84cc16', '#e11d48'];

  if (groupPieChartInstance) groupPieChartInstance.destroy();
  groupPieChartInstance = new Chart(canvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        label: 'Mensajes',
        data: values,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderWidth: 1,
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor }
        }
      }
    }
  });
}

function renderTopContacts(rows = []) {
  const tbody = document.getElementById('topContactsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Sin datos en el rango seleccionado</td></tr>';
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.nombre || '—'}</td>
      <td>${r.phone || '—'}</td>
      <td>${r.group || 'Sin grupo'}</td>
      <td>${Number(r.sent || 0)}</td>
      <td>${Number(r.errors || 0)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateHeroStatsFromSummary(summary = null) {
  if (!summary) return;
  const totalSentToday = document.getElementById('totalSentToday');
  const successRate = document.getElementById('successRate');
  if (totalSentToday) totalSentToday.textContent = Number(summary.sent || 0).toLocaleString();
  if (successRate) successRate.textContent = `${Number(summary.successRate || 0).toFixed(1)}%`;
}

async function loadHeroTodayStats() {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = start.toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const res = await authFetch(`/dashboard/summary${buildQuery({ from, to })}`);
    if (!res.ok) return;
    const summary = await res.json();
    updateHeroStatsFromSummary(summary);
    updateQuickStats(summary);
  } catch (e) {
    console.warn('Error loading hero today stats:', e.message);
  }
}

function updateQuickStats(summary) {
  const totalSent = Number(summary.totalSent || 0);
  const totalSuccess = Number(summary.totalSuccess || 0);
  const totalErrors = Number(summary.totalErrors || 0);
  
  // Update quick stats dashboard
  const totalSentEl = document.getElementById('totalSentToday');
  const successRateEl = document.getElementById('successRate');
  
  if (totalSentEl) totalSentEl.textContent = totalSent.toLocaleString();
  
  if (successRateEl) {
    if (totalSent > 0) {
      const rate = ((totalSuccess / totalSent) * 100).toFixed(1);
      successRateEl.textContent = `${rate}%`;
    } else {
      successRateEl.textContent = '--%';
    }
  }
}

async function loadTotalContacts() {
  try {
    const res = await authFetch('/contacts?pageSize=1');
    if (!res.ok) return;
    const data = await res.json();
    const total = data.total || data.items?.length || 0;
    
    const totalContactsEl = document.getElementById('totalContacts');
    const kpiTotalContactsEl = document.getElementById('kpiTotalContacts');
    
    if (totalContactsEl) totalContactsEl.textContent = total.toLocaleString();
    if (kpiTotalContactsEl) kpiTotalContactsEl.textContent = total.toLocaleString();
  } catch (e) {
    console.warn('Error loading total contacts:', e.message);
  }
}

function setupDatePresets() {
  const presets = ['7d', '30d', 'month', '90d'];
  presets.forEach(preset => {
    const btn = document.getElementById(`preset${preset.charAt(0).toUpperCase() + preset.slice(1)}`);
    if (!btn) return;
    
    btn.addEventListener('click', () => {
      // Remove active from all preset buttons
      presets.forEach(p => {
        const b = document.getElementById(`preset${p.charAt(0).toUpperCase() + p.slice(1)}`);
        if (b) b.classList.remove('active');
      });
      btn.classList.add('active');
      
      // Set date range
      const range = getDateRangePreset(preset);
      const fromInput = document.getElementById('analyticsFrom');
      const toInput = document.getElementById('analyticsTo');
      if (fromInput) fromInput.value = range.from;
      if (toInput) toInput.value = range.to;
      
      // Reload dashboard
      loadAnalyticsDashboard();
    });
  });
}

async function loadAnalyticsDashboard() {
  try {
    const defaults = ensureAnalyticsDateDefaults();
    if (!defaults) return;

    const { from, to } = defaults;
    const [_summaryRes, timelineRes, groupRes, topRes, currentMonthRes] = await Promise.all([
      authFetch(`/dashboard/summary${buildQuery({ from, to })}`),
      authFetch(`/dashboard/timeline${buildQuery({ from, to, bucket: 'day' })}`),
      authFetch(`/dashboard/by-group${buildQuery({ from, to })}`),
      authFetch(`/dashboard/by-contact${buildQuery({ from, to, limit: 10 })}`),
      authFetch('/dashboard/current-month'),
    ]);

    await _summaryRes.json();
    const timeline = await timelineRes.json();
    const byGroup = await groupRes.json();
    const byContact = await topRes.json();
    const currentMonth = await currentMonthRes.json();

    updateMonthlyKpis(currentMonth);
    renderTimelineChart(timeline.rows || []);
    renderGroupPieChart(byGroup.rows || []);
    renderTopContacts(byContact.rows || []);
  } catch (error) {
    console.error('Error loading analytics:', error);
  }
}

// Limpiar caché Redis del usuario actual
async function clearUserCache() {
  const btn = document.getElementById('clearCacheBtn');
  if (!btn) return;

  if (!confirm('¿Seguro que deseas limpiar tu caché? Se eliminarán las métricas almacenadas en Redis.')) {
    return;
  }

  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i>';

  try {
    const res = await authFetch('/cache/user', { method: 'DELETE' });
    const data = await res.json();

    if (data.success) {
      showAlert(`Caché limpiado: ${data.deletedKeys || 0} claves eliminadas`, 'success');
      // Recargar dashboard
      loadAnalyticsDashboard();
    } else {
      showAlert(data.error || 'Error al limpiar caché', 'danger');
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    showAlert('Error al limpiar caché', 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;
  }
}

function renderContactsTable(items = []) {
  const tbody = document.getElementById('contactsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay contactos</td></tr>';
    return;
  }
  items.forEach((c) => {
    const tr = document.createElement('tr');
    const sourceBadge = c.source === 'csv' 
      ? '<span class="badge bg-info">CSV</span>' 
      : '<span class="badge bg-secondary">Manual</span>';
    const sentCount = c.sent || 0;
    const errorCount = c.errors || 0;
    const successRate = sentCount > 0 ? ((sentCount - errorCount) / sentCount * 100).toFixed(0) : 0;
    const statsBadge = sentCount > 0 
      ? `<span class="badge ${successRate >= 90 ? 'bg-success' : successRate >= 70 ? 'bg-warning' : 'bg-danger'}">${successRate}%</span>`
      : '<span class="badge bg-secondary">--%</span>';
    
    tr.innerHTML = `
      <td><code>${c.phone || '—'}</code></td>
      <td>${c.nombre || '—'}</td>
      <td>${c.tratamiento || '—'}</td>
      <td>${c.grupo || '<span class="text-muted">Sin grupo</span>'}</td>
      <td>${sourceBadge}</td>
      <td class="text-center">${statsBadge}</td>
      <td class="d-flex gap-1">
        <button class="btn btn-sm btn-outline-info" data-action="edit-contact" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete-contact" data-id="${c.id}"><i class="bi bi-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadContacts() {
  try {
    const search = document.getElementById('contactSearchInput')?.value || '';
    const group = document.getElementById('contactGroupFilterInput')?.value || '';
    const res = await authFetch(`/contacts${buildQuery({ search, group, page: 1, pageSize: 200 })}`);
    const data = await res.json();
    renderContactsTable(data.items || []);
  } catch (error) {
    console.error('Error loading contacts:', error);
  }
}

async function createManualContact(event) {
  event.preventDefault();
  const phone = document.getElementById('manualPhone')?.value?.trim();
  const nombre = document.getElementById('manualNombre')?.value?.trim();
  const tratamiento = document.getElementById('manualTratamiento')?.value?.trim();
  const grupo = document.getElementById('manualGrupo')?.value?.trim();
  if (!phone) {
    showAlert('El número es obligatorio', 'warning');
    return;
  }
  try {
    const res = await authFetch('/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, nombre, tratamiento, grupo }),
    });
    const data = await res.json();
    if (!res.ok) {
      showAlert(data.error || 'No se pudo crear el contacto', 'error');
      return;
    }
    const form = document.getElementById('manualContactForm');
    if (form) form.reset();
    showAlert('Contacto guardado correctamente', 'success');
    loadContacts();
  } catch (error) {
    showAlert(`Error creando contacto: ${error.message}`, 'error');
  }
}

async function handleContactsTableClick(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');
  if (!id) return;

  if (action === 'delete-contact') {
    if (!confirm('¿Eliminar este contacto?')) return;
    try {
      const res = await authFetch(`/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showAlert(data.error || 'No se pudo eliminar', 'error');
        return;
      }
      showAlert('Contacto eliminado', 'success');
      loadContacts();
    } catch (error) {
      showAlert(`Error eliminando contacto: ${error.message}`, 'error');
    }
    return;
  }

  if (action === 'edit-contact') {
    const row = btn.closest('tr');
    if (!row) return;
    const currentPhone = row.children[0]?.textContent?.trim() || '';
    const currentNombre = row.children[1]?.textContent?.trim() || '';
    const currentTratamiento = row.children[2]?.textContent?.trim() || '';
    const currentGrupo = row.children[3]?.textContent?.trim() || '';

    const phone = prompt('Número de teléfono:', currentPhone);
    if (!phone) return;
    const nombre = prompt('Nombre:', currentNombre === '—' ? '' : currentNombre);
    const tratamiento = prompt('Tratamiento:', currentTratamiento === '—' ? '' : currentTratamiento);
    const grupo = prompt('Grupo:', (currentGrupo === '—' || currentGrupo === 'Sin grupo') ? '' : currentGrupo);
    try {
      const res = await authFetch(`/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, nombre, tratamiento, grupo }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert(data.error || 'No se pudo editar el contacto', 'error');
        return;
      }
      showAlert('Contacto actualizado', 'success');
      loadContacts();
    } catch (error) {
      showAlert(`Error editando contacto: ${error.message}`, 'error');
    }
  }
}

async function setAnalyticsToThisMonth() {
  const range = getMonthDateRange();
  const fromInput = document.getElementById('analyticsFrom');
  const toInput = document.getElementById('analyticsTo');
  if (fromInput) fromInput.value = range.from;
  if (toInput) toInput.value = range.to;
  await loadAnalyticsDashboard();
}

/** ======== Recipient Source Tabs ======== */
let selectedContactIds = [];
let selectorContactsCache = [];

function setupRecipientSourceTabs() {
  console.log('🎛️ setupRecipientSourceTabs: iniciando...');
  const tabs = document.querySelectorAll('.source-tab');
  const csvSection = document.getElementById('csvSourceSection');
  const contactsSection = document.getElementById('contactsSourceSection');
  const groupSection = document.getElementById('groupSourceSection');
  const recipientSourceInput = document.getElementById('recipientSource');
  
  console.log('🎛️ Elements found:', {
    tabs: tabs.length,
    csvSection: !!csvSection,
    contactsSection: !!contactsSection,
    groupSection: !!groupSection,
    recipientSourceInput: !!recipientSourceInput
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const source = tab.dataset.source;
      console.log('🎛️ Tab clicked:', source);
      
      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update hidden input
      if (recipientSourceInput) recipientSourceInput.value = source;
      
      // Show/hide sections
      if (csvSection) csvSection.classList.toggle('d-none', source !== 'csv');
      if (contactsSection) contactsSection.classList.toggle('d-none', source !== 'contacts');
      if (groupSection) groupSection.classList.toggle('d-none', source !== 'group');
      
      // Load data when switching tabs
      if (source === 'contacts') {
        loadContactsForSelector();
      } else if (source === 'group') {
        loadGroupsForSelector();
      }
    });
  });

  console.log('🎛️ Tab event listeners attached');

  // Select All button
  const selectAllBtn = document.getElementById('selectAllContactsBtn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('#contactsList input[type="checkbox"]');
      checkboxes.forEach(cb => {
        cb.checked = true;
        const id = cb.value;
        if (!selectedContactIds.includes(id)) selectedContactIds.push(id);
      });
      updateSelectedCount();
    });
  }

  // Clear button
  const clearBtn = document.getElementById('clearSelectedContactsBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('#contactsList input[type="checkbox"]');
      checkboxes.forEach(cb => cb.checked = false);
      selectedContactIds = [];
      updateSelectedCount();
    });
  }

  // Search in contacts
  const searchInput = document.getElementById('contactSelectorSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      filterContactsList(query);
    });
  }

  // Group select change
  const groupSelect = document.getElementById('groupSelect');
  if (groupSelect) {
    groupSelect.addEventListener('change', () => {
      const group = groupSelect.value;
      if (group) {
        loadGroupContactCount(group);
      } else {
        const countText = document.getElementById('groupContactsCountText');
        if (countText) countText.textContent = 'Selecciona un grupo para ver los contactos';
      }
    });
  }
}

async function loadContactsForSelector() {
  console.log('📋 loadContactsForSelector: iniciando...');
  const contactsList = document.getElementById('contactsList');
  const totalCountEl = document.getElementById('totalContactsCount');
  console.log('📋 Elements found:', { contactsList: !!contactsList, totalCountEl: !!totalCountEl });
  
  if (!contactsList) {
    console.warn('📋 contactsList element not found!');
    return;
  }

  contactsList.innerHTML = `
    <div class="loading-contacts">
      <div class="spinner-small"></div>
      <span>Cargando contactos...</span>
    </div>
  `;

  try {
    console.log('📋 Fetching /contacts?pageSize=500...');
    const res = await authFetch('/contacts?pageSize=500');
    const data = await res.json();
    console.log('📋 API response:', data);
    
    selectorContactsCache = data.items || [];
    console.log('📋 Contacts cached:', selectorContactsCache.length);
    
    // Update total count
    if (totalCountEl) {
      totalCountEl.textContent = selectorContactsCache.length;
      console.log('📋 Updated totalContactsCount to:', selectorContactsCache.length);
    }
    
    renderContactsSelector(selectorContactsCache);
  } catch (error) {
    console.error('📋 Error loading contacts for selector:', error);
    contactsList.innerHTML = '<div class="text-center text-muted p-3">Error al cargar contactos</div>';
    if (totalCountEl) totalCountEl.textContent = '0';
  }
}

function renderContactsSelector(contacts) {
  const contactsList = document.getElementById('contactsList');
  if (!contactsList) return;

  if (!contacts.length) {
    contactsList.innerHTML = `
      <div class="empty-contacts-message">
        <i class="bi bi-person-plus"></i>
        <p>No hay contactos guardados</p>
        <button type="button" class="btn-add-contacts" onclick="showTab('contacts')">
          <i class="bi bi-plus-lg"></i> Agregar contactos
        </button>
      </div>
    `;
    return;
  }

  contactsList.innerHTML = contacts.map(c => `
    <label class="contact-checkbox-item">
      <input type="checkbox" value="${c.id}" ${selectedContactIds.includes(c.id) ? 'checked' : ''}>
      <div class="contact-info">
        <div class="contact-name">${c.nombre || 'Sin nombre'}</div>
        <div class="contact-phone">${c.phone}</div>
        ${c.grupo ? `<div class="contact-group"><i class="bi bi-tag"></i> ${c.grupo}</div>` : ''}
      </div>
    </label>
  `).join('');

  // Add event listeners
  contactsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.value;
      if (cb.checked) {
        if (!selectedContactIds.includes(id)) selectedContactIds.push(id);
      } else {
        selectedContactIds = selectedContactIds.filter(x => x !== id);
      }
      updateSelectedCount();
    });
  });
}

function filterContactsList(query) {
  const filtered = selectorContactsCache.filter(c => {
    const name = (c.nombre || '').toLowerCase();
    const phone = (c.phone || '').toLowerCase();
    return name.includes(query) || phone.includes(query);
  });
  renderContactsSelector(filtered);
}

function updateSelectedCount() {
  const countEl = document.getElementById('selectedContactsCount');
  if (countEl) countEl.textContent = selectedContactIds.length;
}

async function loadGroupsForSelector() {
  const groupSelect = document.getElementById('groupSelect');
  if (!groupSelect) return;

  groupSelect.innerHTML = '<option value="">-- Cargando grupos --</option>';

  try {
    const res = await authFetch('/contacts/groups');
    const data = await res.json();
    const groups = data.groups || [];

    if (!groups.length) {
      groupSelect.innerHTML = '<option value="">-- No hay grupos --</option>';
      return;
    }

    groupSelect.innerHTML = '<option value="">-- Seleccionar grupo --</option>' +
      groups.map(g => `<option value="${g}">${g}</option>`).join('');
  } catch (error) {
    console.error('Error loading groups:', error);
    groupSelect.innerHTML = '<option value="">-- Error al cargar --</option>';
  }
}

async function loadGroupContactCount(group) {
  const countText = document.getElementById('groupContactsCountText');
  if (!countText) return;

  try {
    const res = await authFetch(`/contacts?group=${encodeURIComponent(group)}&pageSize=1`);
    const data = await res.json();
    const total = data.total || 0;
    countText.textContent = `${total} contacto${total === 1 ? '' : 's'} en este grupo`;
  } catch (error) {
    countText.textContent = 'Error al contar';
  }
}

// Get selected contact IDs for form submission
function getSelectedContactIds() {
  return selectedContactIds;
}

/** ======== Theme Management ======== */
function setupThemeToggle() {
  const THEME_KEY = 'ms-theme';
  const root = document.documentElement;
  const switchEl = document.getElementById('themeSwitch');

  // Load saved preference or detect system
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = saved || (prefersDark ? 'dark' : 'light');

  setTheme(initial);

  function setTheme(mode) {
    root.setAttribute('data-theme', mode);
    localStorage.setItem(THEME_KEY, mode);
    if (switchEl) switchEl.checked = (mode === 'dark');
  }

  // Switch listener
  if (switchEl) {
    switchEl.addEventListener('change', () => {
      setTheme(switchEl.checked ? 'dark' : 'light');
    });
  }

  // Auto-adjust if system changes and no saved preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      const current = localStorage.getItem(THEME_KEY);
      if (!current) setTheme(e.matches ? 'dark' : 'light');
    });
  }
}

/** ======== Event Listeners Setup ======== */
function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = btn.getAttribute('data-tab');
      if (tabId) showTab(tabId);
    });
  });

  // QR refresh button
  const refreshBtn = document.getElementById('refreshQrBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshQR);
  }

  // Message form
  const messageForm = document.getElementById('messageForm');
  if (messageForm) {
    messageForm.addEventListener('submit', handleMessageFormSubmit);
  }

  // Export button
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportResults);
  }

  // Cancel button
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      cancelCampaignFrontend();
    });
  }

  const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');
  if (refreshAnalyticsBtn) refreshAnalyticsBtn.addEventListener('click', loadAnalyticsDashboard);

  // Botón refrescar dashboard (nuevo ID)
  const refreshDashboardBtn = document.getElementById('refreshDashboardBtn');
  if (refreshDashboardBtn) refreshDashboardBtn.addEventListener('click', loadAnalyticsDashboard);

  // Botón limpiar caché de usuario
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  if (clearCacheBtn) clearCacheBtn.addEventListener('click', clearUserCache);

  const loadThisMonthBtn = document.getElementById('loadThisMonthBtn');
  if (loadThisMonthBtn) loadThisMonthBtn.addEventListener('click', setAnalyticsToThisMonth);

  const manualContactForm = document.getElementById('manualContactForm');
  if (manualContactForm) manualContactForm.addEventListener('submit', createManualContact);

  const contactsRefreshBtn = document.getElementById('contactsRefreshBtn');
  if (contactsRefreshBtn) contactsRefreshBtn.addEventListener('click', loadContacts);

  const contactsFilterBtn = document.getElementById('contactsFilterBtn');
  if (contactsFilterBtn) contactsFilterBtn.addEventListener('click', loadContacts);

  const contactsTableBody = document.getElementById('contactsTableBody');
  if (contactsTableBody) contactsTableBody.addEventListener('click', handleContactsTableClick);

  // ===== RECIPIENT SOURCE TABS =====
  setupRecipientSourceTabs();

  // Logout button  
  console.log('🔍 Buscando botón de logout...');
  const logoutBtn = document.getElementById('logout-btn');
  console.log('🔍 Estado del botón:', {
    exists: !!logoutBtn,
    visible: logoutBtn?.offsetParent !== null,
    disabled: logoutBtn?.disabled,
    classList: logoutBtn?.classList.toString(),
    parentElement: logoutBtn?.parentElement?.tagName
  });

  if (logoutBtn) {
    console.log('✅ Botón de logout encontrado, configurando event listener...');

    // Remover event listeners previos si existen
    logoutBtn.replaceWith(logoutBtn.cloneNode(true));
    const newLogoutBtn = document.getElementById('logout-btn');

    newLogoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('🖱️ Click en botón de logout detectado');
      console.log('🔍 Event details:', e);
      logoutKeycloak();
    });

    // Agregar también el event listener para debug
    newLogoutBtn.addEventListener('mousedown', () => {
      console.log('👆 Mouse down en botón de logout');
    });

    newLogoutBtn.addEventListener('mouseup', () => {
      console.log('👆 Mouse up en botón de logout');
    });

    console.log('✅ Event listeners configurados en botón de logout');
  } else {
    console.warn('⚠️ Botón de logout no encontrado en el DOM');
    console.log('🔍 Elementos disponibles con ID:',
      Array.from(document.querySelectorAll('[id]')).map(el => el.id)
    );
  }
}

/** ======== Export Functionality ======== */
function exportResults() {
  const tbody = document.getElementById('statusTableBody');
  if (!tbody || tbody.children.length === 0) {
    showAlert('No hay datos para exportar', 'warning', 'Sin datos');
    return;
  }

  const rows = Array.from(tbody.children);
  const csvContent = [
    'Número,Estado,Hora,Respuesta',
    ...rows.map(row => {
      const cells = Array.from(row.children);
      return cells.map(cell => `"${cell.textContent.trim()}"`).join(',');
    })
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `mensaje-resultados-${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showAlert('Resultados exportados exitosamente', 'success', 'Exportación completada');
}

/** ======== Application Initialization ======== */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Iniciando aplicación...');

  // Initialize authentication first
  const authSuccess = await initKeycloak();

  if (!authSuccess) {
    console.error('❌ Falló la inicialización de Keycloak, deteniendo la carga de la aplicación');
    return;
  }

  console.log('✅ Keycloak inicializado correctamente, continuando con la aplicación...');

  // Setup all event listeners
  setupEventListeners();

  // Setup form handlers
  setupMessageTypeHandlers();
  setupFileInputHandlers();
  setupMessageTextarea();
  setupVariablesSystem();
  setupEmojiPicker();
  setupTemplateCountSelector(); // Initialize templates system

  // Setup theme toggle
  setupThemeToggle();
  ensureAnalyticsDateDefaults();
  setupDatePresets();
  loadAnalyticsDashboard();
  loadHeroTodayStats();
  loadTotalContacts();
  setInterval(loadHeroTodayStats, 60000);
  setInterval(loadTotalContacts, 120000);

  // Initially disable send tab until WhatsApp is connected
  const sendTabBtn = document.querySelector('[data-tab="send"]');
  if (sendTabBtn) {
    sendTabBtn.classList.add('disabled');
  }

  // Start status checking ONLY after successful authentication
  console.log('🔄 Iniciando verificación de estado...');
  startStatusCheck();

  // Initialize tab from hash
  const hash = window.location.hash.substring(1);
  if (hash && ['link', 'send', 'analytics'].includes(hash)) {
    showTab(hash);
  } else {
    showTab('link');
  }

  console.log('🚀 Monchito WA initialized successfully');
});

// Global functions for HTML onclick handlers
window.showTab = showTab;
window.refreshQR = refreshQR;

/** ======== Variables System ======== */
let variablesSystemInitialized = false;

function setupVariablesSystem() {
  // Evitar inicialización múltiple
  if (variablesSystemInitialized) {
    return;
  }

  const variablesHelper = document.getElementById('variablesHelper');
  if (!variablesHelper) {
    return;
  }

  // Marcar como inicializado
  variablesSystemInitialized = true;

  // Insert variables into current active template
  const variableBtns = variablesHelper.querySelectorAll('.variable-btn');
  variableBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const variable = btn.getAttribute('data-variable');
      const textarea = document.getElementById(`template${currentActiveTemplate}`);

      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;

      // Insert variable at cursor position
      const newText = text.substring(0, start) + variable + text.substring(end);
      textarea.value = newText;

      // Update character count
      updateTemplateCharCount(currentActiveTemplate);

      // Set cursor position after inserted variable
      const newCursorPos = start + variable.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();

      // Hide helper after insertion
      variablesHelper.classList.add('d-none');
    });
  });

  // Hide helper when clicking outside
  document.addEventListener('click', (e) => {
    const isVariableBtn = e.target.closest('.btn-template-variables');
    const isHelper = variablesHelper.contains(e.target);
    if (!isVariableBtn && !isHelper) {
      variablesHelper.classList.add('d-none');
    }
  });
}
