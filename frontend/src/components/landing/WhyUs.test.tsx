import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WhyUs } from './WhyUs';

describe('WhyUs · socios fundadores', () => {
  it('muestra las dos tarjetas con iniciales, nombre y cargo', () => {
    render(<WhyUs />);
    const cards = within(screen.getByRole('list', { name: 'Socios fundadores' })).getAllByRole('listitem');
    expect(cards.map((c) => c.textContent)).toEqual([
      'RJRonaldo Jiménez AcuñaGerente General y Representante Legal',
      'EVEmanuel Ricardo Vargas VillarrealGerente Desarrollador y Soporte Técnico',
    ]);
    expect(document.body).not.toHaveTextContent(/Jeremy|Arenillas/);
  });

  it('el texto de «¿Por qué elegir JURISGLOBAL?» va en bloques separados, con el lema al final', () => {
    render(<WhyUs />);
    expect(screen.getByRole('heading', { level: 2, name: '¿Por qué elegir JURISGLOBAL?' })).toBeInTheDocument();
    const blocks = screen.getByTestId('why-us-text').querySelectorAll('p');
    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toHaveTextContent(/^Porque detrás de cada problema/);
    expect(blocks[5]).toHaveTextContent('JURISGLOBAL — Tu tranquilidad, nuestra misión.');
  });

  it('los 4 atributos diferenciadores reemplazan a Trato humano, Prevención y Claridad', () => {
    render(<WhyUs />);
    const items = within(screen.getByRole('list', { name: 'Lo que nos diferencia' })).getAllByRole('listitem');
    expect(items.map((i) => [within(i).getByRole('heading').textContent, i.querySelector('p')?.textContent])).toEqual([
      ['Cercanía humana', 'Escuchamos tu situación y te brindamos atención personalizada.'],
      ['Respaldo profesional', 'Conocimiento jurídico y financiero al servicio de tus intereses.'],
      ['Confianza y transparencia', 'Orientación clara, responsable y honesta en cada etapa.'],
      ['Soluciones integrales', 'Estrategias adaptadas a las necesidades de cada persona y empresa.'],
    ]);
    expect(screen.queryByText('Trato humano')).toBeNull();
    expect(screen.queryByText('Claridad')).toBeNull();
  });
});
