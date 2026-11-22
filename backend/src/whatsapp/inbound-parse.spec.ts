import { parseInboundMessage, webhookValues } from './inbound-parse';

describe('Parseo de mensajes entrantes de Cloud API', () => {
  it('texto', () => {
    const m = parseInboundMessage({
      id: 'wamid.1',
      from: '573001234567',
      timestamp: '1763800000',
      type: 'text',
      text: { body: ' Hola ' },
    });
    expect(m).toMatchObject({
      waMessageId: 'wamid.1',
      from: '573001234567',
      type: 'text',
      text: 'Hola',
      interactiveId: null,
      media: null,
    });
    expect(m?.timestamp?.toISOString()).toBe(new Date(1763800000 * 1000).toISOString());
  });

  it('respuesta de botón y de lista: conserva el id', () => {
    expect(
      parseInboundMessage({
        id: 'w',
        from: '57',
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'consent_yes', title: 'Acepto' } },
      }),
    ).toMatchObject({ text: 'Acepto', interactiveId: 'consent_yes' });
    expect(
      parseInboundMessage({
        id: 'w',
        from: '57',
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'm-transito', title: 'Tránsito' } },
      }),
    ).toMatchObject({ text: 'Tránsito', interactiveId: 'm-transito' });
    // Botón de una plantilla (p. ej. "Dejar de recibir")
    expect(
      parseInboundMessage({
        id: 'w',
        from: '57',
        type: 'button',
        button: { text: 'Dejar de recibir', payload: 'STOP' },
      }),
    ).toMatchObject({
      text: 'Dejar de recibir',
      interactiveId: 'STOP',
    });
  });

  it('nota de voz, documento con caption y ubicación', () => {
    expect(
      parseInboundMessage({
        id: 'w',
        from: '57',
        type: 'audio',
        audio: { id: 'media1', mime_type: 'audio/ogg; codecs=opus' },
      })?.media,
    ).toEqual({
      type: 'audio',
      id: 'media1',
      mime: 'audio/ogg; codecs=opus',
      filename: null,
    });
    const doc = parseInboundMessage({
      id: 'w',
      from: '57',
      type: 'document',
      document: { id: 'm2', filename: 'multa.pdf', caption: 'mi multa' },
    });
    expect(doc).toMatchObject({ text: 'mi multa', media: { type: 'document', filename: 'multa.pdf' } });
    expect(
      parseInboundMessage({ id: 'w', from: '57', type: 'location', location: { latitude: 10.96, longitude: -74.78 } })
        ?.text,
    ).toBe('📍 Ubicación: 10.96, -74.78');
  });

  it('payload inválido -> null; recorre todas las entradas y cambios', () => {
    expect(parseInboundMessage({ from: '57' })).toBeNull();
    const values = webhookValues({
      entry: [{ changes: [{ value: { a: 1 } }, { value: { b: 2 } }] }, { changes: [{ value: { c: 3 } }] }],
    });
    expect(values).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(webhookValues({})).toEqual([]);
  });
});
