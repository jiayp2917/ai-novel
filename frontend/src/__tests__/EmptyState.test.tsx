import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../components/ui/EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="暂无数据" />);
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="暂无数据" description="请先添加内容后再查看" />);
    expect(screen.getByText('请先添加内容后再查看')).toBeInTheDocument();
  });

  it('renders the action button and invokes onAction on click', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <EmptyState
        title="暂无候选稿"
        description="生成新的候选稿后会显示在这里"
        action="立即生成"
        onAction={onAction}
      />,
    );

    const button = screen.getByRole('button', { name: '立即生成' });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does not render the action button when onAction is missing', () => {
    render(
      <EmptyState
        title="暂无数据"
        description="没有任何条目"
        action="立即生成"
      />,
    );
    expect(screen.queryByRole('button', { name: '立即生成' })).toBeNull();
  });

  it('renders the icon when provided', () => {
    const { container } = render(
      <EmptyState
        title="暂无数据"
        icon={<span data-testid="empty-icon">图标</span>}
      />,
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(container.querySelector('.ui-empty__icon')).not.toBeNull();
  });

  it('uses the ui-empty wrapper class', () => {
    const { container } = render(<EmptyState title="暂无数据" />);
    const wrapper = container.querySelector('.ui-empty');
    expect(wrapper).not.toBeNull();
  });
});
