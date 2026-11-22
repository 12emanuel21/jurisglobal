import { Injectable, Logger } from '@nestjs/common';
import { generateObject, generateText, type ModelMessage } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { isOverloadError, resolveModelChain, resolveTimeoutMs, runWithModelFallback } from './model-fallback';
import { OUT_OF_FLOW_SYSTEM_PROMPT } from './prompts';

/** Respuesta breve a una pregunta fuera del flujo del formulario (ESP §6.3) */
export const OutOfFlowAnswerSchema = z.object({
  reply: z.string().describe('Respuesta breve (máx. 3 frases), sin asesoría jurídica ni promesas'),
  backToFlow: z.boolean().describe('true si hay que retomar el formulario después de responder'),
});
export type OutOfFlowAnswer = z.infer<typeof OutOfFlowAnswerSchema>;

/** Franja del día en la hora de Colombia, para un saludo natural sin decir la hora */
export function dayPartOf(
  date: Date,
  timeZone = process.env.APP_TIMEZONE || 'America/Bogota',
): 'mañana' | 'tarde' | 'noche' {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date));
  if (hour >= 5 && hour < 12) return 'mañana';
  if (hour >= 12 && hour < 19) return 'tarde';
  return 'noche';
}

/**
 * Orquestación con Gemini (reutilizada de KovalCloud): cadena de modelos con salto inmediato al
 * respaldo, sin reintentos del SDK y con tiempo máximo por intento.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private withModels<T>(
    label: string,
    call: (model: ReturnType<typeof google>, abortSignal: AbortSignal) => Promise<T>,
    timeoutMs = resolveTimeoutMs(),
  ): Promise<T> {
    return runWithModelFallback(resolveModelChain(), (modelId, abortSignal) => call(google(modelId), abortSignal), {
      timeoutMs,
      logger: this.logger,
      label,
    });
  }

  /** Transcripción de notas de voz de WhatsApp */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const cleanMimeType = mimeType.split(';')[0];
    const { text } = await this.withModels('Transcripción', (model, abortSignal) =>
      generateText({
        model,
        maxRetries: 0,
        abortSignal,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe exactamente lo que dice este audio. Solo devuelve la transcripción en español, sin comillas, introducciones ni comentarios extra. Si no entiendes nada, devuelve un string vacío.',
              },
              { type: 'file', data: audioBuffer, mediaType: cleanMimeType },
            ],
          },
        ],
      }),
    );
    return text.trim();
  }

  /**
   * Respuesta breve a una pregunta fuera del flujo del formulario. Nunca da asesoría jurídica ni
   * promete resultados, tiempos o precios cerrados. Un JSON fuera del esquema se reintenta una vez;
   * la saturación ya la resolvió la cadena de modelos.
   */
  async answerOutOfFlow(
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<OutOfFlowAnswer> {
    const messages: ModelMessage[] = [...history.slice(-10), { role: 'user', content: question }];
    const run = () =>
      this.withModels('Fuera de flujo', (model, abortSignal) =>
        generateObject({
          model,
          maxRetries: 0,
          abortSignal,
          schema: OutOfFlowAnswerSchema,
          system: OUT_OF_FLOW_SYSTEM_PROMPT,
          messages,
        }),
      );
    try {
      return (await run()).object;
    } catch (error) {
      if (isOverloadError(error) || (error as Error)?.name === 'AllModelsUnavailableError') throw error;
      this.logger.warn(`Respuesta fuera del esquema; se reintenta una vez: ${(error as Error)?.message}`);
      return (await run()).object;
    }
  }
}
