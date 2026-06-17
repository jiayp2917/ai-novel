import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../components/ui/Dialog';

// jsdom reports offsetParent === null and empty getClientRects for every element,
// which makes the focus trap's "isVisible" check reject every focusable.
// Stub these on HTMLElement so the trap can find buttons inside the dialog.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement ?? document.body;
    },
  });
  HTMLElement.prototype.getClientRects = function getClientRects() {
    return [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList;
  };
});

describe('Dialog', () => {
  it('applies confirm-dialog--paper when paper is true', () => {
    const { container } = render(
      <Dialog open={true} onClose={vi.fn()} title="标题" paper>
        内容
      </Dialog>,
    );
    const dialog = container.querySelector('.confirm-dialog');
    expect(dialog?.className).toContain('confirm-dialog--paper');
  });

  it('does not apply paper class by default', () => {
    const { container } = render(
      <Dialog open={true} onClose={vi.fn()} title="标题">
        内容
      </Dialog>,
    );
    const dialog = container.querySelector('.confirm-dialog');
    expect(dialog?.className).not.toContain('confirm-dialog--paper');
  });

  it('focuses first focusable element on open, restores focus on close', async () => {
    const { rerender } = render(
      <div>
        <button data-testid="trigger">打开</button>
        <Dialog open={false} onClose={vi.fn()} title="标题">
          <button data-testid="first">第一个</button>
          <button data-testid="second">第二个</button>
        </Dialog>
      </div>,
    );

    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(
      <div>
        <button data-testid="trigger">打开</button>
        <Dialog open={true} onClose={vi.fn()} title="标题">
          <button data-testid="first">第一个</button>
          <button data-testid="second">第二个</button>
        </Dialog>
      </div>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('first'));
    });

    rerender(
      <div>
        <button data-testid="trigger">打开</button>
        <Dialog open={false} onClose={vi.fn()} title="标题">
          <button data-testid="first">第一个</button>
          <button data-testid="second">第二个</button>
        </Dialog>
      </div>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('Escape key calls onClose', () => {
    const onCloseSpy = vi.fn();
    render(
      <Dialog open={true} onClose={onCloseSpy} title="标题">
        内容
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseSpy).toHaveBeenCalled();
  });

  it('Tab cycles from last to first focusable', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open={true} onClose={vi.fn()} title="标题">
        <button data-testid="first">第一个</button>
        <button data-testid="second">第二个</button>
      </Dialog>,
    );

    const second = screen.getByTestId('second');
    second.focus();
    expect(document.activeElement).toBe(second);

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });
});
