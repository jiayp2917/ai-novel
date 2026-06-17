import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Surface, type SurfaceVariant } from '../components/ui/Surface';

describe('Surface 组件', () => {
  const variants: SurfaceVariant[] = ['bg', 'paper', 'dialog', 'chip', 'divider', 'button'];

  it.each(variants)('variant=%s 时根元素 className 含 surface--%s', (variant) => {
    const { container } = render(<Surface variant={variant}>内容</Surface>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain(`surface--${variant}`);
  });

  it('默认 variant=paper 时 className 含 surface--paper', () => {
    const { container } = render(<Surface>内容</Surface>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('surface--paper');
  });

  it('as="section" 时根元素为 section', () => {
    const { container } = render(<Surface as="section">内容</Surface>);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe('SECTION');
  });

  it('as="article" 时根元素为 article', () => {
    const { container } = render(<Surface as="article">内容</Surface>);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe('ARTICLE');
  });

  it('透传 children 文本', () => {
    render(<Surface>内容文本</Surface>);
    expect(screen.getByText('内容文本')).toBeInTheDocument();
  });

  it('透传 children 嵌套元素', () => {
    render(
      <Surface>
        <span data-testid="child">子元素</span>
      </Surface>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('子元素')).toBeInTheDocument();
  });

  it('透传自定义 className', () => {
    const { container } = render(<Surface className="自定义类">内容</Surface>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('自定义类');
  });
});
