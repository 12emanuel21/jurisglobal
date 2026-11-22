import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { chatMediaPath, classifyChatMedia, describeChatMedia, storeChatMedia } from './media';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n...');

describe('Adjuntos de WhatsApp', () => {
  it('clasifica por contenido real (no por el mimetype declarado)', () => {
    expect(classifyChatMedia(PNG, 'application/pdf')).toEqual({ kind: 'IMAGE', ext: 'png' });
    expect(classifyChatMedia(JPG, null)).toEqual({ kind: 'IMAGE', ext: 'jpg' });
    expect(classifyChatMedia(PDF, 'image/png')).toEqual({ kind: 'DOCUMENT', ext: 'pdf' });
    expect(classifyChatMedia(Buffer.from('OggS....'), 'audio/ogg; codecs=opus')).toEqual({ kind: 'AUDIO', ext: 'ogg' });
    expect(classifyChatMedia(Buffer.from('MZ executable'), 'application/pdf')).toBeNull();
  });

  it('guarda con nombre uuid y rechaza vacíos o no soportados', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jg-media-'));
    try {
      const stored = await storeChatMedia(PDF, 'application/pdf', '  Cédula.pdf ', root);
      expect(stored).toMatchObject({ kind: 'DOCUMENT', mime: 'application/pdf', name: 'Cédula.pdf' });
      expect(readFileSync(path.join(root, stored!.file)).equals(PDF)).toBe(true);
      expect(await storeChatMedia(Buffer.alloc(0), 'image/png', null, root)).toBeNull();
      expect(await storeChatMedia(Buffer.from('zip'), 'application/zip', null, root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('chatMediaPath bloquea nombres arbitrarios (path traversal)', () => {
    expect(chatMediaPath('../../etc/passwd')).toBeNull();
    expect(chatMediaPath('foto.png')).toBeNull();
    expect(chatMediaPath('3f2b8c1e-1111-4a4a-9b9b-0123456789ab.png')).not.toBeNull();
  });

  it('describeChatMedia', () => {
    expect(describeChatMedia('DOCUMENT', 'mi soporte', 'pago.pdf')).toBe('📄 Documento: pago.pdf\nmi soporte');
    expect(describeChatMedia('AUDIO')).toBe('🎙️ Nota de voz');
  });
});
