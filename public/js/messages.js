/**
 * Messages - Send Messages Functionality (Redesigned)
 */

let currentJobId = null;
let progressPollingInterval = null;

// Emoji data
const emojiCategories = {
  smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'],
  people: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄'],
  nature: ['🌱', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🍄', '🌺', '🌻', '🌼', '🌷', '🌹', '🥀', '💐', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴'],
  food: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕'],
  activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '⛳', '🧘'],
  travel: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '💺', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢'],
  objects: ['💡', '🔦', '🏮', '🪔', '📱', '📲', '💻', '🖥️', '🖨️', '⌨️', '🖱️', '🖲️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💰', '🪙', '💵', '💴', '💶', '💷', '💸', '💳'],
  symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳'],
  flags: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇦🇷', '🇧🇷', '🇨🇱', '🇨🇴', '🇪🇨', '🇪🇸', '🇲🇽', '🇵🇪', '🇵🇾', '🇺🇾', '🇻🇪', '🇺🇸', '🇬🇧', '🇫🇷', '🇩🇪', '🇮🇹', '🇯🇵', '🇰🇷', '🇨🇳']
};

// Track extra template count
let extraTemplateCount = 0;
const MAX_EXTRA_TEMPLATES = 4;

// Message interval state
let availableIntervals = [];
let selectedInterval = 5;

// ========== Setup: Message Form ==========
function setupMessageForm() {
  const form = document.getElementById('messageForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!window.isWhatsAppConnected || !window.isWhatsAppConnected()) {
      showAlert('Primero debes conectar WhatsApp', 'warning');
      return;
    }

    await sendMessages();
  });
}

// ========== Setup: Interval Selector ==========
async function loadIntervals() {
  try {
    var res = await authFetch('/config/intervals');
    if (!res.ok) return;
    var data = await res.json();
    availableIntervals = data.intervals || [];
    selectedInterval = data.defaultInterval || 5;
    renderIntervalPills();
  } catch (e) {
    // Fallback: render default intervals without server data
    availableIntervals = [
      { value: 3,  label: 'Rapido (3s)', badge: '\u26A0\uFE0F', color: 'warning', restricted: false, available: true },
      { value: 5,  label: 'Normal (5s)', badge: '\u2713', color: 'success', restricted: false, available: true, default: true },
      { value: 8,  label: 'Seguro (8s)', badge: '\u2713\u2713', color: 'info', restricted: false, available: true },
      { value: 12, label: 'Muy seguro (12s)', badge: '\u2713\u2713\u2713', color: 'info', restricted: false, available: true },
      { value: 15, label: 'Ultra seguro (15s)', badge: '', color: 'secondary', restricted: false, available: true },
    ];
    selectedInterval = 5;
    renderIntervalPills();
  }
}

function renderIntervalPills() {
  var container = document.getElementById('intervalSelector');
  if (!container) return;
  container.innerHTML = '';

  availableIntervals.forEach(function(opt) {
    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'interval-pill';
    pill.dataset.value = opt.value;

    // Color class
    pill.classList.add('interval-' + opt.color);

    // Selected state
    if (opt.value === selectedInterval) {
      pill.classList.add('active');
    }

    // Disabled state for restricted options
    if (!opt.available) {
      pill.classList.add('disabled');
      pill.disabled = true;
    }

    // Build pill content
    var labelText = opt.label;
    if (opt.default) {
      labelText += ' <span class="interval-recommended">Recomendado</span>';
    }
    if (!opt.available && opt.restricted) {
      pill.innerHTML = '<i class="bi bi-lock-fill"></i> ' + labelText;
      pill.title = 'No disponible';
    } else {
      pill.innerHTML = labelText;
    }

    pill.addEventListener('click', function() {
      if (!opt.available) return;
      selectInterval(opt.value);
    });

    container.appendChild(pill);
  });
}

function selectInterval(value) {
  selectedInterval = value;
  var hidden = document.getElementById('messageInterval');
  if (hidden) hidden.value = value;

  // Update active states
  var pills = document.querySelectorAll('.interval-pill');
  pills.forEach(function(p) {
    p.classList.toggle('active', Number(p.dataset.value) === value);
  });

  // Show/hide warning for fast interval
  var warning = document.getElementById('intervalWarning');
  if (warning) {
    if (value === 3) {
      warning.classList.remove('d-none');
    } else {
      warning.classList.add('d-none');
    }
  }
}

// ========== Setup: Media Chips ==========
function setupMediaChips() {
  const chips = document.querySelectorAll('.media-chip');
  const hiddenInput = document.getElementById('messageTypeHidden');
  const sections = {
    single: document.getElementById('singleImageSection'),
    multiple: document.getElementById('multipleImagesSection'),
    audio: document.getElementById('audioSection')
  };

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const media = chip.dataset.media;
      const isActive = chip.classList.contains('active');

      // Deactivate all chips and hide all sections
      chips.forEach(c => c.classList.remove('active'));
      Object.values(sections).forEach(s => s?.classList.add('d-none'));

      const textarea1 = document.getElementById('message1');
      if (isActive) {
        // Toggle off
        if (hiddenInput) hiddenInput.value = 'none';
        if (textarea1) textarea1.required = true;
      } else {
        // Activate this chip
        chip.classList.add('active');
        if (hiddenInput) hiddenInput.value = media;
        if (sections[media]) sections[media].classList.remove('d-none');
        if (textarea1) textarea1.required = (media !== 'audio');
      }
    });
  });

  // Clear buttons
  document.querySelectorAll('.media-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.clear;
      // Reset file input
      const inputMap = { single: 'singleImage', multiple: 'images', audio: 'audioFile' };
      const infoMap = { single: 'singleImageInfo', multiple: 'multipleImagesInfo', audio: 'audioFileInfo' };
      const input = document.getElementById(inputMap[type]);
      const info = document.getElementById(infoMap[type]);
      if (input) input.value = '';
      if (info) { info.innerHTML = ''; info.classList.remove('has-file'); }

      // Deactivate chip
      chips.forEach(c => c.classList.remove('active'));
      Object.values(sections).forEach(s => s?.classList.add('d-none'));
      if (hiddenInput) hiddenInput.value = 'none';
    });
  });
}

// ========== Setup: File Inputs ==========
function setupFileInputs() {
  // CSV is handled by setupCsvDropZone, only media inputs here
  const inputs = [
    { id: 'singleImage', infoId: 'singleImageInfo' },
    { id: 'images', infoId: 'multipleImagesInfo' },
    { id: 'audioFile', infoId: 'audioFileInfo' }
  ];

  inputs.forEach(({ id, infoId }) => {
    const input = document.getElementById(id);
    const info = document.getElementById(infoId);
    if (!input || !info) return;

    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        const files = Array.from(input.files);
        const names = files.map(f => f.name).join(', ');
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        info.innerHTML = '<i class="bi bi-file-earmark-check"></i> ' + names + ' (' + formatFileSize(totalSize) + ')';
        info.classList.add('has-file');
      } else {
        info.innerHTML = '';
        info.classList.remove('has-file');
      }
    });
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ========== Setup: Templates (Main + Advanced) ==========
function setupTemplates() {
  const container = document.getElementById('templatesContainer');
  if (!container) return;

  // Render the primary template (always visible)
  renderSingleTemplate(container, 1, true);
}

function renderSingleTemplate(container, num, required) {
  const badgeClass = 'template-badge-' + num;
  const template = document.createElement('div');
  template.className = 'template-item';
  template.dataset.templateNum = num;
  template.innerHTML =
    '<div class="template-header">' +
      '<span class="template-badge ' + badgeClass + '">Mensaje ' + num + '</span>' +
      '<div class="template-toolbar">' +
        '<button type="button" class="btn-emoji" data-template="' + num + '" title="Emojis"><i class="bi bi-emoji-smile"></i></button>' +
        '<button type="button" class="btn-preview-template" data-template="' + num + '" title="Vista previa"><i class="bi bi-eye"></i></button>' +
      '</div>' +
    '</div>' +
    '<div class="variable-chips">' +
      '<button type="button" class="variable-chip" data-template="' + num + '" data-variable="{nombre}" title="Insertar nombre"><i class="bi bi-person"></i> {nombre}</button>' +
      '<button type="button" class="variable-chip" data-template="' + num + '" data-variable="{tratamiento}" title="Insertar tratamiento"><i class="bi bi-award"></i> {tratamiento}</button>' +
      '<button type="button" class="variable-chip" data-template="' + num + '" data-variable="{grupo}" title="Insertar grupo"><i class="bi bi-people"></i> {grupo}</button>' +
    '</div>' +
    '<textarea class="form-control message-textarea" id="message' + num + '" name="message' + num + '" rows="3" placeholder="Escribe tu mensaje aqui... Usa {nombre} para personalizar" ' + (required ? 'required' : '') + '></textarea>' +
    '<div class="char-count"><span id="charCount' + num + '">0</span> caracteres</div>';

  container.appendChild(template);

  // Char counter
  var textarea = template.querySelector('#message' + num);
  var counter = template.querySelector('#charCount' + num);
  textarea.addEventListener('input', function() {
    counter.textContent = textarea.value.length;
  });
}

// ========== Setup: Advanced Templates ==========
function setupAdvancedTemplates() {
  var toggle = document.getElementById('advancedTemplatesToggle');
  var section = document.getElementById('advancedTemplatesSection');
  var addBtn = document.getElementById('addExtraTemplateBtn');
  var templateCountInput = document.getElementById('templateCount');

  if (!toggle || !section) return;

  toggle.addEventListener('click', function() {
    var isOpen = !section.classList.contains('d-none');
    section.classList.toggle('d-none', isOpen);
    toggle.classList.toggle('open', !isOpen);
  });

  if (addBtn) {
    addBtn.addEventListener('click', function() {
      if (extraTemplateCount >= MAX_EXTRA_TEMPLATES) {
        showAlert('Maximo ' + (MAX_EXTRA_TEMPLATES + 1) + ' mensajes permitidos', 'warning');
        return;
      }
      extraTemplateCount++;
      var num = extraTemplateCount + 1; // 2, 3, 4, 5
      var container = document.getElementById('extraTemplatesContainer');
      renderSingleTemplate(container, num, false);

      // Add remove button to the new template
      var item = container.querySelector('[data-template-num="' + num + '"]');
      if (item) {
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'extra-template-remove';
        removeBtn.innerHTML = '<i class="bi bi-trash"></i>';
        removeBtn.title = 'Eliminar mensaje ' + num;
        removeBtn.addEventListener('click', function() {
          item.remove();
          recalcExtraTemplates();
        });
        item.querySelector('.template-header').appendChild(removeBtn);
      }

      if (templateCountInput) templateCountInput.value = extraTemplateCount + 1;

      if (extraTemplateCount >= MAX_EXTRA_TEMPLATES) {
        addBtn.classList.add('d-none');
      }
    });
  }
}

function recalcExtraTemplates() {
  var container = document.getElementById('extraTemplatesContainer');
  var addBtn = document.getElementById('addExtraTemplateBtn');
  var templateCountInput = document.getElementById('templateCount');
  if (!container) return;

  // Re-number remaining extra templates
  var items = container.querySelectorAll('.template-item');
  extraTemplateCount = items.length;

  items.forEach(function(item, idx) {
    var num = idx + 2;
    item.dataset.templateNum = num;
    var badge = item.querySelector('.template-badge');
    if (badge) {
      badge.className = 'template-badge template-badge-' + num;
      badge.textContent = 'Mensaje ' + num;
    }
    var textarea = item.querySelector('textarea');
    if (textarea) {
      textarea.id = 'message' + num;
      textarea.name = 'message' + num;
    }
    // Update variable chip data-template attrs
    item.querySelectorAll('[data-template]').forEach(function(el) {
      el.dataset.template = num;
    });
    var counter = item.querySelector('.char-count span');
    if (counter) counter.id = 'charCount' + num;
  });

  if (templateCountInput) templateCountInput.value = extraTemplateCount + 1;
  if (addBtn) addBtn.classList.toggle('d-none', extraTemplateCount >= MAX_EXTRA_TEMPLATES);
}

// ========== Setup: Saved Template Dropdown ==========
function setupSavedTemplateDropdown() {
  var select = document.getElementById('savedTemplateSelect');
  if (!select) return;

  // Try to load templates from API
  loadSavedTemplates();

  select.addEventListener('change', function() {
    var val = select.value;
    if (!val) return;

    var textarea = document.getElementById('message1');
    if (textarea) {
      textarea.value = val;
      textarea.dispatchEvent(new Event('input'));
    }
    // Reset selection
    select.selectedIndex = 0;
  });
}

async function loadSavedTemplates() {
  var select = document.getElementById('savedTemplateSelect');
  if (!select) return;

  try {
    var res = await authFetch('/templates');
    if (!res || !res.ok) {
      // No templates endpoint — hide the dropdown
      var wrapper = document.querySelector('.template-dropdown-wrapper');
      var divider = document.querySelector('.send-divider');
      if (wrapper) wrapper.classList.add('d-none');
      if (divider) divider.classList.add('d-none');
      return;
    }

    var data = await res.json();
    var templates = data.templates || data || [];

    if (!Array.isArray(templates) || templates.length === 0) {
      var wrapper2 = document.querySelector('.template-dropdown-wrapper');
      var divider2 = document.querySelector('.send-divider');
      if (wrapper2) wrapper2.classList.add('d-none');
      if (divider2) divider2.classList.add('d-none');
      return;
    }

    templates.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.content || t.text || t.message || '';
      opt.textContent = t.name || t.title || (opt.value.substring(0, 50) + '...');
      select.appendChild(opt);
    });
  } catch (e) {
    // Templates endpoint not available — hide dropdown silently
    var wrapper3 = document.querySelector('.template-dropdown-wrapper');
    var divider3 = document.querySelector('.send-divider');
    if (wrapper3) wrapper3.classList.add('d-none');
    if (divider3) divider3.classList.add('d-none');
  }
}

// ========== Setup: Emoji Picker ==========
function setupEmojiPicker() {
  let activePickerTemplate = null;

  function createFloatingPicker(templateNum) {
    document.querySelectorAll('.emoji-picker-float').forEach(el => el.remove());

    const header = document.querySelector('.btn-emoji[data-template="' + templateNum + '"]')?.closest('.template-header');
    if (!header) return;

    const picker = document.createElement('div');
    picker.className = 'emoji-picker-float';
    picker.innerHTML =
      '<div class="emoji-categories">' +
        Object.keys(emojiCategories).map(function(cat, idx) {
          var icons = { smileys: '😀', people: '👤', nature: '🌱', food: '🍎', activities: '⚽', travel: '🚗', objects: '💡', symbols: '❤️', flags: '🏁' };
          return '<button type="button" class="emoji-category' + (idx === 0 ? ' active' : '') + '" data-category="' + cat + '">' + (icons[cat] || '😀') + '</button>';
        }).join('') +
      '</div>' +
      '<div class="emoji-grid"></div>';
    header.appendChild(picker);
    activePickerTemplate = templateNum;

    var grid = picker.querySelector('.emoji-grid');

    function renderEmojis(category) {
      grid.innerHTML = '';
      var emojis = emojiCategories[category] || emojiCategories.smileys;
      emojis.forEach(function(emoji) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var textarea = document.getElementById('message' + templateNum);
          if (textarea) {
            var pos = textarea.selectionStart;
            var text = textarea.value;
            textarea.value = text.slice(0, pos) + emoji + text.slice(pos);
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = pos + emoji.length;
            textarea.dispatchEvent(new Event('input'));
          }
        });
        grid.appendChild(btn);
      });
    }

    renderEmojis('smileys');

    picker.querySelectorAll('.emoji-category').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        picker.querySelectorAll('.emoji-category').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderEmojis(btn.dataset.category);
      });
    });

    picker.addEventListener('click', function(e) { e.stopPropagation(); });
  }

  document.addEventListener('click', function(e) {
    var emojiBtn = e.target.closest('.btn-emoji');
    if (emojiBtn) {
      e.stopPropagation();
      var templateNum = emojiBtn.dataset.template;
      if (activePickerTemplate === templateNum) {
        document.querySelectorAll('.emoji-picker-float').forEach(function(el) { el.remove(); });
        activePickerTemplate = null;
      } else {
        createFloatingPicker(templateNum);
      }
      return;
    }

    if (!e.target.closest('.emoji-picker-float')) {
      document.querySelectorAll('.emoji-picker-float').forEach(function(el) { el.remove(); });
      activePickerTemplate = null;
    }
  });
}

// ========== Setup: Variables ==========
function setupVariables() {
  document.addEventListener('click', function(e) {
    var chip = e.target.closest('.variable-chip');
    if (!chip) return;

    var templateNum = chip.dataset.template;
    var variable = chip.dataset.variable;
    var textarea = document.getElementById('message' + templateNum);
    if (!textarea) return;

    var pos = textarea.selectionStart;
    var text = textarea.value;
    textarea.value = text.slice(0, pos) + variable + text.slice(pos);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = pos + variable.length;
    textarea.dispatchEvent(new Event('input'));
  });
}

// ========== Send Messages ==========
async function sendMessages() {
  var form = document.getElementById('messageForm');
  var submitBtn = document.getElementById('sendMessageBtn');
  var progressSection = document.getElementById('messageStatus');

  if (!form || !submitBtn) return;

  // Block sending if country not confirmed
  var countryConfirmed = localStorage.getItem('countryConfirmed');
  var profileCountry = window.userProfile && window.userProfile.country;
  if (!profileCountry || !countryConfirmed) {
    showAlert('Debes seleccionar tu pais antes de enviar mensajes', 'warning');
    if (typeof showCountryChangeModal === 'function') {
      showCountryChangeModal();
    } else if (typeof showCountrySelectorModal === 'function') {
      showCountrySelectorModal();
    }
    return;
  }

  // Get recipient source
  var recipientSource = document.getElementById('recipientSource')?.value || 'contacts';

  // Validate based on source
  if (recipientSource === 'csv') {
    var csvFile = document.getElementById('csvFile');
    if (!csvFile?.files?.length) {
      showAlert('Debes seleccionar un archivo CSV', 'warning');
      return;
    }
  } else if (recipientSource === 'contacts') {
    if (selectedContactIds.size === 0) {
      showAlert('Debes seleccionar al menos un contacto', 'warning');
      return;
    }
  } else if (recipientSource === 'group') {
    var groupSelect = document.getElementById('groupSelect');
    if (!groupSelect?.value) {
      showAlert('Debes seleccionar un grupo', 'warning');
      return;
    }
  }

  // Collect form data
  var formData = new FormData(form);

  // Set recipient source
  formData.set('recipientSource', recipientSource);

  // Set messageType from hidden input
  var messageType = document.getElementById('messageTypeHidden')?.value || 'none';
  formData.set('messageType', messageType);

  // Add source-specific data
  if (recipientSource === 'contacts') {
    formData.set('contactIds', JSON.stringify(Array.from(selectedContactIds)));
    formData.delete('csvFile');
  } else if (recipientSource === 'group') {
    formData.set('groupName', document.getElementById('groupSelect')?.value || '');
    formData.delete('csvFile');
  }

  // Collect all templates (main + extra)
  var templateCount = parseInt(document.getElementById('templateCount')?.value || 1);
  var templates = [];
  for (var i = 1; i <= templateCount; i++) {
    var msg = document.getElementById('message' + i)?.value || '';
    formData.set('message' + i, msg);
    if (msg.trim()) templates.push(msg.trim());
  }

  if (templates.length === 0 && messageType !== 'audio') {
    showAlert('Debes escribir al menos un mensaje', 'warning');
    return;
  }

  formData.set('templates', JSON.stringify(templates));
  formData.set('message', templates[0]);

  // Include message interval
  formData.set('messageInterval', String(selectedInterval));

  submitBtn.classList.add('loading');
  submitBtn.disabled = true;

  try {
    var res = await authFetch('/send-messages', {
      method: 'POST',
      body: formData
    });

    var data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al enviar');
    }

    currentJobId = data.jobId;

    if (progressSection) {
      progressSection.classList.remove('d-none');
    }

    startProgressPolling();
    showAlert('Envio iniciado correctamente', 'success');

  } catch (error) {
    showAlert(error.message, 'danger', 'Error');
  } finally {
    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
  }
}

// ========== Progress Polling ==========
function startProgressPolling() {
  if (progressPollingInterval) {
    clearInterval(progressPollingInterval);
  }

  progressPollingInterval = setInterval(async function() {
    try {
      var res = await authFetch('/message-status');
      if (!res.ok) return;

      var data = await res.json();
      updateProgress(data);

      if (data.state === 'completed' || data.state === 'failed' || data.completed) {
        clearInterval(progressPollingInterval);
        progressPollingInterval = null;

        if (data.state === 'completed' || data.completed) {
          showAlert('Envio completado', 'success');
        }
      }
    } catch (e) {
      console.error('Error polling progress:', e);
    }
  }, 1000);
}

function updateProgress(data) {
  var total = data.total || 0;
  var sent = data.sent || 0;
  var errors = data.errors || 0;
  var percentage = total > 0 ? Math.round((sent / total) * 100) : 0;

  var els = {
    total: document.getElementById('totalCount'),
    sent: document.getElementById('sentCount'),
    errors: document.getElementById('errorCount'),
    progress: document.querySelector('.progress-fill'),
    percentage: document.querySelector('.progress-percentage')
  };

  if (els.total) els.total.textContent = total;
  if (els.sent) els.sent.textContent = sent;
  if (els.errors) els.errors.textContent = errors;
  if (els.progress) els.progress.style.width = percentage + '%';
  if (els.percentage) els.percentage.textContent = percentage + '%';

  if (data.results && Array.isArray(data.results)) {
    updateResultsTable(data.results);
  }
}

function updateResultsTable(results) {
  var tbody = document.getElementById('statusTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';
  results.slice(-50).reverse().forEach(function(r) {
    var tr = document.createElement('tr');
    var statusClass = r.success ? 'success' : 'danger';
    var statusIcon = r.success ? 'check-circle' : 'x-circle';
    tr.innerHTML =
      '<td><code>' + (r.phone || '') + '</code></td>' +
      '<td><span class="badge bg-' + statusClass + '"><i class="bi bi-' + statusIcon + '"></i> ' + (r.success ? 'Enviado' : 'Error') + '</span></td>' +
      '<td>' + (r.time || '') + '</td>' +
      '<td class="small">' + (r.message || '') + '</td>';
    tbody.appendChild(tr);
  });
}

// ========== Cancel / Export ==========
async function cancelSending() {
  try {
    await authFetch('/cancel-campaign', { method: 'POST' });
    showAlert('Envio cancelado', 'warning');

    if (progressPollingInterval) {
      clearInterval(progressPollingInterval);
    }
  } catch (e) {
    showAlert('Error al cancelar', 'danger');
  }
}

function exportResults() {
  var tbody = document.getElementById('statusTableBody');
  if (!tbody || tbody.children.length === 0) {
    showAlert('No hay datos para exportar', 'warning');
    return;
  }

  var rows = Array.from(tbody.children);
  var csv = [
    'Numero,Estado,Hora,Respuesta',
    ...rows.map(function(row) {
      var cells = Array.from(row.children);
      return cells.map(function(c) { return '"' + c.textContent.trim() + '"'; }).join(',');
    })
  ].join('\n');

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'resultados-' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();

  showAlert('Resultados exportados', 'success');
}

// ========== Recipient Source Selection ==========
let allContactsForSend = [];
let selectedContactIds = new Set();
const contactSelectorState = {
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
  search: ''
};
let contactSelectorSearchTimer = null;
let csvParsedCount = 0;

function setupRecipientSourceTabs() {
  var tabs = document.querySelectorAll('.rp-tab');
  var sourceInput = document.getElementById('recipientSource');
  var sections = {
    csv: document.getElementById('csvSourceSection'),
    contacts: document.getElementById('contactsSourceSection'),
    group: document.getElementById('groupSourceSection')
  };

  if (!tabs.length || !sourceInput) return;

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var source = tab.dataset.source;

      // Update active tab
      tabs.forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');

      // Update hidden input
      sourceInput.value = source;

      // Show/hide sections with animation
      Object.entries(sections).forEach(function(entry) {
        var key = entry[0], section = entry[1];
        if (section) {
          if (key === source) {
            section.classList.remove('d-none');
            // Re-trigger animation
            section.classList.remove('source-section-animate');
            void section.offsetWidth; // force reflow
            section.classList.add('source-section-animate');
          } else {
            section.classList.add('d-none');
          }
        }
      });

      // Load data if needed
      if (source === 'contacts') {
        loadContactsForSelector(1);
      } else if (source === 'group') {
        loadGroupsForSelector();
      }

      updateRecipientBadge();
    });
  });

  // Default: load contacts on init
  loadContactsForSelector(1);

  setupContactsSearch();
  setupContactsSelectAll();
  setupContactSelectorPagination();
  setupCsvDropZone();
  setupCsvFileRemove();
}

function updateRecipientBadge() {
  var badge = document.getElementById('recipientCountBadge');
  if (!badge) return;

  var source = document.getElementById('recipientSource')?.value || 'contacts';
  var count = 0;
  var label = '';

  if (source === 'contacts') {
    count = selectedContactIds.size;
    label = count + ' destinatario' + (count !== 1 ? 's' : '') + ' seleccionado' + (count !== 1 ? 's' : '');
  } else if (source === 'group') {
    var countText = document.getElementById('groupContactsCountText')?.textContent || '';
    var match = countText.match(/(\d+)/);
    if (match) count = parseInt(match[1]);
    label = count + ' contacto' + (count !== 1 ? 's' : '') + ' en grupo';
  } else if (source === 'csv') {
    if (csvParsedCount > 0) {
      count = csvParsedCount;
      label = count + ' numero' + (count !== 1 ? 's' : '') + ' desde CSV';
    } else {
      var csvFile = document.getElementById('csvFile');
      if (csvFile?.files?.length) {
        label = 'CSV cargado';
        count = 1;
      }
    }
  }

  if (count > 0) {
    badge.textContent = label;
    badge.classList.add('has-recipients');
  } else {
    badge.textContent = '0 destinatarios seleccionados';
    badge.classList.remove('has-recipients');
  }
}

// Load contacts for multi-select
async function loadContactsForSelector(page) {
  page = page || 1;
  var container = document.getElementById('contactsList');
  if (!container) return;

  container.innerHTML =
    '<div class="loading-contacts">' +
      '<div class="spinner-small"></div>' +
      '<span>Cargando contactos...</span>' +
    '</div>';

  try {
    var searchInput = document.getElementById('contactSelectorSearch');
    var search = searchInput?.value?.trim() || '';
    var targetPage = Math.max(1, Number(page) || 1);

    var res = await authFetch('/contacts' + buildQuery({
      search: search,
      page: targetPage,
      pageSize: contactSelectorState.pageSize
    }));
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar contactos');

    contactSelectorState.search = search;
    contactSelectorState.total = Number(data.total || 0);
    contactSelectorState.pageSize = Number(data.pageSize || contactSelectorState.pageSize);
    contactSelectorState.totalPages = Math.max(1, Math.ceil(contactSelectorState.total / contactSelectorState.pageSize));
    contactSelectorState.page = Math.min(Math.max(1, Number(data.page || targetPage)), contactSelectorState.totalPages);

    allContactsForSend = data.items || [];

    if (allContactsForSend.length === 0 && contactSelectorState.total > 0 && contactSelectorState.page > 1) {
      return loadContactsForSelector(contactSelectorState.page - 1);
    }

    var totalEl = document.getElementById('totalContactsCount');
    if (totalEl) totalEl.textContent = contactSelectorState.total;
    updateContactSelectorPagination();
    updateSelectedCount();

    // Update search clear button
    var clearBtn = document.getElementById('contactSearchClear');
    if (clearBtn) {
      clearBtn.classList.toggle('d-none', !search);
    }

    if (contactSelectorState.total === 0) {
      container.innerHTML =
        '<div class="no-contacts-message">' +
          '<i class="bi bi-person-x"></i>' +
          '<p>' + (search ? 'Sin resultados para "' + search + '"' : 'No tienes contactos guardados') + '</p>' +
          '<small>' + (search ? 'Intenta con otro termino de busqueda' : 'Ve a la seccion Contactos para agregar o importar') + '</small>' +
        '</div>';
      return;
    }

    renderContactsCheckList(allContactsForSend);
  } catch (error) {
    container.innerHTML = '<div class="no-contacts-message"><i class="bi bi-exclamation-triangle"></i><p>Error al cargar contactos</p></div>';
    console.error('Error loading contacts:', error);
  }
}

function formatPhoneDisplay(phone) {
  if (typeof formatPhoneForDisplay === 'function') {
    return formatPhoneForDisplay(phone);
  }
  if (!phone) return '';
  return '+' + String(phone).replace(/\D/g, '');
}

function renderContactsCheckList(contacts) {
  var container = document.getElementById('contactsList');
  if (!container) return;

  container.innerHTML = '';

  contacts.forEach(function(contact) {
    var isChecked = selectedContactIds.has(contact.id);
    var item = document.createElement('label');
    item.className = 'contact-checkbox-item' + (isChecked ? ' checked' : '');

    var hasName = contact.nombre && contact.nombre !== contact.phone;
    var phoneFormatted = formatPhoneDisplay(contact.phone);

    item.innerHTML =
      '<input type="checkbox" value="' + contact.id + '" ' + (isChecked ? 'checked' : '') + '>' +
      '<div class="contact-info">' +
        '<span class="contact-phone">' + phoneFormatted + '</span>' +
        (hasName ? '<span class="contact-separator">&middot;</span><span class="contact-name">' + contact.nombre + '</span>' : '') +
      '</div>' +
      (contact.grupo ? '<span class="contact-group-badge">' + contact.grupo + '</span>' : '');

    var checkbox = item.querySelector('input');
    checkbox.addEventListener('change', function() {
      if (checkbox.checked) {
        selectedContactIds.add(contact.id);
        item.classList.add('checked');
      } else {
        selectedContactIds.delete(contact.id);
        item.classList.remove('checked');
      }
      updateSelectedCount();
      updateRecipientBadge();
    });

    container.appendChild(item);
  });
}

function updateSelectedCount() {
  var countEl = document.getElementById('selectedContactsCount');
  var pill = countEl?.closest('.selected-count-pill');
  if (countEl) {
    countEl.textContent = selectedContactIds.size;
  }
  if (pill) {
    pill.classList.toggle('has-selection', selectedContactIds.size > 0);
  }
}

function setupContactsSearch() {
  var searchInput = document.getElementById('contactSelectorSearch');
  var clearBtn = document.getElementById('contactSearchClear');
  if (!searchInput) return;

  if (searchInput.dataset.bound === '1') return;
  searchInput.dataset.bound = '1';

  searchInput.addEventListener('input', function() {
    if (contactSelectorSearchTimer) clearTimeout(contactSelectorSearchTimer);
    // Show/hide clear button
    if (clearBtn) clearBtn.classList.toggle('d-none', !searchInput.value);
    contactSelectorSearchTimer = setTimeout(function() {
      loadContactsForSelector(1);
    }, 250);
  });

  // Clear button
  if (clearBtn && clearBtn.dataset.bound !== '1') {
    clearBtn.dataset.bound = '1';
    clearBtn.addEventListener('click', function() {
      searchInput.value = '';
      clearBtn.classList.add('d-none');
      loadContactsForSelector(1);
      searchInput.focus();
    });
  }
}

function setupContactsSelectAll() {
  var selectAllBtn = document.getElementById('selectAllContactsBtn');
  var clearBtn = document.getElementById('clearSelectedContactsBtn');

  if (selectAllBtn && selectAllBtn.dataset.bound !== '1') {
    selectAllBtn.dataset.bound = '1';
    selectAllBtn.addEventListener('click', function() {
      allContactsForSend.forEach(function(c) { selectedContactIds.add(c.id); });
      renderContactsCheckList(allContactsForSend);
      updateSelectedCount();
      updateRecipientBadge();
    });
  }

  if (clearBtn && clearBtn.dataset.bound !== '1') {
    clearBtn.dataset.bound = '1';
    clearBtn.addEventListener('click', function() {
      selectedContactIds.clear();
      renderContactsCheckList(allContactsForSend);
      updateSelectedCount();
      updateRecipientBadge();
    });
  }
}

function setupContactSelectorPagination() {
  var prevBtn = document.getElementById('contactSelectorPrevBtn');
  var nextBtn = document.getElementById('contactSelectorNextBtn');

  if (prevBtn && prevBtn.dataset.bound !== '1') {
    prevBtn.dataset.bound = '1';
    prevBtn.addEventListener('click', function() {
      if (contactSelectorState.page > 1) {
        loadContactsForSelector(contactSelectorState.page - 1);
      }
    });
  }

  if (nextBtn && nextBtn.dataset.bound !== '1') {
    nextBtn.dataset.bound = '1';
    nextBtn.addEventListener('click', function() {
      if (contactSelectorState.page < contactSelectorState.totalPages) {
        loadContactsForSelector(contactSelectorState.page + 1);
      }
    });
  }
}

function updateContactSelectorPagination() {
  var pageInfo = document.getElementById('contactSelectorPageInfo');
  var prevBtn = document.getElementById('contactSelectorPrevBtn');
  var nextBtn = document.getElementById('contactSelectorNextBtn');

  if (pageInfo) {
    pageInfo.textContent = contactSelectorState.page + ' / ' + contactSelectorState.totalPages;
  }
  if (prevBtn) prevBtn.disabled = contactSelectorState.page <= 1;
  if (nextBtn) nextBtn.disabled = contactSelectorState.page >= contactSelectorState.totalPages;
}

// ========== CSV Drop Zone ==========
function setupCsvDropZone() {
  var zone = document.getElementById('csvDropZone');
  var fileInput = document.getElementById('csvFile');
  if (!zone || !fileInput) return;

  // Drag events
  ['dragenter', 'dragover'].forEach(function(evt) {
    zone.addEventListener(evt, function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(function(evt) {
    zone.addEventListener(evt, function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');
    });
  });

  zone.addEventListener('drop', function(e) {
    var files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      fileInput.files = files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  // File change handler
  fileInput.addEventListener('change', function() {
    if (fileInput.files.length > 0) {
      var file = fileInput.files[0];
      handleCsvFileSelected(file);
    }
  });
}

function handleCsvFileSelected(file) {
  var zone = document.getElementById('csvDropZone');
  var content = zone?.querySelector('.csv-drop-content');
  var result = document.getElementById('csvFileInfo');
  var nameEl = document.getElementById('csvFileName');
  var countEl = document.getElementById('csvFileCount');

  if (!zone || !result) return;

  zone.classList.add('has-file');
  if (content) content.style.display = 'none';
  result.classList.remove('d-none');
  if (nameEl) nameEl.textContent = file.name + ' (' + formatFileSize(file.size) + ')';

  // Parse CSV to count valid numbers
  csvParsedCount = 0;
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result || '';
    var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
    // Skip header if present
    var start = 0;
    if (lines.length > 0) {
      var first = lines[0].toLowerCase();
      if (first.indexOf('numero') !== -1 || first.indexOf('phone') !== -1 || first.indexOf('telefono') !== -1) {
        start = 1;
      }
    }
    var validCount = 0;
    for (var i = start; i < lines.length; i++) {
      var cols = lines[i].split(/[,;\t]/);
      var num = (cols[0] || '').replace(/\D/g, '');
      if (num.length >= 8) validCount++;
    }
    csvParsedCount = validCount;
    if (countEl) countEl.textContent = validCount + ' numero' + (validCount !== 1 ? 's' : '') + ' valido' + (validCount !== 1 ? 's' : '');
    updateRecipientBadge();
  };
  reader.readAsText(file);
}

function setupCsvFileRemove() {
  var removeBtn = document.getElementById('csvFileRemove');
  if (!removeBtn) return;

  removeBtn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var fileInput = document.getElementById('csvFile');
    var zone = document.getElementById('csvDropZone');
    var content = zone?.querySelector('.csv-drop-content');
    var result = document.getElementById('csvFileInfo');

    if (fileInput) fileInput.value = '';
    if (zone) zone.classList.remove('has-file');
    if (content) content.style.display = '';
    if (result) result.classList.add('d-none');
    csvParsedCount = 0;
    updateRecipientBadge();
  });
}

// ========== Group Selector ==========
async function loadGroupsForSelector() {
  var select = document.getElementById('groupSelect');
  if (!select) return;

  // Avoid re-binding change listener on repeat loads
  if (select.dataset.loaded === '1') return;

  select.innerHTML = '<option value="">-- Cargando grupos --</option>';

  try {
    var res = await authFetch('/contacts/groups');
    if (!res.ok) throw new Error('Error al cargar grupos');

    var data = await res.json();
    var groups = data.groups || [];

    if (groups.length === 0) {
      select.innerHTML = '<option value="">-- No hay grupos --</option>';
      return;
    }

    // Fetch counts for all groups in parallel
    var countPromises = groups.map(function(g) {
      return authFetch('/contacts' + buildQuery({ group: g, page: 1, pageSize: 1 }))
        .then(function(r) { return r.json(); })
        .then(function(d) { return { name: g, count: Number(d.total || 0) }; })
        .catch(function() { return { name: g, count: 0 }; });
    });
    var groupCounts = await Promise.all(countPromises);

    select.innerHTML = '<option value="">-- Selecciona un grupo --</option>';
    groupCounts.forEach(function(gc) {
      var option = document.createElement('option');
      option.value = gc.name;
      option.textContent = gc.name + ' (' + gc.count + ' contacto' + (gc.count !== 1 ? 's' : '') + ')';
      option.dataset.count = gc.count;
      select.appendChild(option);
    });

    select.dataset.loaded = '1';

    select.addEventListener('change', function() {
      var selected = select.options[select.selectedIndex];
      var countEl = document.getElementById('groupContactsCount');
      var countText = document.getElementById('groupContactsCountText');

      if (!select.value) {
        if (countText) countText.textContent = 'Selecciona un grupo para ver los contactos';
        if (countEl) countEl.classList.remove('has-count');
      } else {
        var cnt = selected?.dataset?.count || '0';
        if (countText) countText.textContent = cnt + ' contacto' + (cnt !== '1' ? 's' : '') + ' recibiran el mensaje';
        if (countEl) countEl.classList.add('has-count');
      }
      updateRecipientBadge();
    });

  } catch (error) {
    select.innerHTML = '<option value="">-- Error al cargar --</option>';
    console.error('Error loading groups:', error);
  }
}

async function loadGroupContactsCount() {
  // Now handled inline via the select change handler above
}

// ========== WhatsApp Preview Modal ==========
function setupPreview() {
  // Main preview button
  var mainBtn = document.getElementById('previewMessageBtn');
  if (mainBtn) {
    mainBtn.addEventListener('click', function() {
      openWaPreview();
    });
  }

  // Per-template preview buttons (delegated)
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.btn-preview-template');
    if (btn) {
      openWaPreview(parseInt(btn.dataset.template));
    }
  });

  // Close handlers
  var closeIds = ['waPreviewClose', 'waPreviewCloseX', 'waPreviewCloseBtn'];
  closeIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', closeWaPreview);
  });

  // Click backdrop to close
  var overlay = document.getElementById('waPreviewModal');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeWaPreview();
    });
  }

  // ESC to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeWaPreview();
  });
}

function openWaPreview(singleTemplateNum) {
  var modal = document.getElementById('waPreviewModal');
  var chat = document.getElementById('waPreviewChat');
  var varsContainer = document.getElementById('waPreviewVars');
  if (!modal || !chat) return;

  var exampleValues = {
    '{nombre}': 'Juan',
    '{tratamiento}': 'Sr.',
    '{grupo}': 'Clientes VIP'
  };

  // Collect templates
  var templates = [];
  var templateCount = parseInt(document.getElementById('templateCount')?.value || 1);

  if (singleTemplateNum) {
    var msg = document.getElementById('message' + singleTemplateNum)?.value || '';
    if (msg.trim()) templates.push(msg.trim());
  } else {
    for (var i = 1; i <= templateCount; i++) {
      var msg = document.getElementById('message' + i)?.value || '';
      if (msg.trim()) templates.push(msg.trim());
    }
  }

  if (templates.length === 0) {
    showAlert('Escribe al menos un mensaje para ver la vista previa', 'warning');
    return;
  }

  // Check media type
  var mediaType = document.getElementById('messageTypeHidden')?.value || 'none';

  // Get current time
  var now = new Date();
  var timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

  // Get image count for multiple images
  var multiImageCount = 0;
  if (mediaType === 'multiple') {
    var multiInput = document.getElementById('images');
    multiImageCount = multiInput?.files?.length || 4;
  }

  // Build chat messages
  chat.innerHTML = '';

  templates.forEach(function(tpl, idx) {
    var rendered = tpl;
    Object.keys(exampleValues).forEach(function(key) {
      rendered = rendered.split(key).join(exampleValues[key]);
    });

    // Escape HTML
    var div = document.createElement('div');
    div.textContent = rendered;
    var safeText = div.innerHTML.replace(/\n/g, '<br>');

    var bubble = document.createElement('div');
    bubble.className = 'wa-msg-wrapper';

    var content = '';

    // --- Audio: voice message bubble (no text inside, separate bubble) ---
    if (mediaType === 'audio' && idx === 0) {
      var waveformBars = '';
      for (var b = 0; b < 28; b++) {
        var h = [4,7,3,8,5,10,6,12,4,9,7,14,5,11,8,6,13,4,10,7,5,12,8,3,9,6,11,5][b];
        waveformBars += '<span class="wa-waveform-bar" style="height:' + h + 'px"></span>';
      }
      var audioContent =
        '<div class="wa-voice-msg">' +
          '<div class="wa-voice-avatar"><i class="bi bi-person-fill"></i></div>' +
          '<button class="wa-voice-play"><i class="bi bi-play-fill"></i></button>' +
          '<div class="wa-voice-track">' +
            '<div class="wa-waveform">' + waveformBars + '</div>' +
            '<div class="wa-voice-info">' +
              '<span class="wa-voice-duration">0:15</span>' +
              '<span class="wa-voice-mic"><i class="bi bi-mic-fill"></i></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="wa-msg-meta"><span class="wa-msg-time">' + timeStr + '</span><span class="wa-msg-checks"><i class="bi bi-check-all"></i></span></div>';

      bubble.innerHTML = '<div class="wa-msg-bubble wa-msg-sent">' + audioContent + '</div>';

      // If there's also text, add it as a separate bubble below
      if (safeText.trim()) {
        var textBubble = document.createElement('div');
        textBubble.className = 'wa-msg-wrapper';
        textBubble.style.marginTop = '4px';
        textBubble.innerHTML =
          '<div class="wa-msg-bubble wa-msg-sent">' +
            '<div class="wa-msg-text">' + safeText + '</div>' +
            '<div class="wa-msg-meta"><span class="wa-msg-time">' + timeStr + '</span><span class="wa-msg-checks"><i class="bi bi-check-all"></i></span></div>' +
          '</div>';

        // Add template label if multiple templates
        if (templates.length > 1) {
          var label = document.createElement('div');
          label.className = 'wa-msg-label';
          label.textContent = 'Mensaje ' + (singleTemplateNum || (idx + 1));
          bubble.insertBefore(label, bubble.firstChild);
        }

        chat.appendChild(bubble);
        chat.appendChild(textBubble);
        return; // skip default append
      }
    }
    // --- Multiple images: grid/collage ---
    else if (mediaType === 'multiple' && idx === 0) {
      var imgCount = Math.max(multiImageCount, 2);
      var displayCount = Math.min(imgCount, 4);
      var gridClass = 'wa-multi-images wa-multi-grid-' + displayCount;

      var gridItems = '';
      for (var g = 0; g < displayCount; g++) {
        var isLast = (g === displayCount - 1) && (imgCount > 4);
        gridItems += '<div class="wa-multi-img-item">' +
          '<i class="bi bi-image"></i>' +
          (isLast ? '<span class="wa-multi-img-badge">+' + (imgCount - 3) + '</span>' : '') +
        '</div>';
      }

      content += '<div class="' + gridClass + '">' + gridItems + '</div>';
      // Caption on last image
      content += '<div class="wa-msg-text">' + safeText + '</div>';
      content += '<div class="wa-msg-meta"><span class="wa-msg-time">' + timeStr + '</span><span class="wa-msg-checks"><i class="bi bi-check-all"></i></span></div>';
    }
    // --- Single image with caption ---
    else if (mediaType === 'single' && idx === 0) {
      content += '<div class="wa-msg-image"><i class="bi bi-image"></i><span>Imagen adjunta</span></div>';
      content += '<div class="wa-msg-text">' + safeText + '</div>';
      content += '<div class="wa-msg-meta"><span class="wa-msg-time">' + timeStr + '</span><span class="wa-msg-checks"><i class="bi bi-check-all"></i></span></div>';
    }
    // --- Text only ---
    else {
      content += '<div class="wa-msg-text">' + safeText + '</div>';
      content += '<div class="wa-msg-meta"><span class="wa-msg-time">' + timeStr + '</span><span class="wa-msg-checks"><i class="bi bi-check-all"></i></span></div>';
    }

    if (!bubble.innerHTML) {
      bubble.innerHTML = '<div class="wa-msg-bubble wa-msg-sent">' + content + '</div>';
    }

    // Add template number label if multiple
    if (templates.length > 1) {
      var label = document.createElement('div');
      label.className = 'wa-msg-label';
      label.textContent = 'Mensaje ' + (singleTemplateNum || (idx + 1));
      bubble.insertBefore(label, bubble.firstChild);
    }

    chat.appendChild(bubble);
  });

  // Build variables info
  if (varsContainer) {
    var usedVars = [];
    var allText = templates.join(' ');
    Object.keys(exampleValues).forEach(function(key) {
      if (allText.indexOf(key) !== -1) {
        usedVars.push('<span class="wa-preview-var-item"><code>' + key + '</code> <i class="bi bi-arrow-right"></i> <strong>' + exampleValues[key] + '</strong></span>');
      }
    });

    if (usedVars.length > 0) {
      varsContainer.innerHTML = '<div class="wa-preview-vars-title">Variables usadas:</div>' + usedVars.join('');
      varsContainer.classList.remove('d-none');
    } else {
      varsContainer.classList.add('d-none');
    }
  }

  modal.classList.remove('d-none');
  // Force reflow then animate in
  modal.offsetHeight;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeWaPreview() {
  var modal = document.getElementById('waPreviewModal');
  if (!modal || modal.classList.contains('d-none')) return;

  modal.classList.remove('active');
  setTimeout(function() {
    modal.classList.add('d-none');
    document.body.style.overflow = '';
  }, 200);
}

// ========== Initialize ==========
function initMessages() {
  setupMessageForm();
  setupMediaChips();
  setupFileInputs();
  setupTemplates();
  setupAdvancedTemplates();
  setupSavedTemplateDropdown();
  setupEmojiPicker();
  setupVariables();
  setupPreview();
  setupRecipientSourceTabs();
  loadIntervals();

  // Cancel button
  var cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelSending);
  }

  // Export button
  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportResults);
  }
}

// Global exports
window.initMessages = initMessages;
window.cancelSending = cancelSending;
window.exportResults = exportResults;
window.loadSavedTemplates = loadSavedTemplates;
