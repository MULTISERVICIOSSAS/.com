(function () {
  const fallbackCertificates = [
    {
      codigo: "MS-2026-0001",
      nombre: "Nombre del estudiante",
      documento_parcial: "****1234",
      curso: "Manipulacion de Alimentos",
      fecha_emision: "2026-03-21",
      fecha_vencimiento: "2027-03-21",
      estado: "Activo",
      url_pdf: "",
      qr: ""
    }
  ];

  function normalize(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function isStaticPublicHost() {
    const host = window.location.hostname;
    return window.location.protocol === "file:" || host.endsWith("github.io");
  }

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function maskDocument(value) {
    const digits = onlyDigits(value);
    if (digits.length >= 4) return "****" + digits.slice(-4);
    return String(value || "No publicado");
  }

  function normalizeCertificate(item) {
    const codigo = item.codigo || item.codigo_unico || item.code || "";
    const documentoParcial = item.documento_parcial || item.documentoParcial || item.documento || item.document || "";
    return {
      codigo,
      nombre: item.nombre || item.nombre_estudiante || item.titular || "No publicado",
      documento_parcial: maskDocument(documentoParcial),
      curso: item.curso || item.course || "No publicado",
      fecha_emision: item.fecha_emision || item.fechaEmision || item.emision || "No publicada",
      fecha_vencimiento: item.fecha_vencimiento || item.fechaVencimiento || item.vencimiento || "",
      estado: item.estado || item.status || "Activo",
      url_pdf: item.url_pdf || item.archivo_pdf_url || "",
      validation_url: item.validation_url || item.validationUrl || "",
      qr: item.qr || item.qr_url || ""
    };
  }

  function isActiveStatus(status) {
    return ["ACTIVO", "VALIDO", "VIGENTE"].includes(normalize(status));
  }

  function documentMatches(cert, enteredDocument) {
    const entered = onlyDigits(enteredDocument).slice(-4);
    if (!entered) return true;
    return onlyDigits(cert.documento_parcial).slice(-4) === entered;
  }

  async function loadStaticCertificates() {
    try {
      const response = await fetch("data/certificados.json", { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo cargar data/certificados.json");
      const data = await response.json();
      return Array.isArray(data) ? data : fallbackCertificates;
    } catch (error) {
      return fallbackCertificates;
    }
  }

  function loadLocalGeneratedCertificates() {
    try {
      return JSON.parse(localStorage.getItem("msGeneratedCertificates") || "[]");
    } catch (error) {
      return [];
    }
  }

  function decodeBase64Url(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(padded), (char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function loadCertificateFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get("cert");
      if (!encoded) return [];
      const parsed = JSON.parse(decodeBase64Url(encoded));
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch (error) {
      return [];
    }
  }

  async function loadCertificates() {
    const base = await loadStaticCertificates();
    const local = loadLocalGeneratedCertificates();
    const fromUrl = loadCertificateFromUrl();
    const merged = [...fromUrl, ...local, ...base].map(normalizeCertificate);
    const byCode = new Map();
    merged.forEach((cert) => {
      const key = normalize(cert.codigo);
      if (key && !byCode.has(key)) byCode.set(key, cert);
    });
    return Array.from(byCode.values());
  }

  function apiBaseUrl() {
    const cfg = window.MULTISERVICIOS_CONFIG || {};
    const base = String(cfg.certificadosApiUrl || "").trim().replace(/\/$/, "");
    if (isStaticPublicHost() && base.startsWith("/")) return "";
    return base;
  }

  async function validateWithApi(code, documentValue) {
    const base = apiBaseUrl();
    if (!base) return null;
    const params = new URLSearchParams();
    if (code) params.set("codigo", code);
    if (documentValue) params.set("documento", documentValue);
    const response = await fetch(base + "/certificados/validar?" + params.toString(), { cache: "no-store" });
    if ([404, 405, 501].includes(response.status)) return null;
    if (!response.ok) throw new Error("No se pudo consultar la API de certificados");
    const payload = await response.json();
    const cert = payload.certificado || payload.data || payload;
    return cert && (cert.codigo || cert.codigo_unico || cert.code) ? { found: true, cert: normalizeCertificate(cert) } : { found: false };
  }

  async function validateLocally(code, documentValue) {
    const certificates = await loadCertificates();
    const normalizedCode = normalize(code);
    if (normalizedCode) {
      const cert = certificates.find((item) => normalize(item.codigo) === normalizedCode);
      return cert ? { found: true, cert } : { found: false };
    }
    const doc = onlyDigits(documentValue).slice(-4);
    if (doc) {
      const cert = certificates.find((item) => onlyDigits(item.documento_parcial).slice(-4) === doc);
      return cert ? { found: true, cert } : { found: false };
    }
    return { found: false };
  }

  function renderResult(target, cert, enteredDocument) {
    const matches = documentMatches(cert, enteredDocument);
    const active = isActiveStatus(cert.estado);
    const ok = active && matches;
    target.className = "validation-result show " + (ok ? "valid" : "invalid");
    const statusClass = active ? "green" : "gold";
    const title = ok ? "Certificado valido" : "Revision requerida";
    const documentNote = matches
      ? "La informacion ingresada coincide con el registro disponible."
      : "El codigo existe, pero el documento ingresado no coincide con el dato parcial registrado.";

    target.innerHTML = `
      <h3>${title}</h3>
      <p>Este certificado se encontro en la base de validacion de Multiservicios.</p>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><th>Codigo</th><td>${escapeHtml(cert.codigo)}</td></tr>
            <tr><th>Titular</th><td>${escapeHtml(cert.nombre)}</td></tr>
            <tr><th>Documento</th><td>${escapeHtml(cert.documento_parcial || "No publicado")}</td></tr>
            <tr><th>Curso</th><td>${escapeHtml(cert.curso)}</td></tr>
            <tr><th>Fecha de emision</th><td>${escapeHtml(cert.fecha_emision)}</td></tr>
            <tr><th>Fecha de vencimiento</th><td>${escapeHtml(cert.fecha_vencimiento || "No publicada")}</td></tr>
            <tr><th>Estado</th><td><span class="badge ${statusClass}">${escapeHtml(cert.estado)}</span></td></tr>
          </tbody>
        </table>
      </div>
      <p>${documentNote}</p>
      <p><strong>Privacidad:</strong> la consulta publica muestra datos minimos y no expone documentos completos.</p>
    `;
  }

  function renderNotFound(target) {
    target.className = "validation-result show invalid";
    target.innerHTML = `
      <h3>No encontramos ese certificado</h3>
      <p>Verifica el codigo y los ultimos digitos del documento. Si el certificado fue generado hace poco, publica la base de certificados desde el panel administrativo.</p>
    `;
  }

  function renderError(target) {
    target.className = "validation-result show invalid";
    target.innerHTML = `
      <h3>No se pudo validar en este momento</h3>
      <p>Intenta de nuevo o comunicate con Multiservicios para revisar el certificado manualmente.</p>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str || "");
    return div.innerHTML;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("[data-validation-form]");
    const result = document.querySelector("[data-validation-result]");
    if (!form || !result) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const code = String(data.get("codigo") || "").trim();
      const documentValue = String(data.get("documento") || "").trim();
      if (!code && !documentValue) {
        renderNotFound(result);
        return;
      }

      try {
        const apiResult = await validateWithApi(code, documentValue).catch(() => null);
        const validation = apiResult && apiResult.found ? apiResult : await validateLocally(code, documentValue);
        if (validation.found) renderResult(result, validation.cert, documentValue);
        else renderNotFound(result);
      } catch (error) {
        console.error(error);
        renderError(result);
      }
    });

    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get("codigo") || params.get("code");
    if (codeFromUrl) {
      const input = form.querySelector("[name='codigo']");
      if (input) input.value = codeFromUrl;
      form.requestSubmit();
    }
  });
})();
