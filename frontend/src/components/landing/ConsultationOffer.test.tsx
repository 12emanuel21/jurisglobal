import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPublicConfigCache } from '@/lib/public-config';
import { makeConfig, mockApi } from '@/test/fixtures';
import { ConsultationOffer } from './ConsultationOffer';

describe('ConsultationOffer (precio dinámico de la asesoría inicial)', () => {
  beforeEach(() => resetPublicConfigCache());
  afterEach(() => vi.unstubAllGlobals());

  it('interruptor encendido con valor: muestra el precio en pesos colombianos', async () => {
    mockApi(makeConfig({ showConsultationPrice: true, consultationPrice: 100000 }));
    render(<ConsultationOffer />);
    expect(await screen.findByText('$100.000 COP')).toBeInTheDocument();
    expect(screen.getByText('Asesoría inicial')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agendar mi asesoría' })).toHaveAttribute('href', '#contacto');
  });

  it('interruptor apagado: llamado neutro, sin precio y sin afirmar "gratis"', async () => {
    mockApi(makeConfig({ showConsultationPrice: false, consultationPrice: 100000 }));
    render(<ConsultationOffer />);
    expect(await screen.findByText('Solicita la valoración inicial de tu caso')).toBeInTheDocument();
    const block = screen.getByTestId('consultation-offer');
    expect(block).not.toHaveTextContent('$');
    expect(block).not.toHaveTextContent(/gratis|sin costo|gratuit/i);
    expect(screen.getByRole('link', { name: 'Solicitar valoración' })).toBeInTheDocument();
  });

  it('encendido pero sin valor configurado: no inventa un precio', async () => {
    mockApi(makeConfig({ showConsultationPrice: true, consultationPrice: null }));
    render(<ConsultationOffer />);
    expect(await screen.findByText('Solicita la valoración inicial de tu caso')).toBeInTheDocument();
    expect(screen.getByTestId('consultation-offer')).not.toHaveTextContent('$');
  });

  it('configuración no disponible: también cae en el llamado neutro', async () => {
    mockApi(null);
    render(<ConsultationOffer />);
    expect(await screen.findByText('Solicita la valoración inicial de tu caso')).toBeInTheDocument();
  });
});
