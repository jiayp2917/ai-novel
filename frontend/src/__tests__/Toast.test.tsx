import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../components/ui/Toast';

function ToastTrigger({ message, variant }: { message: string; variant?: 'success' | 'error' | 'info' | 'warning' }) {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast(message, variant)}>
      触发
    </button>
  );
}

describe('ToastProvider 渲染与 useToast', () => {
  it('mount 后点击触发器通过 useToast().showToast(message) 渲染 toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="保存成功" variant="success" />
      </ToastProvider>,
    );

    expect(screen.queryByText('保存成功')).toBeNull();

    act(() => {
      screen.getByRole('button', { name: '触发' }).click();
    });

    const toast = screen.getByText('保存成功');
    expect(toast).toBeInTheDocument();
    expect(toast.closest('.toast')).not.toBeNull();
    expect(toast.closest('.toast')!.className).toContain('toast--success');
  });

  it('默认 variant 为 info,渲染时含 toast--info class', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="默认信息" />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: '触发' }).click();
    });

    const toastEl = screen.getByText('默认信息').closest('.toast');
    expect(toastEl).not.toBeNull();
    expect(toastEl!.className).toContain('toast--info');
  });

  it('多次触发可同时显示多条 toast', () => {
    function MultiTrigger() {
      const { showToast } = useToast();
      return (
        <>
          <button type="button" onClick={() => showToast('第一条', 'info')}>1</button>
          <button type="button" onClick={() => showToast('第二条', 'warning')}>2</button>
        </>
      );
    }

    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: '1' }).click();
    });
    act(() => {
      screen.getByRole('button', { name: '2' }).click();
    });

    expect(screen.getByText('第一条')).toBeInTheDocument();
    expect(screen.getByText('第二条')).toBeInTheDocument();
    const container = document.querySelector('.toast-container');
    expect(container).not.toBeNull();
    expect(container!.querySelectorAll('.toast').length).toBe(2);
  });
});

describe('Toast 中文文案渲染', () => {
  it('渲染 "保存成功" 文案', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="保存成功" variant="success" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: '触发' }).click();
    });
    expect(screen.getByText('保存成功')).toBeInTheDocument();
  });

  it('渲染 "加载失败，请重试" 文案', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="加载失败，请重试" variant="error" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: '触发' }).click();
    });
    expect(screen.getByText('加载失败，请重试')).toBeInTheDocument();
    const toastEl = screen.getByText('加载失败，请重试').closest('.toast');
    expect(toastEl!.className).toContain('toast--error');
  });

  it('渲染 "网络异常" warning 文案', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="网络异常" variant="warning" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: '触发' }).click();
    });
    expect(screen.getByText('网络异常')).toBeInTheDocument();
  });
});

describe('Toast 容器与图标', () => {
  it('toast 节点包含 icon、message、close 三个子元素', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="保存成功" variant="success" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: '触发' }).click();
    });

    const toastEl = screen.getByText('保存成功').closest('.toast');
    expect(toastEl!.querySelector('.toast__icon')).not.toBeNull();
    expect(toastEl!.querySelector('.toast__message')).not.toBeNull();
    expect(toastEl!.querySelector('.toast__close')).not.toBeNull();
  });

  it('未触发时 toast-container 不存在', () => {
    const { container } = render(
      <ToastProvider>
        <div>无 toast</div>
      </ToastProvider>,
    );
    expect(container.querySelector('.toast-container')).toBeNull();
  });
});
