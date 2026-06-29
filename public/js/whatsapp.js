/**
 * WhatsApp - Connection and QR Management
 */

let statusPollingInterval = null;
let isConnected = false;
let hasQRDisplayed = false;
let qrRefreshTimer = null; // Auto-resets hasQRDisplayed so QR never stays stale
let currentQrObjectUrl = null;

// Format phone number for display using country-aware formatter from core.js
function formatPhoneDisplay(phone) {
  if (typeof formatPhoneForDisplay === 'function') {
    return formatPhoneForDisplay(phone);
  }
  // Fallback: just prefix with +
  if (!phone) return '';
  return '+' + String(phone).replace(/\D/g, '');
}

// Check WhatsApp status
async function checkWhatsAppStatus() {
  try {
    const res = await authFetch('/connection-status');
    if (!res.ok) throw new Error('Status check failed');
    
    const data = await res.json();
    updateConnectionStatus(data);
    return data;
  } catch (error) {
    console.error('Error checking status:', error);
    updateConnectionStatus({ status: 'error' });
    return null;
  }
}

// Update connection status UI
function updateConnectionStatus(data) {
  const statusEl = document.getElementById('connection-status');
  const statusDot = statusEl?.querySelector('.status-dot');
  const statusText = statusEl?.querySelector('.status-text');

  const qrContainer = document.getElementById('qr-container');
  const authenticatedMsg = document.getElementById('authenticated-message');
  const phoneTakenMsg = document.getElementById('phone-taken-message');
  const sendTab = document.querySelector('[data-tab="send"]');

  const status = data?.status || 'disconnected';
  const state = data?.state || status;
  const wasConnected = isConnected;
  isConnected = status === 'connected' || status === 'authenticated';

  // Si pasó de conectado a desconectado, resetear QR para cargar uno nuevo
  if (wasConnected && !isConnected) {
    hasQRDisplayed = false;
    if (qrRefreshTimer) { clearTimeout(qrRefreshTimer); qrRefreshTimer = null; }
  }
  // Si se conectó, ya no necesitamos el QR
  if (isConnected) {
    hasQRDisplayed = false;
    if (qrRefreshTimer) { clearTimeout(qrRefreshTimer); qrRefreshTimer = null; }
    // Refresh profile to get the newly linked phone
    if (typeof loadUserProfile === 'function') {
      loadUserProfile();
    }
  }

  // Update status badge
  if (statusEl) {
    statusEl.classList.remove('connected', 'disconnected', 'connecting');
    if (isConnected) {
      statusEl.classList.add('connected');
    } else if (status === 'connecting') {
      statusEl.classList.add('connecting');
    } else {
      statusEl.classList.add('disconnected');
    }
  }

  // Update status text
  if (statusText) {
    const texts = {
      connected: 'Conectado',
      authenticated: 'Conectado',
      connecting: 'Conectando...',
      disconnected: 'Desconectado',
      phone_taken: 'Numero en uso',
      error: 'Error'
    };
    statusText.textContent = texts[state] || texts[status] || 'Desconectado';
  }

  // Handle phone_taken error
  if (phoneTakenMsg) {
    if (state === 'phone_taken' || data?.phoneTakenError) {
      phoneTakenMsg.classList.remove('d-none');
      var phoneTakenText = phoneTakenMsg.querySelector('.phone-taken-text');
      if (phoneTakenText) {
        phoneTakenText.textContent = data.phoneTakenError || 'Este numero ya esta asociado a otro usuario.';
      }
    } else {
      phoneTakenMsg.classList.add('d-none');
    }
  }

  // Toggle QR / Connected message / Phone taken
  if (qrContainer && authenticatedMsg) {
    if (state === 'phone_taken' || data?.phoneTakenError) {
      qrContainer.classList.add('d-none');
      authenticatedMsg.classList.add('d-none');
    } else if (isConnected) {
      qrContainer.classList.add('d-none');
      authenticatedMsg.classList.remove('d-none');

      // Update user info — prefer whatsappPhone from profile, fallback to userInfo
      var phoneNumber = data.whatsappPhone || (data.userInfo && data.userInfo.phoneNumber) || '';
      var pushname = (data.userInfo && data.userInfo.pushname) || '';

      var nicknameEl = document.getElementById('wa-user-nickname');
      var phoneEl = document.getElementById('wa-user-phone');
      if (nicknameEl) nicknameEl.textContent = pushname || 'Usuario';
      if (phoneEl) phoneEl.textContent = phoneNumber ? formatPhoneDisplay(phoneNumber) : '--';
    } else {
      qrContainer.classList.remove('d-none');
      authenticatedMsg.classList.add('d-none');
    }
  }

  // Enable/disable send tab
  if (sendTab) {
    if (isConnected) {
      sendTab.classList.remove('disabled');
    } else {
      sendTab.classList.add('disabled');
    }
  }
}

// Schedule auto-refresh before the server-side QR expires (~20s for rotations)
function scheduleQrRefresh() {
  if (qrRefreshTimer) clearTimeout(qrRefreshTimer);
  qrRefreshTimer = setTimeout(() => {
    hasQRDisplayed = false;
    qrRefreshTimer = null;
    loadQR();
  }, 18000);
}

// Load QR Code
async function loadQR() {
  const qrImage = document.getElementById('qrImage');
  if (!qrImage) return;

  if (hasQRDisplayed) return;

  try {
    const res = await authFetch('/qr?_=' + Date.now(), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    if (!res.ok) {
      if (res.status === 204 || res.status === 400) {
        hasQRDisplayed = false;
        checkWhatsAppStatus();
        return;
      }
      throw new Error('QR fetch failed');
    }

    // Backend returns image/png directly
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('image/')) {
      const blob = await res.blob();
      const imageUrl = URL.createObjectURL(blob);

      // Cleanup old blob URL
      if (currentQrObjectUrl) {
        URL.revokeObjectURL(currentQrObjectUrl);
      }

      currentQrObjectUrl = imageUrl;
      qrImage.src = imageUrl;
      qrImage.style.display = 'block';
      hasQRDisplayed = true;
      scheduleQrRefresh();
    } else {
      // Fallback for JSON response
      const data = await res.json();
      if (data.qr) {
        qrImage.src = data.qr;
        qrImage.style.display = 'block';
        hasQRDisplayed = true;
        scheduleQrRefresh();
      }
    }
  } catch (error) {
    console.error('Error loading QR:', error);
  }
}

// Refresh QR (botón manual — resetea flag para forzar nueva carga)
async function refreshQR() {
  const btn = document.getElementById('refreshQrBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i> Cargando...';
  }

  if (qrRefreshTimer) { clearTimeout(qrRefreshTimer); qrRefreshTimer = null; }
  hasQRDisplayed = false;
  try {
    const refreshRes = await authFetch('/refresh-qr', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    if (!refreshRes.ok && refreshRes.status !== 429) {
      showAlert('No se pudo generar un QR nuevo. Intentá de nuevo.', 'warning');
    }
  } catch (error) {
    console.error('Error refreshing QR:', error);
    showAlert('Error al refrescar QR', 'danger');
  }
  await loadQR();

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refrescar código';
  }
}

// Clear Redis Session
async function clearRedisSession() {
  try {
    const res = await authFetch('/refresh-qr', { method: 'POST' });
    if (res.ok) {
      showAlert('QR refrescado. Puede escanear nuevamente.', 'success');
      hasQRDisplayed = false;
      setTimeout(loadQR, 1000);
    } else {
      showAlert('Error al refrescar QR', 'warning');
    }
  } catch (error) {
    showAlert('Error al refrescar QR', 'danger');
  }
}

// Start status polling
function startStatusPolling() {
  checkWhatsAppStatus();
  loadQR();
  
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
  }
  
  statusPollingInterval = setInterval(() => {
    checkWhatsAppStatus();
    if (!isConnected) {
      loadQR();
    }
  }, 5000);
}

// Stop status polling
function stopStatusPolling() {
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
  }
}

// Initialize WhatsApp module
function initWhatsApp() {
  startStatusPolling();
  
  // Setup refresh button
  const refreshBtn = document.getElementById('refreshQrBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshQR);
  }
  
  // Setup clear cache button
  const clearBtn = document.getElementById('clearRedisBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearRedisSession);
  }

  // Setup disconnect button
  const disconnectBtn = document.getElementById('disconnectWaBtn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async function() {
      if (!confirm('¿Desconectar WhatsApp? Tendras que escanear el QR nuevamente.')) return;
      disconnectBtn.disabled = true;
      try {
        await clearRedisSession();
      } finally {
        disconnectBtn.disabled = false;
      }
    });
  }
}

// Global exports
window.refreshQR = refreshQR;
window.clearRedisSession = clearRedisSession;
window.initWhatsApp = initWhatsApp;
window.isWhatsAppConnected = () => isConnected;
window.loadQR = loadQR;

// Expose hasQRDisplayed via getter/setter so inline onclick can modify it
Object.defineProperty(window, 'hasQRDisplayed', {
  get: function() { return hasQRDisplayed; },
  set: function(val) { hasQRDisplayed = val; }
});
