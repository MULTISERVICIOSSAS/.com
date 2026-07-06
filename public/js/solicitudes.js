(function () {
  const cfg = window.MULTISERVICIOS_CONFIG || {};

  function apiBaseUrl() {
    return String(cfg.certificadosApiUrl || "").trim().replace(/\/$/, "");
  }

  function clean(value) {
    return String(value || "").replace(/[<>]/g, "").trim();
  }

  function formPayload(form) {
    const data = new FormData(form);
    const payload = {};
    data.forEach((value, key) => {
      payload[key] = value === "on" ? true : clean(value);
    });
    return payload;
  }

  function showStatus(form, text, type) {
    let box = form.querySelector("[data-form-status]");
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-form-status", "");
      form.appendChild(box);
    }
    box.className = `validation-result show ${type || ""}`;
    box.textContent = text;
  }

  async function postJson(path, payload) {
    const base = apiBaseUrl();
    if (!base) throw new Error("API no configurada");
    const response = await fetch(base + path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo guardar");
    return data;
  }

  function initRequestForms() {
    document.querySelectorAll("[data-request-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = formPayload(form);
        if (!payload.nombre || !payload.documento || !payload.correo || !payload.celular || !payload.servicio) {
          showStatus(form, "Completa nombre, documento, correo, celular y servicio.", "invalid");
          return;
        }
        if (!payload.acepta_datos) {
          showStatus(form, "Debes aceptar el tratamiento de datos para registrar la solicitud.", "invalid");
          return;
        }
        try {
          await postJson("/solicitudes", payload);
          showStatus(form, "Solicitud registrada. Un asesor puede continuar el proceso desde el panel admin.", "valid");
          form.reset();
        } catch (error) {
          showStatus(form, error.message || "No se pudo registrar la solicitud.", "invalid");
        }
      });
    });

    document.querySelectorAll("[data-company-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = formPayload(form);
        if (!payload.empresa || !payload.contacto || !payload.celular) {
          showStatus(form, "Completa empresa, contacto y celular.", "invalid");
          return;
        }
        try {
          await postJson("/empresas", payload);
          showStatus(form, "Solicitud empresarial registrada en el panel.", "valid");
          form.reset();
        } catch (error) {
          showStatus(form, error.message || "No se pudo registrar la solicitud empresarial.", "invalid");
        }
      });
    });
  }

  async function initCatalog() {
    const targets = document.querySelectorAll("[data-catalog-services], [data-catalog-faqs], [data-catalog-testimonials]");
    if (!targets.length) return;
    try {
      const response = await fetch(apiBaseUrl() + "/public/catalogo", { cache: "no-store" });
      if (!response.ok) throw new Error("catalogo");
      const data = await response.json();
      document.querySelectorAll("[data-catalog-services]").forEach((target) => {
        target.innerHTML = (data.services || [])
          .map(
            (item) => `
              <article class="admin-tile">
                ${serviceImage(item)}
                <span class="badge green">${escapeHtml(item.modalidad || "Servicio")}</span>
                <h3>${escapeHtml(item.nombre)}</h3>
                <p>${escapeHtml(item.descripcion)}</p>
                <p><strong>Precio:</strong> ${escapeHtml(item.precio || "Solicitar precio")}</p>
                <p><strong>Duracion:</strong> ${escapeHtml(item.duracion || "Segun alcance")}</p>
              </article>`
          )
          .join("");
      });
      document.querySelectorAll("[data-catalog-faqs]").forEach((target) => {
        target.innerHTML = (data.faqs || [])
          .map((item) => `<article class="admin-tile"><h3>${escapeHtml(item.pregunta)}</h3><p>${escapeHtml(item.respuesta)}</p></article>`)
          .join("");
      });
      document.querySelectorAll("[data-catalog-testimonials]").forEach((target) => {
        target.innerHTML = (data.testimonials || [])
          .map((item) => `<article class="admin-tile"><p>${escapeHtml(item.texto)}</p><h3>${escapeHtml(item.nombre)}</h3><span class="badge gold">${escapeHtml(item.cargo)}</span></article>`)
          .join("");
      });
    } catch (error) {}
  }

  function serviceImage(item) {
    const slug = String(item.slug || "").toLowerCase();
    const images = {
      "certificado-manipulacion-alimentos": "assets/images/capacitacion-alimentos-certificado.jpg",
      "capacitacion-extintores": "assets/images/servicio-extintores-recarga.jpg",
      "lavado-desinfeccion-tanques": "assets/images/servicio-saneamiento-cocina.jpg",
      "plan-saneamiento-control-plagas": "assets/images/servicio-control-plagas.jpg",
      "paquetes-empresariales": "assets/images/equipo-multiservicios.jpg"
    };
    const src = images[slug];
    if (!src) return "";
    return `<div class="tile-image"><img src="${src}" alt="${escapeHtml(item.nombre)}" loading="lazy" /></div>`;
  }

  function initCertificateLookup() {
    document.querySelectorAll("[data-certificate-lookup]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = formPayload(form);
        const code = clean(data.codigo);
        if (!code) {
          showStatus(form, "Ingresa el codigo del certificado.", "invalid");
          return;
        }
        window.location.href = "validar-certificado.html?codigo=" + encodeURIComponent(code);
      });
    });
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value || "");
    return div.innerHTML;
  }

  document.addEventListener("DOMContentLoaded", () => {
    initRequestForms();
    initCatalog();
    initCertificateLookup();
  });
})();
