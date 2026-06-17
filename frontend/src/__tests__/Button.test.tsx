import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../components/ui/Button';

describe('Button surface prop', () => {
  it('applies ui-btn--surface-paper by default', () => {
    render(<Button>x</Button>);
    const btn = screen.getByRole('button', { name: 'x' });
    expect(btn.className).toContain('ui-btn--surface-paper');
  });

  it('applies ui-btn--surface-flat when surface="flat"', () => {
    render(<Button surface="flat">x</Button>);
    const btn = screen.getByRole('button', { name: 'x' });
    expect(btn.className).toContain('ui-btn--surface-flat');
  });

  it('applies ui-btn--surface-raised when surface="raised"', () => {
    render(<Button surface="raised">x</Button>);
    const btn = screen.getByRole('button', { name: 'x' });
    expect(btn.className).toContain('ui-btn--surface-raised');
  });

  it('surface prop is orthogonal to variant', () => {
    render(
      <Button variant="primary" surface="paper">
        x
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'x' });
    expect(btn.className).toContain('ui-btn--primary');
    expect(btn.className).toContain('ui-btn--surface-paper');
  });
});
