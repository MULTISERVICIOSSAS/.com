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
        widget.querySelectorAll("[data-admin-stat]").forEach((node) => {
          const key = node.getAttribute("data-admin-stat");
          node.textContent = stats[key] ?? 0;
        });
      } catch (error) {
        setStatus("Sesion abierta, pero no se pudieron cargar las estadisticas.", "invalid");
      }
    }

    api("/auth/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("no-session");
        const session = await response.json();
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
            body: JSON.stringify({ password: password.toUpperCase() })
          });
          if (!response.ok) {
            if (response.status === 404) {
              setStatus("El admin necesita el backend local. Abre http://127.0.0.1:8090/admin/ con el servidor encendido.", "invalid");
            } else {
              setStatus("Clave administrativa incorrecta. Usa MULTISERVICIOS en mayusculas.", "invalid");
            }
            return;
          }
          const session = await response.json();
          showPanel(session.admin);
        } catch (error) {
          setStatus("No se pudo conectar con el backend local.", "invalid");
        }
      });
    }

    if (logout) {
      logout.addEventListener("click", async () => {
        await api("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
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
