(function () {
  const cfg = window.MULTISERVICIOS_CONFIG || {};

  function apiBaseUrl() {
    return String(cfg.certificadosAdminApiUrl || cfg.certificadosApiUrl || "").trim().replace(/\/$/, "");
  }

  async function apiJson(path, options = {}) {
    const base = apiBaseUrl();
    if (!base) return null;
    const response = await fetch(base + path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    if (!response.ok) throw new Error("API no disponible");
    return response.json();
  }

  function readCourseResultsLocal() {
    try {
      return JSON.parse(localStorage.getItem("msCourseResults") || "[]");
    } catch (error) {
      return [];
    }
  }

  function readGeneratedCertificatesLocal() {
    try {
      return JSON.parse(localStorage.getItem("msGeneratedCertificates") || "[]");
    } catch (error) {
      return [];
    }
  }

  function writeGeneratedCertificates(records) {
    localStorage.setItem("msGeneratedCertificates", JSON.stringify(records));
  }

  async function loadCourseResults() {
    try {
      const payload = await apiJson("/admin/resultados");
      if (payload && Array.isArray(payload.resultados)) return payload.resultados;
    } catch (error) {}
    return readCourseResultsLocal();
  }

  async function loadGeneratedCertificates() {
    try {
      const payload = await apiJson("/admin/certificados");
      if (payload && Array.isArray(payload.certificados)) return payload.certificados;
    } catch (error) {}
    return readGeneratedCertificatesLocal();
  }

  function normalizePublicCertificate(row) {
    const digits = String(row.documento || row.documento_parcial || "").replace(/\D/g, "");
    const partial = row.documento_parcial || (digits ? "****" + digits.slice(-4) : "No publicado");
    return {
      codigo: row.codigo || row.codigo_unico || "",
      nombre: row.nombre || row.nombre_estudiante || row.titular || "No publicado",
      documento_parcial: partial,
      curso: row.curso || "Manipulacion de Alimentos",
      fecha_emision: row.fecha_emision || row.fechaISO || "",
      fecha_vencimiento: row.fecha_vencimiento || row.fechaVencimientoISO || "",
      estado: row.estado || "Activo",
      url_pdf: "",
      qr: row.qr || row.qr_url || "",
      validation_url: row.validation_url || row.validationUrl || ""
    };
  }

  async function readPublicJsonBase() {
    try {
      const response = await fetch("../data/certificados.json", { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo leer data/certificados.json");
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  async function buildPublicCertificatesJson() {
    const base = await readPublicJsonBase();
    const generated = await loadGeneratedCertificates();
    const merged = [...generated, ...base].map(normalizePublicCertificate);
    const byCode = new Map();
    merged.forEach((row) => {
      const key = String(row.codigo || "").trim().toUpperCase();
      if (key && !byCode.has(key)) byCode.set(key, row);
    });
    return Array.from(byCode.values());
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function renderResultsTable() {
    const target = document.querySelector("[data-course-results]");
    if (!target) return;
    const rows = await loadCourseResults();
    if (!rows.length) {
      target.innerHTML = `<p class="section-lead">Aun no hay resultados guardados.</p>`;
      return;
    }
    target.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Documento</th>
              <th>Telefono</th>
              <th>Resultado</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                <tr>
                  <td>${escapeHtml(row.nombre)}</td>
                  <td>${escapeHtml(row.documento)}</td>
                  <td>${escapeHtml(row.telefono)}</td>
                  <td><span class="badge ${row.estado === "Aprobado" ? "green" : "gold"}">${escapeHtml(row.estado)} · ${escapeHtml(row.porcentaje)}%</span></td>
                  <td>${escapeHtml(row.fecha)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  async function renderGeneratedCertificates(filter = "") {
    const target = document.querySelector("[data-generated-certificates]");
    if (!target) return;
    const query = String(filter || "").trim().toLowerCase();
    const rows = (await loadGeneratedCertificates()).filter((row) => {
      const haystack = [row.codigo, row.codigo_unico, row.nombre, row.nombre_estudiante, row.documento_parcial, row.curso, row.estado]
        .join(" ")
        .toLowerCase();
      return !query || haystack.includes(query);
    });
    if (!rows.length) {
      target.innerHTML = `<p class="section-lead">No hay certificados emitidos.</p>`;
      return;
    }
    target.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Titular</th>
              <th>Documento</th>
              <th>Curso</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((row) => {
                const code = row.codigo || row.codigo_unico || "";
                const owner = row.nombre || row.nombre_estudiante || "";
                return `
                <tr>
                  <td>${escapeHtml(code)}</td>
                  <td>${escapeHtml(owner)}</td>
                  <td>${escapeHtml(row.documento_parcial)}</td>
                  <td>${escapeHtml(row.curso)}</td>
                  <td><span class="badge ${row.estado === "Anulado" ? "gold" : "green"}">${escapeHtml(row.estado)}</span></td>
                  <td>
                    <button class="button small secondary" data-copy-code="${escapeHtml(code)}" type="button">Copiar codigo</button>
                    <button class="button small warning" data-annul-code="${escapeHtml(code)}" type="button" ${row.estado === "Anulado" ? "disabled" : ""}>Anular</button>
                  </td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function initGeneratedCertificateTools() {
    const search = document.querySelector("[data-certificate-search]");
    const reasonInput = document.querySelector("[data-annul-reason]");
    const exportStatus = document.querySelector("[data-export-status]");
    if (search) {
      search.addEventListener("input", () => renderGeneratedCertificates(search.value));
    }
    document.addEventListener("click", async (event) => {
      const exportButton = event.target.closest("[data-export-certificates]");
      if (exportButton) {
        const data = await buildPublicCertificatesJson();
        downloadJson("certificados.json", data);
        if (exportStatus) exportStatus.textContent = `Base exportada con ${data.length} certificado(s).`;
      }
      const copyJson = event.target.closest("[data-copy-certificates-json]");
      if (copyJson) {
        const data = await buildPublicCertificatesJson();
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
        if (exportStatus) exportStatus.textContent = `JSON copiado con ${data.length} certificado(s).`;
      }
      const copy = event.target.closest("[data-copy-code]");
      if (copy) {
        await navigator.clipboard.writeText(copy.dataset.copyCode).catch(() => {});
        copy.textContent = "Copiado";
        setTimeout(() => (copy.textContent = "Copiar codigo"), 1200);
      }
      const annul = event.target.closest("[data-annul-code]");
      if (annul) {
        const typedReason = reasonInput ? reasonInput.value.trim() : "";
        if (!typedReason) {
          if (reasonInput) {
            reasonInput.focus();
            reasonInput.placeholder = "Escribe el motivo antes de anular";
          }
          return;
        }
        const code = annul.dataset.annulCode;
        try {
          await apiJson(`/admin/certificados/${encodeURIComponent(code)}/anular`, {
            method: "PATCH",
            body: JSON.stringify({ motivo: typedReason })
          });
        } catch (error) {
          const records = readGeneratedCertificatesLocal().map((row) =>
            row.codigo === code ? { ...row, estado: "Anulado", motivo_anulacion: typedReason, fecha_actualizacion: localISODate() } : row
          );
          writeGeneratedCertificates(records);
        }
        if (reasonInput) reasonInput.value = "";
        await renderGeneratedCertificates(search ? search.value : "");
      }
    });
  }

  function localISODate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str || "");
    return div.innerHTML;
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderResultsTable();
    renderGeneratedCertificates();
    initGeneratedCertificateTools();
  });
})();
