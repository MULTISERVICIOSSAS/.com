import assert from "node:assert/strict";
import test from "node:test";
import {
  constantTimeEqual,
  documentLast4,
  hmacHex,
  maskDocument,
  publicCertificateUrls,
  slugify
} from "../cloudflare/src/utils.js";

test("protege y normaliza documentos", async () => {
  assert.equal(documentLast4("CC 1.234.567.890"), "7890");
  assert.equal(maskDocument("1.234.567.890"), "****7890");
  const hash = await hmacHex("secreto", "1234567890");
  assert.equal(hash.length, 64);
  assert.equal(hash, await hmacHex("secreto", "1234567890"));
  assert.notEqual(hash, await hmacHex("otro", "1234567890"));
});

test("genera rutas publicas del dominio oficial", () => {
  const urls = publicCertificateUrls("https://multiservicios.website/", "ms-123");
  assert.equal(urls.validationUrl, "https://multiservicios.website/validar-certificado.html?codigo=MS-123");
  assert.match(urls.qrUrl, /^https:\/\/api\.qrserver\.com/);
  assert.match(urls.qrUrl, /MS-123/);
});

test("utilidades comparan y crean slugs estables", () => {
  assert.equal(slugify("Manipulacion de Alimentos"), "manipulacion-de-alimentos");
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
});
