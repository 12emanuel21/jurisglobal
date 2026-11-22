import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WhyUs } from './WhyUs';

describe('WhyUs · socios fundadores', () => {
  it('muestra las dos tarjetas con iniciales, nombre y cargo', () => {
    render(<WhyUs />);
    const cards = within(screen.getByRole('list', { name: 'Socios fundadores' })).getAllByRole('listitem');
    expect(cards.map((c) => c.textContent)).toEqual([
      'RJRonaldo Jiménez AcuñaGerente General y Representante Legal',
      'EVEmanuel Ricardo Vargas VillarrealDesarrollador y Soporte Técnico',
    ]);
    expect(document.body).not.toHaveTextContent(/Jeremy|Arenillas/);
  });
});
