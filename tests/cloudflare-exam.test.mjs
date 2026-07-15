import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExamEvidence,
  EXAM_PASS_PERCENTAGE,
  FINAL_EXAM,
  parseExamEvidence
} from "../cloudflare/src/exam.js";

const correctAnswers = () => FINAL_EXAM.map((question) => question.answer);

test("the required passing percentage is 95", () => {
  assert.equal(EXAM_PASS_PERCENTAGE, 95);
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

test("approves exactly nineteen correct answers", () => {
  const answers = correctAnswers();
  answers[0] = answers[0] === 0 ? 1 : 0;
  const evidence = buildExamEvidence(answers);

  assert.equal(evidence.puntaje, 19);
  assert.equal(evidence.porcentaje, 95);
  assert.equal(evidence.aprobado, true);
  assert.equal(evidence.preguntas[0].correcta, false);
  assert.notEqual(evidence.preguntas[0].respuesta_elegida, evidence.preguntas[0].respuesta_correcta);
});

test("rejects an exam below nineteen correct answers", () => {
  const answers = correctAnswers();
  answers[0] = answers[0] === 0 ? 1 : 0;
  answers[1] = answers[1] === 0 ? 1 : 0;
  const evidence = buildExamEvidence(answers);

  assert.equal(evidence.puntaje, 18);
  assert.equal(evidence.porcentaje, 90);
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
  answers[0] = answers[0] === 0 ? 1 : 0;
  answers[1] = answers[1] === 0 ? 1 : 0;
  const evidence = buildExamEvidence(answers);

  assert.equal(evidence.porcentaje, 90);
  assert.equal(evidence.aprobado, false);
  assert.deepEqual(parseExamEvidence(JSON.stringify(evidence)), evidence);
});
