/**
 * API Tab - API Key management and documentation hub
 */

var apiKeyLoaded = false;

function initApi() {
  var generateBtn = document.getElementById('generateApiKeyBtn');
  var revokeBtn = document.getElementById('revokeApiKeyBtn');
  var copyBtn = document.getElementById('copyApiKeyBtn');

  if (generateBtn) {
    generateBtn.addEventListener('click', generateApiKey);
  }
  if (revokeBtn) {
    revokeBtn.addEventListener('click', revokeApiKey);
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      var keyEl = document.getElementById('api-key-value');
      if (keyEl && keyEl.textContent) {
        navigator.clipboard.writeText(keyEl.textContent).then(function() {
          showAlert('API Key copiada al portapapeles', 'success');
        }).catch(function() {
          // Fallback
          var range = document.createRange();
          range.selectNodeContents(keyEl);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          showAlert('Seleccionada. Usa Ctrl+C para copiar.', 'info');
        });
      }
    });
  }
}

function loadApi() {
  checkApiPlanAccess();
  loadApiKey();
}

function checkApiPlanAccess() {
  var gateEl = document.getElementById('api-plan-gate');
  var contentEl = document.getElementById('api-content');

  if (gateEl) gateEl.classList.add('d-none');
  if (contentEl) contentEl.classList.remove('d-none');
}

function loadApiKey() {
  authFetch('/user/api-key')
    .then(function(res) {
      if (!res || !res.ok) return null;
      return res.json();
    })
    .then(function(data) {
      if (!data) return;
      apiKeyLoaded = true;
      renderApiKey(data.apiKey);
    })
    .catch(function(err) {
      console.error('Failed to load API key:', err);
    });
}

function renderApiKey(apiKey) {
  var displayEl = document.getElementById('api-key-display');
  var emptyEl = document.getElementById('api-key-empty');
  var valueEl = document.getElementById('api-key-value');
  var revokeBtn = document.getElementById('revokeApiKeyBtn');
  var generateBtn = document.getElementById('generateApiKeyBtn');

  if (apiKey) {
    if (displayEl) displayEl.classList.remove('d-none');
    if (emptyEl) emptyEl.classList.add('d-none');
    if (valueEl) valueEl.textContent = apiKey;
    if (revokeBtn) revokeBtn.classList.remove('d-none');
    if (generateBtn) generateBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Regenerar API Key';
  } else {
    if (displayEl) displayEl.classList.add('d-none');
    if (emptyEl) emptyEl.classList.remove('d-none');
    if (revokeBtn) revokeBtn.classList.add('d-none');
    if (generateBtn) generateBtn.innerHTML = '<i class="bi bi-plus-circle"></i> Generar API Key';
  }
}

function generateApiKey() {
  var btn = document.getElementById('generateApiKeyBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Generando...';
  }

  authFetch('/user/api-key', {
    method: 'POST',
    body: JSON.stringify({})
  })
    .then(function(res) {
      if (!res || !res.ok) {
        return res.json().then(function(data) {
          throw new Error(data.error || 'Error generating API key');
        });
      }
      return res.json();
    })
    .then(function(data) {
      renderApiKey(data.apiKey);
      showAlert('API Key generada exitosamente. Guardala en un lugar seguro.', 'success');
    })
    .catch(function(err) {
      showAlert(err.message || 'Error al generar API Key', 'danger');
    })
    .finally(function() {
      if (btn) {
        btn.disabled = false;
        // Text will be set by renderApiKey
      }
    });
}

function revokeApiKey() {
  if (!confirm('Estas seguro? Se revocara tu API Key actual y los tokens existentes dejaran de funcionar.')) {
    return;
  }

  var btn = document.getElementById('revokeApiKeyBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Revocando...';
  }

  authFetch('/user/api-key', {
    method: 'DELETE'
  })
    .then(function(res) {
      if (!res || !res.ok) {
        throw new Error('Error revoking API key');
      }
      return res.json();
    })
    .then(function() {
      renderApiKey(null);
      showAlert('API Key revocada exitosamente.', 'success');
    })
    .catch(function(err) {
      showAlert(err.message || 'Error al revocar API Key', 'danger');
    })
    .finally(function() {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-trash3"></i> Revocar';
      }
    });
}

window.initApi = initApi;
window.loadApi = loadApi;
