(function () {
  // Opt-out: ?shell=v1 or localStorage.shellV2=0 reverts to legacy navbar
  const PARAM = new URLSearchParams(location.search).get("shell");
  const FLAG = localStorage.getItem("shellV2");
  if (PARAM === "v1" || FLAG === "0") return;
  // Persist opt-out if explicitly requested
  if (PARAM === "v1") localStorage.setItem("shellV2", "0");

  const NAV_ITEMS = [
    { tab: "dashboard", icon: "bi-speedometer2", label: "Dashboard" },
    { tab: "whatsapp", icon: "bi-whatsapp", label: "WhatsApp" },
    { tab: "send", icon: "bi-send", label: "Enviar" },
    { tab: "contacts", icon: "bi-people", label: "Contactos" },
    { tab: "inbox", icon: "bi-chat-dots", label: "Bandeja", inboxBadge: true },
    { tab: "chatbot", icon: "bi-robot", label: "Chatbot" },
    { label: null }, // group divider
    { tab: "templates", icon: "bi-chat-square-text", label: "Plantillas" },
    { tab: "campaigns", icon: "bi-megaphone", label: "Campañas" },
    { tab: "api", icon: "bi-code-slash", label: "API" },
    { tab: "admin", icon: "bi-shield-lock", label: "Admin", adminOnly: true },
  ];

  function buildNavHtml() {
    let html = "";
    let groupStarted = false;
    NAV_ITEMS.forEach((item) => {
      if (!item.tab) {
        html += '<div class="v2-nav-group-label">Más</div>';
        groupStarted = true;
        return;
      }
      const badge = item.inboxBadge
        ? '<span id="v2-inbox-badge" class="v2-nav-badge d-none">0</span>'
        : "";
      const adminAttr = item.adminOnly
        ? ' data-admin-only="true" style="display:none"'
        : "";
      html += `<button class="v2-nav-item" data-tab="${item.tab}"${adminAttr}>
        <i class="bi ${item.icon}"></i>
        <span>${item.label}</span>
        ${badge}
      </button>`;
    });
    return html;
  }

  const shellHtml = `
    <aside id="v2-sidebar">
      <div class="v2-sidebar-header">
        <i class="bi bi-whatsapp"></i>
        <span>Monchito WA</span>
      </div>
      <nav class="v2-sidebar-nav">${buildNavHtml()}</nav>
      <div class="v2-sidebar-footer">
        <div class="v2-avatar v2-footer-avatar">
          <img id="v2-footer-avatar-img" class="v2-avatar-img d-none" src="" alt="Avatar">
          <i id="v2-footer-avatar-icon" class="bi bi-person-circle"></i>
        </div>
        <div class="v2-sidebar-footer-info">
          <div class="v2-sidebar-footer-name" id="v2-footer-name">Usuario</div>
          <div class="v2-sidebar-footer-plan" id="v2-footer-plan">—</div>
        </div>
      </div>
    </aside>
    <header id="v2-topbar">
      <button id="v2-hamburger" title="Menú"><i class="bi bi-list"></i></button>
      <div class="v2-topbar-spacer"></div>
      <div class="v2-conn-badge disconnected" id="v2-conn-badge">
        <span class="v2-conn-dot"></span>
        <span id="v2-conn-text">Desconectado</span>
      </div>
      <button class="v2-theme-btn" id="v2-theme-btn" title="Cambiar tema">
        <i class="bi bi-moon-fill" id="v2-theme-icon"></i>
      </button>
      <div class="v2-user-menu">
        <button class="v2-user-chip" id="v2-user-chip" title="Perfil">
          <span class="v2-avatar v2-chip-avatar">
            <img id="v2-chip-avatar-img" class="v2-avatar-img d-none" src="" alt="Avatar">
            <i id="v2-chip-avatar-icon" class="bi bi-person-circle"></i>
          </span>
          <span id="v2-chip-name">Usuario</span>
          <i class="bi bi-chevron-down" style="font-size:.65rem;margin-left:2px"></i>
        </button>
        <div id="v2-user-dropdown">
          <div class="v2-dropdown-header">
            <div class="v2-dropdown-user-row">
              <div class="v2-avatar v2-dropdown-avatar">
                <img id="v2-dd-avatar-img" class="v2-avatar-img d-none" src="" alt="Avatar">
                <i id="v2-dd-avatar-icon" class="bi bi-person-circle"></i>
              </div>
              <div class="v2-dropdown-user-info">
                <div class="v2-dropdown-name" id="v2-dd-name">Usuario</div>
                <div class="v2-dropdown-email" id="v2-dd-email"></div>
                <span class="v2-dropdown-plan" id="v2-dd-plan">—</span>
              </div>
            </div>
          </div>
          <button class="v2-dropdown-item" id="v2-dd-country">
            <i class="bi bi-globe2"></i> Cambiar país
          </button>
          <button class="v2-dropdown-item danger" id="v2-dd-logout">
            <i class="bi bi-box-arrow-right"></i> Cerrar sesión
          </button>
        </div>
      </div>
    </header>
    <div id="v2-sidebar-overlay"></div>`;

  function init() {
    document.body.classList.add("shell-v2-active");
    document.body.insertAdjacentHTML("afterbegin", shellHtml);

    // Nav item clicks → delegate to existing hidden tab buttons
    document.querySelectorAll("#v2-sidebar .v2-nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        const target =
          document.querySelector(`.tab-btn[data-tab="${tab}"]`) ||
          document.querySelector(`.tab-more-item[data-tab="${tab}"]`);
        if (target) target.click();
        document.body.classList.remove("shell-v2-mobile-open");
      });
    });

    // Hamburger toggle
    document.getElementById("v2-hamburger").addEventListener("click", () => {
      document.body.classList.toggle("shell-v2-mobile-open");
    });
    document
      .getElementById("v2-sidebar-overlay")
      .addEventListener("click", () => {
        document.body.classList.remove("shell-v2-mobile-open");
      });

    // Theme toggle
    function syncThemeIcon() {
      const isDark =
        document.documentElement.getAttribute("data-theme") !== "light";
      document.getElementById("v2-theme-icon").className = isDark
        ? "bi bi-moon-fill"
        : "bi bi-sun-fill";
    }
    document.getElementById("v2-theme-btn").addEventListener("click", () => {
      const sw = document.getElementById("themeSwitch");
      if (sw) sw.click();
      else {
        const html = document.documentElement;
        html.setAttribute(
          "data-theme",
          html.getAttribute("data-theme") === "light" ? "dark" : "light",
        );
      }
    });
    syncThemeIcon();
    new MutationObserver(syncThemeIcon).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // User chip → toggle own dropdown
    const userChip = document.getElementById("v2-user-chip");
    const userDropdown = document.getElementById("v2-user-dropdown");
    userChip.addEventListener("click", (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (!userDropdown.contains(e.target) && e.target !== userChip) {
        userDropdown.classList.remove("open");
      }
    });

    // Logout
    document.getElementById("v2-dd-logout").addEventListener("click", () => {
      userDropdown.classList.remove("open");
      if (typeof window.logout === "function") window.logout();
    });

    // Change country → delegate to existing handler
    document.getElementById("v2-dd-country").addEventListener("click", () => {
      userDropdown.classList.remove("open");
      const btn =
        document.getElementById("profile-change-country") ||
        document.getElementById("country-indicator");
      if (btn) btn.click();
    });

    // Sync active tab in sidebar
    function syncActiveTab() {
      const activePane = document.querySelector(".tab-pane.active");
      const activeTab =
        activePane?.id ||
        document.querySelector(".tab-btn.active")?.dataset.tab;
      document.querySelectorAll("#v2-sidebar .v2-nav-item").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === activeTab);
      });
    }
    const mainEl = document.querySelector(".main") || document.body;
    new MutationObserver(syncActiveTab).observe(mainEl, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    syncActiveTab();

    // Sync user info (name populated async by main.js)
    function getPhotoUrl() {
      if (typeof window.getCurrentProfilePhotoUrl === "function") {
        return window.getCurrentProfilePhotoUrl();
      }
      const legacyImg = document.getElementById("profile-avatar-img");
      return legacyImg && !legacyImg.classList.contains("d-none")
        ? legacyImg.getAttribute("src")
        : null;
    }

    function setAvatar(img, icon, photoUrl) {
      if (!img) return;
      if (photoUrl) {
        img.onload = () => {
          img.classList.remove("d-none");
          if (icon) icon.classList.add("d-none");
        };
        img.onerror = () => {
          img.removeAttribute("src");
          img.classList.add("d-none");
          if (icon) icon.classList.remove("d-none");
        };
        img.src = photoUrl;
        img.classList.remove("d-none");
        if (icon) icon.classList.add("d-none");
      } else {
        img.removeAttribute("src");
        img.classList.add("d-none");
        if (icon) icon.classList.remove("d-none");
      }
    }

    function syncUserAvatar(photoUrl) {
      const url = photoUrl || getPhotoUrl();
      [
        ["v2-footer-avatar-img", "v2-footer-avatar-icon"],
        ["v2-chip-avatar-img", "v2-chip-avatar-icon"],
        ["v2-dd-avatar-img", "v2-dd-avatar-icon"],
      ].forEach(([imgId, iconId]) => {
        setAvatar(
          document.getElementById(imgId),
          document.getElementById(iconId),
          url,
        );
      });
    }

    function syncUserInfo() {
      const profile = window.userProfile || {};
      const user = window.currentUser || {};
      const name =
        document.getElementById("user-name")?.textContent.trim() ||
        user.displayName ||
        profile.displayName ||
        profile.name ||
        user.email ||
        "Usuario";
      const email =
        document.getElementById("profile-display-email")?.textContent.trim() ||
        user.email ||
        profile.email ||
        "";
      const plan =
        document.getElementById("profile-plan-badge")?.textContent.trim() ||
        (profile.role === "admin" ? "Admin" : profile.plan ? "Acceso activo" : "");
      if (name) {
        document.getElementById("v2-footer-name").textContent = name;
        document.getElementById("v2-chip-name").textContent = name;
        document.getElementById("v2-dd-name").textContent = name;
      }
      if (email) document.getElementById("v2-dd-email").textContent = email;
      if (plan) {
        document.getElementById("v2-footer-plan").textContent = plan;
        document.getElementById("v2-dd-plan").textContent = plan;
      }
      syncUserAvatar();
    }
    const userInfoEl = document.getElementById("user-info");
    if (userInfoEl)
      new MutationObserver(syncUserInfo).observe(userInfoEl, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "src"],
      });
    window.addEventListener("profile-avatar-updated", (event) => {
      syncUserAvatar(event.detail?.photoUrl);
    });
    syncUserInfo();
    // Retry after auth settles
    setTimeout(syncUserInfo, 2000);

    // Sync connection status badge
    function syncConn() {
      const src = document.getElementById("connection-status");
      if (!src) return;
      const v2 = document.getElementById("v2-conn-badge");
      const txt = document.getElementById("v2-conn-text");
      txt.textContent = src.querySelector(".status-text")?.textContent || "";
      v2.className = "v2-conn-badge";
      if (src.classList.contains("connected")) v2.classList.add("connected");
      else if (src.classList.contains("qr")) v2.classList.add("qr");
      else v2.classList.add("disconnected");
    }
    const connEl = document.getElementById("connection-status");
    if (connEl)
      new MutationObserver(syncConn).observe(connEl, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    syncConn();

    // Sync inbox unread badge
    function syncInbox() {
      const src = document.getElementById("inbox-unread-badge");
      const dst = document.getElementById("v2-inbox-badge");
      if (!src || !dst) return;
      dst.textContent = src.textContent.trim();
      dst.classList.toggle("d-none", src.classList.contains("d-none"));
    }
    const inboxBadge = document.getElementById("inbox-unread-badge");
    if (inboxBadge)
      new MutationObserver(syncInbox).observe(inboxBadge, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    syncInbox();

    // Sync admin tab visibility
    function syncAdmin() {
      const src = document.getElementById("admin-tab-btn");
      const dst = document.querySelector(
        '#v2-sidebar .v2-nav-item[data-tab="admin"]',
      );
      if (src && dst)
        dst.style.display = src.classList.contains("d-none") ? "none" : "";
    }
    const adminBtn = document.getElementById("admin-tab-btn");
    if (adminBtn)
      new MutationObserver(syncAdmin).observe(adminBtn, {
        attributes: true,
        attributeFilter: ["class"],
      });
    syncAdmin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
