import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import NavigationDetails from './NavigationDetails';

it('reabre apenas os detalhes expandidos e preserva o fechamento após F5', () => {
  localStorage.setItem('usuario', '{"id":7}');
  const view = () => <NavigationDetails navigationScope="venda:42"><summary>Detalhes da venda</summary><p>Registro atual</p></NavigationDetails>;
  const first = render(view());
  const details = screen.getByText('Detalhes da venda').closest('details');
  details.open = true;
  fireEvent(details, new Event('toggle'));
  first.unmount();
  const second = render(view());
  expect(screen.getByText('Detalhes da venda').closest('details')).toHaveAttribute('open');
  const current = screen.getByText('Detalhes da venda').closest('details');
  current.open = false;
  fireEvent(current, new Event('toggle'));
  second.unmount();
  render(view());
  expect(screen.getByText('Detalhes da venda').closest('details')).not.toHaveAttribute('open');
});
