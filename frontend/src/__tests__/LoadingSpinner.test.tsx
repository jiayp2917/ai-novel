import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

describe('LoadingSpinner size variants', () => {
  it('applies ui-spinner--sm for size="sm"', () => {
    render(<LoadingSpinner size="sm" />);
    const spinner = document.querySelector('.ui-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.className).toContain('ui-spinner--sm');
  });

  it('applies ui-spinner--md for size="md"', () => {
    render(<LoadingSpinner size="md" />);
    const spinner = document.querySelector('.ui-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.className).toContain('ui-spinner--md');
  });

  it('applies ui-spinner--lg for size="lg"', () => {
    render(<LoadingSpinner size="lg" />);
    const spinner = document.querySelector('.ui-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.className).toContain('ui-spinner--lg');
  });

  it('always includes the base ui-spinner class', () => {
    render(<LoadingSpinner size="md" />);
    const spinner = document.querySelector('.ui-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.classList.contains('ui-spinner')).toBe(true);
  });

  it('forwards additional className when provided', () => {
    render(<LoadingSpinner size="sm" className="custom-class" />);
    const spinner = document.querySelector('.ui-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.className).toContain('custom-class');
    expect(spinner!.className).toContain('ui-spinner--sm');
  });
});

describe('LoadingSpinner accessibility', () => {
  it('is hidden from assistive tech via aria-hidden', () => {
    render(<LoadingSpinner size="md" />);
    const spinner = document.querySelector('.ui-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.getAttribute('aria-hidden')).toBe('true');
  });
});
