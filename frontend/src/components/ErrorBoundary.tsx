import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面模块渲染失败', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="error-boundary" role="alert">
          <div>
            <strong>当前模块暂时无法显示</strong>
            <p>{this.state.error.message || '页面组件发生错误，请重试。'}</p>
          </div>
          <button className="btn primary" type="button" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
