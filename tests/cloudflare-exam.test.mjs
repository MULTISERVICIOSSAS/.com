import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExamEvidence,
  EXAM_PASS_PERCENTAGE,
  FINAL_EXAM,
  parseExamEvidence
} from "../cloudflare/src/exam.js";
import { createCertificate } from "../cloudflare/src/index.js";

const correctAnswers = () => FINAL_EXAM.map((question) => question.answer);

test("the required passing percentage is 80", () => {
  assert.equal(EXAM_PASS_PERCENTAGE, 80);
});

test("builds complete evidence for a perfect exam", () => {
  const evidence = buildExamEvidence(correctAnswers());

  assert.equal(evidence.puntaje, 20);
  assert.equal(evidence.total, 20);
  assert.equal(evidence.porcentaje, 100);
  assert.equal(evidence.aprobado, true);
  assert.equal(evidence.preguntas.length, 20);
  assert.ok(evidence.preguntas.every((question) => question.correcta));
  assert.equal(evidence.preguntas[0].respuesta_correcta, "Mojarse las manos");
});

test("approves exactly sixteen correct answers", () => {
  const answers = correctAnswers();
  for (let index = 0; index < 4; index += 1) {
    answers[index] = answers[index] === 0 ? 1 : 0;
  }
  const evidence = buildExamEvidence(answers);

  assert.equal(evidence.puntaje, 16);
  assert.equal(evidence.porcentaje, 80);
  assert.equal(evidence.aprobado, true);
  assert.equal(evidence.preguntas[0].correcta, false);
  assert.notEqual(evidence.preguntas[0].respuesta_elegida, evidence.preguntas[0].respuesta_correcta);
});

test("rejects an exam below sixteen correct answers", () => {
  const answers = correctAnswers();
  for (let index = 0; index < 5; index += 1) {
    answers[index] = answers[index] === 0 ? 1 : 0;
  }
  const evidence = buildExamEvidence(answers);

  assert.equal(evidence.puntaje, 15);
  assert.equal(evidence.porcentaje, 75);
  assert.equal(evidence.aprobado, false);
});

test("rejects incomplete or invalid answer payloads", () => {
  assert.equal(buildExamEvidence(correctAnswers().slice(0, 19)), null);
  const invalid = correctAnswers();
  invalid[4] = 9;
  assert.equal(buildExamEvidence(invalid), null);
});

test("parses only complete evidence documents", () => {
  const evidence = buildExamEvidence(correctAnswers());
  assert.deepEqual(parseExamEvidence(JSON.stringify(evidence)), evidence);
  assert.equal(parseExamEvidence('{"preguntas":[]}'), null);
  assert.equal(parseExamEvidence("not-json"), null);
});

test("keeps complete evidence available below the passing percentage", () => {
  const answers = correctAnswers();
  for (let index = 0; index < 5; index += 1) {
    answers[index] = answers[index] === 0 ? 1 : 0;
  }
  const evidence = buildExamEvidence(answers);

  assert.equal(evidence.porcentaje, 75);
  assert.equal(evidence.aprobado, false);
  assert.deepEqual(parseExamEvidence(JSON.stringify(evidence)), evidence);
});

test("creates a certificate without an exam result", async () => {
  const executedSql = [];
  let storedCertificate = null;
  const db = {
    prepare(sql) {
      executedSql.push(sql);
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          const [code, name, documentHash, last4, masked, course, intensity, issued, expires, state, qrUrl,
            validationUrl, createdAt, updatedAt, resultId] = this.values;
          storedCertificate = {
            id: 1,
            codigo_unico: code,
            nombre_estudiante: name,
            documento_hash: documentHash,
            documento_last4: last4,
            documento_masked: masked,
            curso: course,
            intensidad_horaria: intensity,
            fecha_emision: issued,
            fecha_vencimiento: expires,
            estado: state,
            qr_url: qrUrl,
            validation_url: validationUrl,
            fecha_creacion: createdAt,
            fecha_actualizacion: updatedAt,
            course_result_id: resultId,
            pdf_key: null,
            motivo_anulacion: null
          };
          return { meta: { changes: 1, last_row_id: 1 } };
        },
        async first() {
          return storedCertificate;
        }
      };
    }
  };
  const request = new Request("https://multiservicios.website/api/admin/certificados", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      codigo: "MS-SINEXAMEN",
      nombre: "Persona Sin Examen",
      documento: "123456789",
      curso: "Manipulacion de Alimentos",
      fecha_emision: "2026-07-15",
      fecha_vencimiento: "2027-07-15"
    })
  });

  const response = await createCertificate(request, {
    DB: db,
    DOCUMENT_HASH_KEY: "test-secret",
    PUBLIC_URL: "https://multiservicios.website"
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.ok, true);
  assert.equal(payload.certificado.resultado_id, null);
  assert.equal(storedCertificate.nombre_estudiante, "Persona Sin Examen");
  assert.equal(executedSql.some((sql) => sql.includes("course_results")), false);
});
