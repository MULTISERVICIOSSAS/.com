(function () {
  const cfg = window.MULTISERVICIOS_CONFIG || {};

  function baseUrl() {
    return String(cfg.certificadosAdminApiUrl || cfg.certificadosApiUrl || "").replace(/\/$/, "");
  }

  async function api(path, options = {}) {
    const response = await fetch(baseUrl() + path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Error API");
    return data;
  }

  function payload(form) {
    const data = new FormData(form);
    const out = {};
    data.forEach((value, key) => {
      out[key] = String(value || "").trim();
    });
    return out;
  }

  function status(form, text, type) {
    let box = form.querySelector("[data-form-status]");
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-form-status", "");
      form.appendChild(box);
    }
    box.className = `validation-result show ${type || ""}`;
    box.textContent = text;
  }

  function table(headers, rows) {
    if (!rows.length) return `<p class="section-lead">Sin registros.</p>`;
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  }

  async function loadClientes() {
    const target = document.querySelector("[data-admin-list='clientes']");
    if (!target) return;
    const data = await api("/admin/clientes");
    target.innerHTML = table(["Nombre", "Documento", "Correo", "Servicio", "Estado"], data.clientes.map((r) => `<tr><td>${e(r.nombre)}</td><td>${e(r.documento)}</td><td>${e(r.correo)}</td><td>${e(r.servicio_interes)}</td><td>${e(r.estado)}</td></tr>`));
  }

  async function loadSolicitudes() {
    const target = document.querySelector("[data-admin-list='solicitudes']");
    if (!target) return;
    const data = await api("/admin/solicitudes");
    target.innerHTML = `<h3>Solicitudes</h3>` + table(["Nombre", "Servicio", "Pago", "Estado"], data.solicitudes.map((r) => `<tr><td>${e(r.nombre)}</td><td>${e(r.servicio)}</td><td>${e(r.payment_status)}</td><td>${e(r.estado)}</td></tr>`));
  }

  async function loadEmpresas() {
    const target = document.querySelector("[data-admin-list='empresas']");
    if (!target) return;
    const data = await api("/admin/empresas");
    target.innerHTML = `<h3>Empresas</h3>` + table(["Empresa", "Contacto", "Personas", "Estado"], data.empresas.map((r) => `<tr><td>${e(r.empresa)}</td><td>${e(r.contacto)}</td><td>${e(r.cantidad_personas)}</td><td>${e(r.estado)}</td></tr>`));
  }

  async function loadServicios() {
    const target = document.querySelector("[data-admin-list='servicios']");
    if (!target) return;
    const data = await api("/admin/servicios");
    target.innerHTML = table(["Nombre", "Precio", "Modalidad", "Estado"], data.servicios.map((r) => `<tr><td>${e(r.nombre)}</td><td>${e(r.precio)}</td><td>${e(r.modalidad)}</td><td>${e(r.estado)}</td></tr>`));
  }

  async function loadCursos() {
    const target = document.querySelector("[data-admin-list='cursos']");
    if (!target) return;
    const data = await api("/admin/cursos");
    target.innerHTML = `<h3>Cursos</h3>` + table(["ID", "Nombre", "Minimo", "Intentos"], data.cursos.map((r) => `<tr><td>${e(r.id)}</td><td>${e(r.nombre)}</td><td>${e(r.puntaje_minimo)}</td><td>${e(r.intentos_maximos)}</td></tr>`));
  }

  async function loadPreguntas() {
    const target = document.querySelector("[data-admin-list='preguntas']");
    if (!target) return;
    const data = await api("/admin/preguntas");
    target.innerHTML = `<h3>Preguntas</h3>` + table(["ID", "Pregunta", "Correcta", "Estado"], data.preguntas.map((r) => `<tr><td>${e(r.id)}</td><td>${e(r.pregunta)}</td><td>${e(r.respuesta_correcta)}</td><td>${e(r.estado)}</td></tr>`));
  }

  async function loadPagos() {
    const target = document.querySelector("[data-admin-list='pagos']");
    if (!target) return;
    const data = await api("/admin/pagos");
    target.innerHTML = table(["Cliente", "Servicio", "Monto", "Estado", "Referencia"], data.pagos.map((r) => `<tr><td>${e(r.nombre_cliente)}</td><td>${e(r.servicio)}</td><td>${e(r.monto)} ${e(r.moneda)}</td><td>${e(r.estado)}</td><td>${e(r.referencia)}</td></tr>`));
  }

  async function loadFaqs() {
    const target = document.querySelector("[data-admin-list='faqs']");
    if (!target) return;
    const data = await api("/admin/faqs");
    target.innerHTML = `<h3>FAQ</h3>` + table(["Pregunta", "Categoria", "Estado"], data.faqs.map((r) => `<tr><td>${e(r.pregunta)}</td><td>${e(r.categoria)}</td><td>${e(r.estado)}</td></tr>`));
  }

  async function loadTestimonios() {
    const target = document.querySelector("[data-admin-list='testimonios']");
    if (!target) return;
    const data = await api("/admin/testimonios");
    target.innerHTML = `<h3>Testimonios</h3>` + table(["Nombre", "Cargo", "Estado"], data.testimonios.map((r) => `<tr><td>${e(r.nombre)}</td><td>${e(r.cargo)}</td><td>${e(r.estado)}</td></tr>`));
  }

  async function loadAuditoria() {
    const target = document.querySelector("[data-admin-list='auditoria']");
    if (!target) return;
    const data = await api("/admin/auditoria");
    target.innerHTML = table(["Fecha", "Accion", "Descripcion", "IP"], data.logs.map((r) => `<tr><td>${e(r.fecha)}</td><td>${e(r.accion)}</td><td>${e(r.descripcion)}</td><td>${e(r.ip)}</td></tr>`));
  }

  const loaders = {
    clientes: loadClientes,
    solicitudes: loadSolicitudes,
    empresas: loadEmpresas,
    servicios: loadServicios,
    cursos: loadCursos,
    preguntas: loadPreguntas,
    pagos: loadPagos,
    faqs: loadFaqs,
    testimonios: loadTestimonios,
    auditoria: loadAuditoria
  };

  function initForms() {
    document.querySelectorAll("[data-admin-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await api(form.dataset.endpoint, { method: "POST", body: JSON.stringify(payload(form)) });
          status(form, "Guardado correctamente.", "valid");
          form.reset();
          await loadAll();
        } catch (error) {
          status(form, error.message || "No se pudo guardar.", "invalid");
        }
      });
    });
  }

  async function loadAll() {
    for (const fn of Object.values(loaders)) {
      await fn().catch(() => {});
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value || "");
    return div.innerHTML;
  }

  const e = escapeHtml;

  document.addEventListener("DOMContentLoaded", () => {
    initForms();
    loadAll();
  });
})();
