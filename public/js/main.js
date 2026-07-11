(function () {
  const cfg = window.MULTISERVICIOS_CONFIG || {};
  const navItems = [
    ["index.html", "Inicio"],
    ["cursos.html", "Curso"],
    ["registro.html", "Registro"],
    ["servicios.html", "Servicios"],
    ["empresas.html", "Empresas"],
    ["extintores.html", "Extintores"],
    ["validar-certificado.html", "Validar"],
    ["contacto.html", "Contacto"]
  ];

  function icon(name, size = 18) {
    return `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
  }

  function currentFile() {
    const file = window.location.pathname.split("/").pop();
    return file || "index.html";
  }

  function waUrl(message) {
    const text = encodeURIComponent(message || cfg.mensajeWhatsApp || "Hola, quiero información de Multiservicios.");
    const digits = String(cfg.whatsapp || "").replace(/\D/g, "");
    const phone = digits.startsWith("57") ? digits : `57${digits}`;
    return `https://wa.me/${phone}?text=${text}`;
  }

  function renderHeader() {
    const headerTarget = document.getElementById("site-header");
    if (!headerTarget) return;
    const current = currentFile();
    const links = navItems
      .map(([href, label]) => {
        const active = href === current ? ' aria-current="page"' : "";
        return `<a href="${href}"${active}>${label}</a>`;
      })
      .join("");

    headerTarget.innerHTML = `
      <div class="topbar">
        <div class="container">
          <span>${cfg.lema || ""}</span>
          <span><a href="tel:${(cfg.telefonoVisible || "").replace(/\s/g, "")}">${cfg.telefonoVisible || ""}</a> · <a href="mailto:${cfg.correo || ""}">${cfg.correo || ""}</a></span>
        </div>
      </div>
      <header class="site-header">
        <div class="container nav-wrap">
          <a class="brand-link" href="index.html" aria-label="Ir al inicio">
            <img class="brand-logo" src="assets/logos/logo-horizontal.png" alt="${cfg.empresa || "Multiservicios"}" />
          </a>
          <nav class="main-nav" id="main-nav" aria-label="Navegación principal">${links}</nav>
          <div class="nav-actions">
            <a class="button small success" data-whatsapp-link href="${waUrl()}">${icon("message-circle")} WhatsApp</a>
            <button class="menu-button" type="button" id="menu-toggle" aria-label="Abrir menú" aria-expanded="false">${icon("menu")}</button>
          </div>
        </div>
      </header>
    `;
  }

  function renderFooter() {
    const footerTarget = document.getElementById("site-footer");
    if (!footerTarget) return;
    footerTarget.innerHTML = `
      <footer class="footer">
        <div class="container">
          <div class="footer-grid">
            <div>
              <a class="brand-link" href="index.html">
                <img class="brand-logo" src="assets/logos/logo-horizontal.png" alt="${cfg.empresa || "Multiservicios"}" />
              </a>
              <p>Soluciones digitales y presenciales para formación, certificación y apoyo empresarial.</p>
            </div>
            <div>
              <strong>Certificación</strong>
              <ul>
                <li><a href="cursos.html">Manipulación de alimentos</a></li>
                <li><a href="registro.html">Registro / solicitud</a></li>
                <li><a href="mi-certificado.html">Mi certificado</a></li>
                <li><a href="validar-certificado.html">Validar certificado</a></li>
                <li><a href="certificados.html">Información de certificados</a></li>
              </ul>
            </div>
            <div>
              <strong>Servicios</strong>
              <ul>
                <li><a href="servicios.html">Portafolio</a></li>
                <li><a href="empresas.html">Empresas</a></li>
                <li><a href="extintores.html">Extintores</a></li>
                <li><a href="volante-digital.html">Volante digital</a></li>
              </ul>
            </div>
            <div>
              <strong>Contacto</strong>
              <ul>
                <li><a href="${waUrl()}" target="_blank" rel="noopener">${cfg.telefonoVisible || "WhatsApp"}</a></li>
                <li><a href="mailto:${cfg.correo || ""}">${cfg.correo || ""}</a></li>
                <li>${cfg.ciudad || "Ciudad por definir"}, ${cfg.pais || "Colombia"}</li>
              </ul>
            </div>
            <div>
              <strong>Legal</strong>
              <ul>
                <li><a href="politica-privacidad.html">Política de privacidad</a></li>
                <li><a href="tratamiento-datos.html">Tratamiento de datos</a></li>
                <li><a href="terminos.html">Términos y condiciones</a></li>
                <li><a href="preguntas-frecuentes.html">Preguntas frecuentes</a></li>
              </ul>
            </div>
          </div>
          <small>© 2026 ${cfg.empresa || "Multiservicios"}. Formación, certificación y soluciones empresariales.</small>
        </div>
      </footer>
    `;
  }

  function initMenu() {
    const toggle = document.getElementById("menu-toggle");
    const nav = document.getElementById("main-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      document.body.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.innerHTML = open ? icon("x") : icon("menu");
      if (window.lucide) window.lucide.createIcons();
    });
  }

  function initWhatsApp() {
    document.querySelectorAll("[data-whatsapp-link]").forEach((el) => {
      if (!el.getAttribute("href") || el.getAttribute("href") === "#") {
        el.setAttribute("href", waUrl());
      }
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener");
    });

    document.querySelectorAll("[data-whatsapp-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const nombre = clean(data.get("nombre"));
        const telefono = clean(data.get("telefono"));
        const servicio = clean(data.get("servicio"));
        const mensaje = clean(data.get("mensaje"));
        if (!nombre || !telefono || !servicio) {
          showInlineMessage(form, "Completa nombre, teléfono y servicio de interés.", "invalid");
          return;
        }
        const text = [
          "Hola Multiservicios, quiero recibir asesoría.",
          "",
          `Nombre: ${nombre}`,
          `Teléfono: ${telefono}`,
          `Servicio: ${servicio}`,
          mensaje ? `Mensaje: ${mensaje}` : ""
        ]
          .filter(Boolean)
          .join("\n");
        showInlineMessage(form, "Listo. Te llevamos a WhatsApp para enviar la solicitud.", "valid");
        window.open(waUrl(text), "_blank", "noopener");
      });
    });
  }

  function clean(value) {
    return String(value || "").replace(/[<>]/g, "").trim();
  }

  function showInlineMessage(form, text, type) {
    let box = form.querySelector("[data-form-status]");
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-form-status", "");
      form.appendChild(box);
    }
    box.className = `validation-result show ${type || ""}`;
    box.textContent = text;
  }

  function apiBaseUrl() {
    return String(cfg.certificadosAdminApiUrl || cfg.certificadosApiUrl || "").trim().replace(/\/$/, "");
  }

  async function apiRequest(path, options = {}) {
    const base = apiBaseUrl();
    if (!base) return null;
    const response = await fetch(base + path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    return response;
  }

  function hasAdminSession() {
    return sessionStorage.getItem("msAdminAcknowledged") === "true";
  }

  function openAdminDashboard(mode = "backend") {
    sessionStorage.setItem("msAdminAcknowledged", "true");
    sessionStorage.setItem("msAdminMode", mode);
    window.location.href = "dashboard.html";
  }

  function initAdminGuard() {
    const protectedPage = document.body.dataset.adminProtected === "true";
    const base = apiBaseUrl();
    if (protectedPage && base) {
      apiRequest("/auth/me")
        .then((response) => {
          if (response && response.ok) {
            sessionStorage.setItem("msAdminAcknowledged", "true");
            sessionStorage.setItem("msAdminMode", "backend");
            return;
          }
          if (!hasAdminSession()) window.location.href = "login.html";
        })
        .catch(() => {
          if (!hasAdminSession()) window.location.href = "login.html";
        });
    } else if (protectedPage && !hasAdminSession()) {
      window.location.href = "login.html";
    }

    const loginForm = document.querySelector("[data-admin-login]");
    if (loginForm) {
      loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const phrase = clean(new FormData(loginForm).get("frase"));
        const base = apiBaseUrl();
        if (base) {
          try {
            const response = await apiRequest("/auth/login", {
              method: "POST",
              body: JSON.stringify({ clave: phrase })
            });
            if (!response || !response.ok) {
              const data = response ? await response.json().catch(() => ({})) : {};
              showInlineMessage(loginForm, data.error || "No fue posible iniciar sesion.", "invalid");
              return;
            }
            openAdminDashboard("backend");
            return;
          } catch (error) {
            showInlineMessage(loginForm, "No se pudo conectar con el servidor administrativo.", "invalid");
            return;
          }
        }
        showInlineMessage(loginForm, "El panel requiere el servidor administrativo.", "invalid");
      });
    }

    const logout = document.querySelector("[data-admin-logout]");
    if (logout) {
      logout.addEventListener("click", async () => {
        await apiRequest("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
        sessionStorage.removeItem("msAdminAcknowledged");
        sessionStorage.removeItem("msAdminMode");
        window.location.href = "login.html";
      });
    }
  }

  function initContactPrefill() {
    document.querySelectorAll("[data-service]").forEach((button) => {
      button.addEventListener("click", () => {
        const select = document.querySelector("select[name='servicio']");
        if (select) select.value = button.dataset.service;
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderHeader();
    renderFooter();
    initMenu();
    initWhatsApp();
    initAdminGuard();
    initContactPrefill();
    document.querySelectorAll("[data-wa-url]").forEach((el) => {
      el.setAttribute("href", waUrl(el.dataset.waMessage));
    });
    if (window.lucide) window.lucide.createIcons();
  });

  window.MS = { waUrl, clean };
})();
