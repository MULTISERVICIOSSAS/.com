(function () {
  const cfg = window.MULTISERVICIOS_CONFIG || {};
  const state = { page: 1, pages: 1, limit: 50, query: "", records: new Map() };

  function baseUrl() {
    return String(cfg.certificadosAdminApiUrl || cfg.certificadosApiUrl || "").replace(/\/$/, "");
  }

  async function api(path) {
    const response = await fetch(baseUrl() + path, { credentials: "include", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo consultar la base");
    return data;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  function text(value) {
    const clean = String(value ?? "").trim();
    return clean || "Sin dato";
  }

  function phones(row) {
    return [row.telefono_1, row.telefono_2, row.telefono_3, row.telefono_4].map((value) => String(value || "").trim()).filter(Boolean);
  }

  function renderPhones(row) {
    const values = phones(row);
    if (!values.length) return "Sin dato";
    return `<div class="phone-list">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>`;
  }

  function formatDate(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : text(raw);
  }

  function renderTable(rows) {
    if (!rows.length) return '<p class="section-lead">No hay prospectos que coincidan con la busqueda.</p>';
    return `
      <div class="table-wrap">
        <table class="prospect-table">
          <thead><tr>
            <th>Establecimiento</th><th>Telefonos</th><th>Correo</th><th>Ciudad</th><th>Actividad</th>
            <th>Resultado de gestion</th><th>Agente</th><th>Fecha</th><th>Detalle</th>
          </tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td><strong>${escapeHtml(text(row.establecimiento))}</strong></td>
            <td class="phones">${renderPhones(row)}</td>
            <td>${escapeHtml(text(row.correo))}</td>
            <td>${escapeHtml(text(row.ciudad))}</td>
            <td>${escapeHtml(text(row.actividad))}</td>
            <td>${escapeHtml(text(row.resultado_gestion))}</td>
            <td>${escapeHtml(text(row.agente))}</td>
            <td>${escapeHtml(formatDate(row.fecha_ingreso))}</td>
            <td><button class="button small secondary icon-command" type="button" data-prospect-view="${row.id}" aria-label="Ver prospecto" title="Ver prospecto"><i data-lucide="eye"></i></button></td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  const detailFields = [
    ["Telefono principal", "telefono_1"], ["Telefono 2", "telefono_2"], ["Telefono 3", "telefono_3"], ["Telefono 4", "telefono_4"],
    ["Correo electronico", "correo"], ["Ciudad", "ciudad"], ["Establecimiento", "establecimiento"], ["Actividad", "actividad"],
    ["Encargado", "encargado"], ["Titular del servicio", "titular_servicio"], ["Documento de identidad", "documento_identidad"],
    ["Resultado de la gestion", "resultado_gestion"], ["Direccion", "direccion"], ["Observaciones", "observaciones"],
    ["Fecha de ingreso", "fecha_ingreso"], ["Agente", "agente"], ["Fecha de envio de WhatsApp", "fecha_envio_whatsapp"],
    ["Observacion adicional", "observacion_adicional"], ["Estado CRM", "estado_crm"], ["Fila del archivo original", "source_row"]
  ];

  function openDetail(id) {
    const row = state.records.get(Number(id));
    const dialog = document.querySelector("[data-prospect-dialog]");
    if (!row || !dialog) return;
    document.querySelector("[data-prospect-dialog-title]").textContent = text(row.establecimiento);
    document.querySelector("[data-prospect-dialog-body]").innerHTML = `<dl class="prospect-detail">${detailFields.map(([label, field]) =>
      `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(field.startsWith("fecha_") ? formatDate(row[field]) : text(row[field]))}</dd></div>`
    ).join("")}</dl>`;
    dialog.showModal();
    if (window.lucide) window.lucide.createIcons();
  }

  function setStatus(message, type) {
    const target = document.querySelector("[data-prospect-status]");
    target.className = message ? `validation-result show ${type || ""}` : "validation-result";
    target.textContent = message;
  }

  async function load() {
    setStatus("Cargando prospectos...", "");
    const params = new URLSearchParams({ page: state.page, limit: state.limit });
    if (state.query) params.set("q", state.query);
    try {
      const data = await api("/admin/prospectos?" + params.toString());
      state.page = Number(data.page || 1);
      state.pages = Number(data.pages || 1);
      state.records = new Map((data.prospectos || []).map((row) => [Number(row.id), row]));
      document.querySelector("[data-prospect-list]").innerHTML = renderTable(data.prospectos || []);
      const total = Number(data.total || 0);
      document.querySelector("[data-prospect-total]").textContent = total.toLocaleString("es-CO") + (total === 1 ? " prospecto" : " prospectos");
      document.querySelector("[data-prospect-page]").textContent = "Pagina " + state.page + " de " + state.pages;
      document.querySelector("[data-prospect-page-label]").textContent = state.page + " / " + state.pages;
      document.querySelector("[data-prospect-prev]").disabled = state.page <= 1;
      document.querySelector("[data-prospect-next]").disabled = state.page >= state.pages;
      setStatus("", "");
      if (window.lucide) window.lucide.createIcons();
    } catch (error) {
      setStatus(error.message || "No se pudo cargar la base de prospectos.", "invalid");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("[data-prospect-search]").addEventListener("submit", (event) => {
      event.preventDefault();
      state.query = String(new FormData(event.currentTarget).get("q") || "").trim();
      state.page = 1;
      load();
    });
    document.querySelector("[data-prospect-reset]").addEventListener("click", () => {
      document.querySelector("[name='q']").value = "";
      state.query = "";
      state.page = 1;
      load();
    });
    document.querySelector("[data-prospect-prev]").addEventListener("click", () => {
      if (state.page > 1) { state.page -= 1; load(); }
    });
    document.querySelector("[data-prospect-next]").addEventListener("click", () => {
      if (state.page < state.pages) { state.page += 1; load(); }
    });
    document.querySelector("[data-prospect-list]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-prospect-view]");
      if (button) openDetail(button.dataset.prospectView);
    });
    document.querySelector("[data-prospect-close]").addEventListener("click", () => {
      document.querySelector("[data-prospect-dialog]").close();
    });
    load();
  });
})();
