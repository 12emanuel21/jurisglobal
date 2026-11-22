import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPublicConfigCache } from '@/lib/public-config';
import { MOTIVOS, makeConfig, mockApi } from '@/test/fixtures';
import { ContactForm } from './ContactForm';
import { SERVICES, Services } from './Services';

describe('Services (6 áreas de servicio)', () => {
  beforeEach(() => resetPublicConfigCache());
  afterEach(() => vi.unstubAllGlobals());

  it('muestra las 6 áreas en orden; la primera es el foco principal', () => {
    render(<Services />);
    const cards = within(screen.getByRole('list', { name: 'Áreas de servicio' })).getAllByRole('listitem', { name: '' }).filter((li) => li.dataset.testid);
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Datacrédito y centrales de riesgo',
      'Insolvencia y negociación de deudas',
      'Reestructuración financiera',
      'Procesos judiciales y embargos',
      'Derecho laboral y empresarial',
      'Derecho civil, familia y tránsito',
    ]);
    expect(cards[0]).toHaveTextContent('Foco principal');
    expect(cards[0]).toHaveTextContent('Diagnóstico en Datacrédito y TransUnion');
    expect(cards.slice(1).some((c) => c.textContent?.includes('Foco principal'))).toBe(false);
    expect(cards[5]).toHaveTextContent('Impugnación y prescripción de multas de tránsito');
  });

  it('cada área apunta a un motivo existente (máx. 20 caracteres, como en la semilla del backend)', () => {
    const names = MOTIVOS.map((m) => m.name);
    for (const s of SERVICES) {
      expect(names).toContain(s.motivo);
      expect(s.motivo.length).toBeLessThanOrEqual(20);
    }
  });

  it('el detalle de Centrales de riesgo tiene los 7 puntos y la tarjeta 1 lo abre', async () => {
    const user = userEvent.setup();
    render(<Services />);
    const details = screen.getByText('Ver detalle de servicios por área').closest('details')!;
    expect(details.open).toBe(false);
    const section = screen.getByRole('region', { name: 'Centrales de riesgo y recuperación crediticia' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(7);
    expect(section).toHaveTextContent('Habeas data financiero: reclamaciones por vulneración del derecho a conocer');
    await user.click(screen.getByRole('link', { name: 'Ver detalle del servicio' }));
    expect(details.open).toBe(true);
    expect(screen.getAllByRole('link', { name: 'Ver detalle del servicio' })).toHaveLength(1); // solo las áreas con desglose
  });

  it('«Consultar sobre…» preselecciona el área en el formulario', async () => {
    const user = userEvent.setup();
    mockApi(makeConfig());
    render(
      <>
        <Services />
        <ContactForm />
      </>,
    );
    const select = await screen.findByLabelText('Motivo de tu consulta');
    const expected: Array<[string, string]> = [
      ['Consultar sobre Datacrédito y centrales de riesgo', 'm-centrales'],
      ['Consultar sobre insolvencia y negociación de deudas', 'm-insolvencia'],
      ['Consultar sobre reestructuración financiera', 'm-reestructuracion'],
      ['Consultar sobre procesos judiciales y embargos', 'm-procesos'],
      ['Consultar sobre derecho laboral y empresarial', 'm-laboral'],
      ['Consultar sobre derecho civil, familia y tránsito', 'm-familia'],
    ];
    for (const [name, id] of expected) {
      const link = within(screen.getByRole('list', { name: 'Áreas de servicio' })).getByRole('link', { name });
      expect(link).toHaveAttribute('href', '#contacto');
      await user.click(link);
      await waitFor(() => expect(select).toHaveValue(id));
    }
  });
});
