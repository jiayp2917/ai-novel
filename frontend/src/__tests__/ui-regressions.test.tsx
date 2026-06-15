import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PipelineFailureSummary } from '../components/PipelineView';
import { VersionHistory } from '../components/VersionHistory';
import { useChapterVersions, useHealth } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { PipelineRun } from '../types';

vi.mock('../components/TaskPanel', () => ({
  TaskPanel: () => <div data-testid="task-panel" />,
}));

vi.mock('../pages/DashboardPage', () => ({
  DashboardPage: () => <div data-testid="dashboard-page" />,
}));

vi.mock('../pages/CorePages', () => ({
  AiWorkbenchPage: () => <div data-testid="ai-page" />,
  ModelsPage: () => <div data-testid="models-page" />,
  PipelinePage: () => <div data-testid="pipeline-page" />,
  PlanningPage: () => <div data-testid="planning-page" />,
  SettingsPage: () => <div data-testid="settings-page" />,
  WritingPage: () => <div data-testid="writing-page" />,
}));

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks');
  return {
    ...actual,
    useChapterVersions: vi.fn(),
    useHealth: vi.fn(),
  };
});

function renderWithQuery(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe('UI regressions from browser E2E', () => {
  beforeEach(() => {
    vi.mocked(useChapterVersions).mockReset();
    vi.mocked(useHealth).mockReset();
    useWorkbenchStore.setState({
      activeView: 'home',
      selectedChapterVersionId: null,
      theme: 'breeze',
    });
  });

  it('keeps VersionHistory loading markup valid inside muted text', () => {
    vi.mocked(useChapterVersions).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useChapterVersions>);

    const { container } = renderWithQuery(<VersionHistory chapterId={1} />);

    expect(screen.getByText(/正在读取正文版本/).tagName).toBe('P');
    expect(container.querySelector('p > div.ui-spinner')).toBeNull();
    expect(container.querySelector('p > span.ui-spinner')).toBeInTheDocument();
  });

  it('rolls up user-paused pipeline summaries instead of rendering every item as a failure card', () => {
    const run = makePipelineRun(
      Array.from({ length: 30 }, (_, index) => ({
        job_id: index + 1,
        chapter_no: Math.floor(index / 3) + 1,
        task_type: 'generate_chapter_draft',
        task_label: '生成草稿',
        status: 'paused',
        status_label: '已暂停',
        reason: 'Paused by user',
        next_step: '恢复流水线后继续。',
      })),
    );

    render(<PipelineFailureSummary run={run} />);

    expect(screen.getByText('30 个步骤已暂停')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByText('Paused by user')).not.toBeInTheDocument();
  });

  it('keeps budget pause summaries visible as actionable failures', () => {
    const run = makePipelineRun([
      {
        job_id: 1,
        chapter_no: 2,
        task_type: 'generate_chapter_draft',
        task_label: '生成草稿',
        status: 'paused_budget',
        status_label: 'AI 调用已暂停',
        reason: '今日 AI 调用预算已用完',
        next_step: '调整预算后重试。',
      },
    ]);

    render(<PipelineFailureSummary run={run} />);

    expect(screen.queryByText('1 个步骤已暂停')).not.toBeInTheDocument();
    expect(screen.getByText('今日 AI 调用预算已用完')).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('hides decorative narrow navigation labels from accessible names', () => {
    vi.mocked(useHealth).mockReturnValue({
      data: {
        content_root: 'D:/workspace',
        low_cost_mode: false,
        runtime_root: 'runtime',
        service: 'ai-novel',
        status: 'ok',
        workspace: {
          detected_counts: {},
          layout: 'content',
          root: 'D:/workspace',
          source_roots: [],
        },
      },
    } as unknown as ReturnType<typeof useHealth>);

    renderWithQuery(<App />);

    const homeButton = screen.getByRole('button', { name: '打开首页' });
    expect(homeButton.querySelector('.ico')).toHaveAttribute('aria-hidden', 'true');
    expect(homeButton.querySelector('.nav-short-label')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: /首页首页/ })).not.toBeInTheDocument();
  });
});

function makePipelineRun(failureSummaries: PipelineRun['summary']['failure_summaries']): PipelineRun {
  return {
    id: 1,
    type: 'pipeline_run',
    status: 'paused',
    payload: {
      dry_run: true,
      end_chapter: 10,
      generation_mode: 'stable',
      mode: 'full_auto',
      start_chapter: 1,
    },
    result: {},
    error: null,
    child_tasks: [],
    report_summary: {
      exists: false,
      generated: false,
      note: '',
      path: null,
    },
    next_step: {
      label: '已暂停',
      text: '点击恢复后继续。',
      tone: 'info',
    },
    summary: {
      can_delete: false,
      completed_steps: 0,
      delete_block_reason: null,
      failed_or_paused_steps: failureSummaries.length,
      failure_summaries: failureSummaries,
      manual_required_steps: 0,
      status_label: '已暂停',
      total_steps: failureSummaries.length,
    },
  };
}
