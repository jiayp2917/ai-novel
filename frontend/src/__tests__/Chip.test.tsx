import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from '../components/ui/Chip';

describe('Chip variants', () => {
  it('applies ui-chip class for the default variant', () => {
    render(<Chip>中性</Chip>);
    const chip = screen.getByText('中性');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).not.toContain('ui-chip ok');
    expect(chip.className).not.toContain('ui-chip warn');
  });

  it('applies ok modifier for the success variant', () => {
    render(<Chip variant="success">成功</Chip>);
    const chip = screen.getByText('成功');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).toContain('ok');
  });

  it('applies warn modifier for the warning variant', () => {
    render(<Chip variant="warning">警告</Chip>);
    const chip = screen.getByText('警告');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).toContain('warn');
  });

  it('applies danger modifier for the error variant', () => {
    render(<Chip variant="error">失败</Chip>);
    const chip = screen.getByText('失败');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).toContain('danger');
  });

  it('applies blue modifier for the info variant', () => {
    render(<Chip variant="info">提示</Chip>);
    const chip = screen.getByText('提示');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).toContain('blue');
  });

  it('applies blue modifier for the blue (brand) variant', () => {
    render(<Chip variant="blue">品牌</Chip>);
    const chip = screen.getByText('品牌');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).toContain('blue');
  });

  it('applies purple modifier for the purple (accent) variant', () => {
    render(<Chip variant="purple">强调</Chip>);
    const chip = screen.getByText('强调');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).toContain('purple');
  });

  it('appends a custom className without losing the variant class', () => {
    render(
      <Chip variant="success" className="custom-chip">
        成功
      </Chip>,
    );
    const chip = screen.getByText('成功');
    expect(chip.className).toContain('ui-chip');
    expect(chip.className).toContain('ok');
    expect(chip.className).toContain('custom-chip');
  });
});
