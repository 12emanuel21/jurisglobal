import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { requireEnv } from '../config/secrets';

/**
 * Cifrado de campos sensibles (p. ej. secreto TOTP) con AES-256-GCM y prefijo de versión
 * (idea de EncryptedTextField del módulo Django de referencia).
 * Formato: "enc:v1:" + base64(iv[12] | tag[16] | ciphertext)
 */
const PREFIX = 'enc:v1:';

function key(): Buffer {
  return Buffer.from(requireEnv('ENCRYPTION_KEY'), 'hex');
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptField(value: string): string {
  if (!value.startsWith(PREFIX)) throw new Error('Campo cifrado con formato desconocido');
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/**
 * Seudónimo estable de un teléfono (HMAC-SHA256 con clave derivada de ENCRYPTION_KEY).
 * Permite conservar la trazabilidad de consentimientos y bajas tras anonimizar (Ley 1581)
 * sin guardar el número: no es reversible sin la clave del servidor.
 */
export function phoneHash(e164: string): string {
  const derived = createHmac('sha256', key()).update('jurisglobal:phone-hash:v1').digest();
  return createHmac('sha256', derived).update(e164).digest('hex');
}
