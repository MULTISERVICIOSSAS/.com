(function () {
  const cfg = window.MULTISERVICIOS_CONFIG || {};
  const statKeys = [
    "certificates",
    "course_results",
    "annulled",
    "customers",
    "pending_requests",
    "pending_payments",
    "approved_exams",
    "active_services"
  ];

  function apiBaseUrl() {
    return String(cfg.certificadosAdminApiUrl || cfg.certificadosApiUrl || "").trim().replace(/\/$/, "");
  }

  function emptyStats() {
    return {
      certificates: 0,
      course_results: 0,
      annulled: 0,
      customers: 0,
      pending_requests: 0,
      pending_payments: 0,
      approved_exams: 0,
      active_services: 0
    };
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function readArray(key) {
    try {
      const data = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  function arrayFromPayload(payload, keys) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
  }

  async function fetchJsonArray(url, keys) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("No disponible");
      return arrayFromPayload(await response.json(), keys);
    } catch (error) {
      return [];
    }
  }

  async function apiJson(path) {
    const base = apiBaseUrl();
    if (!base) return null;
    try {
      const response = await fetch(base + path, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("API no disponible");
      return response.json();
    } catch (error) {
      return null;
    }
  }

  function certCode(row, index) {
    const code = row && (row.codigo || row.codigo_unico || row.codigoCertificado || row.code);
    if (code) return "cert:" + String(code).trim().toUpperCase();
    return "cert:sin-codigo:" + index;
  }

  function resultKey(row, index) {
    const parts = [row.documento, row.documento_masked, row.documento_parcial, row.nombre, row.fecha, row.porcentaje, row.estado]
      .map((part) => String(part || "").trim().toUpperCase())
      .filter(Boolean);
    return parts.length ? "result:" + parts.join("|") : "result:" + index;
  }

  function mergeByKey(groups, keyFn) {
    const map = new Map();
    groups.flat().forEach((row, index) => {
      const key = keyFn(row || {}, index);
      if (!map.has(key)) map.set(key, row);
    });
    return Array.from(map.values());
  }

  function isAnnulled(row) {
    return String(row.estado || row.status || "").toLowerCase().includes("anulad");
  }

  function isApproved(row) {
    return String(row.estado || row.status || "").toLowerCase().includes("aprob");
  }

  function isPending(row) {
    const state = String(row.estado || row.payment_status || row.status || "").toLowerCase();
    return !state || state.includes("pendiente") || state.includes("manual");
  }

  function isActive(row) {
    const state = String(row.estado || row.status || "Activo").toLowerCase();
    return !state.includes("inactivo") && !state.includes("anulado");
  }

  async function loadCertificates() {
    const apiData = arrayFromPayload(await apiJson("/admin/certificados"), ["certificados", "certificates"]);
    const publicData = await fetchJsonArray("../data/certificados.json", ["certificados", "certificates"]);
    const localData = readArray("msGeneratedCertificates");
    return mergeByKey([localData, apiData, publicData], certCode);
  }

  async function loadResults() {
    const apiData = arrayFromPayload(await apiJson("/admin/resultados"), ["resultados", "results", "course_results"]);
    const localData = readArray("msCourseResults");
    return mergeByKey([localData, apiData], resultKey);
  }

  async function loadApiList(path, keys) {
    return arrayFromPayload(await apiJson(path), keys);
  }

  async function buildStats() {
    const stats = emptyStats();
    const apiStats = await apiJson("/admin/stats");
    if (apiStats && typeof apiStats === "object") {
      statKeys.forEach((key) => {
        stats[key] = toNumber(apiStats[key]);
      });
    }

    const [certificates, results, customers, requests, companies, payments, apiServices, staticServices] = await Promise.all([
      loadCertificates(),
      loadResults(),
      loadApiList("/admin/clientes", ["clientes", "customers"]),
      loadApiList("/admin/solicitudes", ["solicitudes", "requests"]),
      loadApiList("/admin/empresas", ["empresas", "companies"]),
      loadApiList("/admin/pagos", ["pagos", "payments"]),
      loadApiList("/admin/servicios", ["servicios", "services"]),
      fetchJsonArray("../data/servicios.json", ["servicios", "services"])
    ]);

    if (certificates.length) {
      stats.certificates = Math.max(stats.certificates, certificates.length);
      stats.annulled = Math.max(stats.annulled, certificates.filter(isAnnulled).length);
    }
    if (results.length) {
      stats.course_results = Math.max(stats.course_results, results.length);
      stats.approved_exams = Math.max(stats.approved_exams, results.filter(isApproved).length);
    }
    if (customers.length) stats.customers = Math.max(stats.customers, customers.length);

    const pendingRequests = requests.filter(isPending).length + companies.filter(isPending).length;
    if (pendingRequests) stats.pending_requests = Math.max(stats.pending_requests, pendingRequests);
    if (payments.length) stats.pending_payments = Math.max(stats.pending_payments, payments.filter(isPending).length);

    const services = apiServices.length ? apiServices : staticServices;
    if (services.length) stats.active_services = services.filter(isActive).length;

    return stats;
  }

  function setStats(stats) {
    statKeys.forEach((key) => {
      const node = document.querySelector(`[data-stat='${key.replace(/_/g, "-")}']`);
      if (node) node.textContent = toNumber(stats[key]);
    });
  }

  async function refreshStats() {
    setStats(await buildStats());
  }

  document.addEventListener("DOMContentLoaded", () => {
    refreshStats();
    window.addEventListener("focus", refreshStats);
    window.addEventListener("pageshow", refreshStats);
    window.addEventListener("storage", (event) => {
      if (["msGeneratedCertificates", "msCourseResults"].includes(event.key)) refreshStats();
    });
  });
})();
