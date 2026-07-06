(function () {
  const cfg = window.MULTISERVICIOS_CONFIG || {};

  function apiBaseUrl() {
    return String(cfg.certificadosAdminApiUrl || cfg.certificadosApiUrl || "").trim().replace(/\/$/, "");
  }

  function isGithubPagesHost() {
    return window.location.hostname.endsWith("github.io");
  }

  function githubPublishConfig() {
    return {
      owner: cfg.githubOwner || "MULTISERVICIOSSAS",
      repo: cfg.githubRepo || ".com",
      branch: cfg.githubBranch || "main",
      paths: cfg.githubCertificatePaths || ["data/certificados.json", "public/data/certificados.json"]
    };
  }

  function githubToken(interactive = true) {
    const key = "msGithubPublishToken";
    let token = localStorage.getItem(key) || "";
    if (token || !interactive || !isGithubPagesHost()) return token;
    token = window.prompt(
      "Para publicar la base de certificados en GitHub Pages, pega un token de GitHub con permiso Contents: Read and write para MULTISERVICIOSSAS/.com. Se guarda solo en este navegador."
    );
    token = String(token || "").trim();
    if (token) localStorage.setItem(key, token);
    return token;
  }

  function encodeBase64(value) {
    return btoa(unescape(encodeURIComponent(value)));
  }

  function decodeBase64(value) {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(String(value || "").replace(/\s/g, "")), (char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function githubApiUrl(path, repo) {
    return `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  async function readGithubJson(path, token, repo) {
    const response = await fetch(githubApiUrl(path, repo) + "?ref=" + encodeURIComponent(repo.branch), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token
      },
      cache: "no-store"
    });
    if (response.status === 404) return { sha: null, data: [] };
    if (!response.ok) throw new Error(`GitHub no permitio leer ${path} (${response.status})`);
    const payload = await response.json();
    let data = [];
    try {
      data = JSON.parse(decodeBase64(payload.content || ""));
    } catch (error) {
      data = [];
    }
    return { sha: payload.sha, data: Array.isArray(data) ? data : [] };
  }

  async function writeGithubJson(path, token, repo, data, sha) {
    const body = {
      message: `Actualizar base publica de certificados (${data.length})`,
      content: encodeBase64(JSON.stringify(data, null, 2)),
      branch: repo.branch
    };
    if (sha) body.sha = sha;
    const response = await fetch(githubApiUrl(path, repo), {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`GitHub no permitio escribir ${path} (${response.status})`);
    return response.json();
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
      codigo_unico: row.codigo || row.codigo_unico || "",
      nombre: row.nombre || row.nombre_estudiante || row.titular || "No publicado",
      nombre_estudiante: row.nombre || row.nombre_estudiante || row.titular || "No publicado",
      documento_parcial: partial,
      curso: row.curso || "Manipulacion de Alimentos",
      intensidad_horaria: row.intensidad_horaria || "",
      fecha_emision: row.fecha_emision || row.fechaISO || "",
      fecha_vencimiento: row.fecha_vencimiento || row.fechaVencimientoISO || "",
      estado: row.estado || "Activo",
      url_pdf: "",
      archivo_pdf_url: "",
      qr: row.qr || row.qr_url || "",
      qr_url: row.qr_url || row.qr || "",
      validation_url: row.validation_url || row.validationUrl || ""
    };
  }

  function mergePublicCertificates(base, additions) {
    const byCode = new Map();
    [...(additions || []), ...(base || [])].map(normalizePublicCertificate).forEach((row) => {
      const key = String(row.codigo || "").trim().toUpperCase();
      if (key && !byCode.has(key)) byCode.set(key, row);
    });
    return Array.from(byCode.values());
  }

  async function publishPublicJsonToGithub(data) {
    const token = githubToken(true);
    if (!token) throw new Error("Token de GitHub no configurado");
    const repo = githubPublishConfig();
    for (const path of repo.paths) {
      const current = await readGithubJson(path, token, repo);
      const merged = mergePublicCertificates(current.data, data);
      await writeGithubJson(path, token, repo, merged, current.sha);
    }
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
      const publishJson = event.target.closest("[data-publish-certificates-json]");
      if (publishJson) {
        try {
          const payload = await apiJson("/admin/certificados/publicar-base", {
            method: "POST",
            body: "{}"
          });
          if (!payload || !payload.ok) throw new Error("Backend no disponible");
          const total = payload?.total ?? 0;
          if (exportStatus) exportStatus.textContent = `Base publica actualizada con ${total} certificado(s). Sube el commit a GitHub para que funcione en todos los dispositivos.`;
        } catch (error) {
          const data = await buildPublicCertificatesJson();
          try {
            await publishPublicJsonToGithub(data);
            if (exportStatus) {
              exportStatus.textContent = `Base publica enviada a GitHub con ${data.length} certificado(s). Espera cerca de 1 minuto y valida por codigo.`;
            }
          } catch (githubError) {
            downloadJson("certificados.json", data);
            if (exportStatus) {
              exportStatus.textContent = `No se pudo publicar en GitHub. Se descargo certificados.json con ${data.length} certificado(s) para subirlo al repositorio.`;
            }
          }
        }
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
