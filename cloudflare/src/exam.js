export const EXAM_PASS_PERCENTAGE = 95;

export const FINAL_EXAM = [
  { question: "¿Cuál es el primer paso para lavarse las manos?", options: ["Aplicar jabón", "Mojarse las manos", "Secarse", "Ponerse gel"], answer: 1 },
  { question: "¿Cuánto tiempo debe durar el frotado de manos con jabón?", options: ["5 seg", "10 seg", "Al menos 20 seg", "1 min"], answer: 2 },
  { question: "La Zona de Peligro de temperatura es:", options: ["0-5°C", "5-60°C", "60-100°C", "-18-0°C"], answer: 1 },
  { question: "¿Qué tabla de picar se recomienda para carnes crudas?", options: ["Verde", "Roja", "Blanca", "Azul"], answer: 1 },
  { question: "La temperatura interna segura para pollo es:", options: ["60°C", "65°C", "74°C", "50°C"], answer: 2 },
  { question: "¿Qué es contaminación cruzada?", options: ["Transferencia de patógenos de un alimento a otro", "Cocinar mucho la comida", "Congelar alimentos", "Lavar vegetales"], answer: 0 },
  { question: "¿Dónde se debe guardar la carne cruda en el refrigerador?", options: ["Arriba de todo", "En la parte inferior", "En la puerta", "Junto a las verduras"], answer: 1 },
  { question: "Si estás enfermo con vómito o diarrea, debes:", options: ["Trabajar con cuidado", "Usar doble guante", "Reportarlo y no manipular alimentos", "Tomar agua y seguir"], answer: 2 },
  { question: "¿El uso de guantes sustituye el lavado de manos?", options: ["Sí", "No", "A veces", "Solo si son de látex"], answer: 1 },
  { question: "¿Cuál es la mejor manera de descongelar pollo?", options: ["Al sol", "En agua caliente", "En el refrigerador", "Sobre el mesón"], answer: 2 },
  { question: "¿Qué significa FIFO (PEPS)?", options: ["Lo primero que entra es lo primero que sale", "Lo último que entra es lo primero que sale", "Frío intenso", "Fritura profunda"], answer: 0 },
  { question: "Los químicos de limpieza deben guardarse:", options: ["Junto a la comida", "Lejos y separados de los alimentos", "En la cocina", "Encima de las mesas"], answer: 1 },
  { question: "¿A qué temperatura se deben mantener los alimentos calientes para servir?", options: ["Mínimo 60°C", "Mínimo 40°C", "Ambiente", "Hirviendo"], answer: 0 },
  { question: "¿Cuál es un peligro físico?", options: ["Virus", "Pelo o vidrio", "Cloro", "Bacteria"], answer: 1 },
  { question: "Al recalentar sobras, la temperatura debe llegar a:", options: ["60°C", "74°C", "50°C", "80°C"], answer: 1 },
  { question: "¿Qué se debe hacer con una lata abollada?", options: ["Usarla rápido", "Hervirla", "Rechazarla o desecharla", "Enderezarla"], answer: 2 },
  { question: "El agua utilizada para cocinar debe ser:", options: ["De río", "Potable", "De lluvia", "Cualquiera"], answer: 1 },
  { question: "¿Las plagas buscan principalmente?", options: ["Luz", "Ruido", "Agua, comida y refugio", "Frio"], answer: 2 },
  { question: "¿Cuándo se debe cambiar el uniforme?", options: ["Cada semana", "Diariamente o cuando esté sucio", "Cada mes", "Nunca"], answer: 1 },
  { question: "La desinfección reduce:", options: ["La suciedad visible", "Los microorganismos a nivel seguro", "El sabor", "El color"], answer: 1 }
];

export function buildExamEvidence(rawAnswers) {
  if (!Array.isArray(rawAnswers) || rawAnswers.length !== FINAL_EXAM.length) return null;
  const answers = rawAnswers.map((value) => Number(value));
  if (answers.some((value) => !Number.isInteger(value) || value < 0 || value > 3)) return null;

  const questions = FINAL_EXAM.map((item, index) => {
    const selected = answers[index];
    return {
      numero: index + 1,
      pregunta: item.question,
      respuesta_elegida_indice: selected,
      respuesta_elegida: item.options[selected],
      respuesta_correcta_indice: item.answer,
      respuesta_correcta: item.options[item.answer],
      correcta: selected === item.answer
    };
  });
  const score = questions.filter((item) => item.correcta).length;
  const percentage = Math.round(score / FINAL_EXAM.length * 100);
  return {
    version: 1,
    total: FINAL_EXAM.length,
    puntaje: score,
    porcentaje: percentage,
    aprobado: percentage >= EXAM_PASS_PERCENTAGE,
    preguntas: questions
  };
}

export function parseExamEvidence(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || !Array.isArray(parsed.preguntas) || parsed.preguntas.length !== FINAL_EXAM.length) return null;
    return parsed;
  } catch {
    return null;
  }
}
