export type Feedback = { ok: boolean; text: string } | null;

/** Resultado de guardar (éxito en verde, error en rojo, anunciado a lectores de pantalla) */
export function SaveFeedback({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p role={feedback.ok ? 'status' : 'alert'} className={`text-sm ${feedback.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
      {feedback.text}
    </p>
  );
}
