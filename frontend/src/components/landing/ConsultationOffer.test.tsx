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

  it('interruptor apagado: valoración gratis en bloques separados, sin precio', async () => {
    mockApi(makeConfig({ showConsultationPrice: false, consultationPrice: 100000 }));
    render(<ConsultationOffer />);
    expect(await screen.findByRole('heading', { name: '¡VALORACIÓN JURÍDICA GRATIS!' })).toBeInTheDocument();
    expect(screen.getByText('Tu problema merece ser escuchado. Tu tranquilidad merece una solución.')).toBeInTheDocument();
    const description = screen.getByText((_, el) => el?.tagName === 'P' && /^Escríbenos y recibe atención virtual/.test(el.textContent ?? ''));
    expect(description).toHaveTextContent('personalizada de nuestro abogado socio fundador');
    expect(description).toHaveTextContent('Ronaldo Jiménez');
    expect(screen.getByText('Primer paso sin costo')).toBeInTheDocument();
    expect(screen.getByText('JURISGLOBAL · Tu tranquilidad, nuestra misión.')).toBeInTheDocument();
    expect(screen.getByTestId('consultation-offer')).not.toHaveTextContent('$');
    expect(screen.getByRole('link', { name: 'Solicitar valoración' })).toHaveAttribute('href', '#contacto');
    expect(screen.getByText('Atención virtual en todo el país · presencial en Barranquilla')).toBeInTheDocument();
  });

  it('encendido pero sin valor configurado: no inventa un precio', async () => {
    mockApi(makeConfig({ showConsultationPrice: true, consultationPrice: null }));
    render(<ConsultationOffer />);
    expect(await screen.findByRole('heading', { name: '¡VALORACIÓN JURÍDICA GRATIS!' })).toBeInTheDocument();
    expect(screen.getByTestId('consultation-offer')).not.toHaveTextContent('$');
  });

  it('configuración no disponible: también cae en el llamado neutro', async () => {
    mockApi(null);
    render(<ConsultationOffer />);
    expect(await screen.findByRole('heading', { name: '¡VALORACIÓN JURÍDICA GRATIS!' })).toBeInTheDocument();
  });
});
