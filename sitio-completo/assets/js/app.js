(function () {
  const whatsapp = "3222166831";
  const defaultMessage = "Hola, quiero informacion sobre los servicios de Multiservicios.";
  const apiBase = "/api";

  function clean(value) {
    return String(value || "").replace(/[<>]/g, "").trim();
  }

  function whatsappForUrl() {
    const digits = whatsapp.replace(/\D/g, "");
    return digits.startsWith("57") ? digits : `57${digits}`;
  }

  function waUrl(message) {
    return `https://wa.me/${whatsappForUrl()}?text=${encodeURIComponent(message || defaultMessage)}`;
  }

  async function api(path, options = {}) {
    return fetch(apiBase + path, {
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  }

  function rememberAdmin(mode = "backend") {
    sessionStorage.setItem("msAdminAcknowledged", "true");
    sessionStorage.setItem("msAdminMode", mode);
  }

  function initMenu() {
    const button = document.querySelector("[data-menu-button]");
    const nav = document.querySelector("[data-main-nav]");
    if (!button || !nav) return;
    button.addEventListener("click", () => {
      nav.classList.toggle("open");
    });
  }

  function initWhatsAppLinks() {
    document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
      link.href = waUrl(link.dataset.message);
      link.target = "_blank";
      link.rel = "noopener";
    });
  }

  function initLookup() {
    const form = document.querySelector("[data-lookup-form]");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = String(new FormData(form).get("codigo") || "").trim();
      if (!code) {
        form.querySelector("input")?.focus();
        return;
      }
      window.location.href = "../validar-certificado.html?codigo=" + encodeURIComponent(code);
    });
  }

  function initAdminMode() {
    const widget = document.querySelector("[data-site-admin-widget]");
    if (!widget) return;
    const form = widget.querySelector("[data-site-admin-login]");
    const panel = widget.querySelector("[data-site-admin-panel]");
    const status = widget.querySelector("[data-site-admin-status]");
    const email = widget.querySelector("[data-site-admin-email]");
    const logout = widget.querySelector("[data-site-admin-logout]");

    function setStatus(text, type) {
      if (!status) return;
      status.textContent = text;
      status.className = `status-message ${type || ""}`.trim();
    }

    function showPanel(admin) {
      if (form) form.hidden = true;
      if (panel) panel.hidden = false;
      if (email && admin?.email) email.textContent = admin.email;
      setStatus("Sesion administrativa activa.", "valid");
      loadStats();
    }

    function showLogin(message, type) {
      if (form) form.hidden = false;
      if (panel) panel.hidden = true;
      setStatus(message || "Ingresa la clave administrativa para continuar.", type || "");
    }

    async function loadStats() {
      try {
        const response = await api("/admin/stats");
        if (!response.ok) throw new Error("stats");
        const stats = await response.json();
        populateStats(stats);
      } catch (error) {
        await loadStaticStats();
      }
    }

    function populateStats(stats) {
        widget.querySelectorAll("[data-admin-stat]").forEach((node) => {
          const key = node.getAttribute("data-admin-stat");
          node.textContent = stats[key] ?? 0;
        });
    }

    async function loadStaticStats() {
      const stats = {
        certificates: 0,
        course_results: 0,
        customers: 0,
        pending_requests: 0,
        pending_payments: 0,
        approved_exams: 0
      };
      try {
        let certificates = [];
        const response = await fetch("../data/certificados.json", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          certificates = Array.isArray(data) ? data : [];
        }
        const generated = JSON.parse(localStorage.getItem("msGeneratedCertificates") || "[]");
        const allCertificates = [...(Array.isArray(generated) ? generated : []), ...certificates];
        const byCode = new Map();
        allCertificates.forEach((item, index) => {
          item = item || {};
          const code = String(item.codigo || item.codigo_unico || item.codigoCertificado || `sin-codigo-${index}`).trim().toUpperCase();
          if (!byCode.has(code)) byCode.set(code, item);
        });
        stats.certificates = byCode.size;
      } catch (error) {}
      try {
        const results = JSON.parse(localStorage.getItem("msCourseResults") || "[]");
        if (Array.isArray(results)) {
          stats.course_results = results.length;
          stats.approved_exams = results.filter((item) => String(item.estado || "").toLowerCase().includes("aprob")).length;
        }
      } catch (error) {}
      populateStats(stats);
    }

    api("/auth/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("no-session");
        const session = await response.json();
        rememberAdmin("backend");
        showPanel(session.admin);
      })
      .catch(() => showLogin("Ingresa la clave administrativa para abrir el panel.", ""));

    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const password = clean(new FormData(form).get("password"));
        if (!password) {
          setStatus("Escribe la clave administrativa.", "invalid");
          return;
        }
        setStatus("Validando acceso...", "");
        try {
          const response = await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({ password })
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            setStatus(data.error || "No fue posible iniciar sesion.", "invalid");
            return;
          }
          const session = await response.json();
          rememberAdmin("backend");
          showPanel(session.admin);
        } catch (error) {
          setStatus("No se pudo conectar con el servidor administrativo.", "invalid");
        }
      });
    }

    if (logout) {
      logout.addEventListener("click", async () => {
        await api("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
        sessionStorage.removeItem("msAdminAcknowledged");
        sessionStorage.removeItem("msAdminMode");
        showLogin("Sesion cerrada.", "valid");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMenu();
    initWhatsAppLinks();
    initLookup();
    initAdminMode();
  });
})();
