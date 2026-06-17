export type TaskPush = (task: { label: string; status: 'running' | 'succeeded' | 'failed'; detail: string }) => void;

export function statusCardClass(tone: 'neutral' | 'ok' | 'danger'): string {
  return `metric-card metric-card--${tone}`;
}

export function formatDate(value: string | null): string {
  if (!value) {
    return '暂无';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function friendlyUrl(value?: string): string {
  if (!value) {
    return '未配置';
  }
  try {
    const url = new URL(value);
    return url.hostname;
  } catch {
    return value;
  }
}

export function summarizeModelCallError(error?: string | null): string {
  if (!error) {
    return '无';
  }
  const normalized = error.toLowerCase();
  if (normalized.includes('missing api key') || normalized.includes('api_key') || normalized.includes('api key env')) {
    return '缺少密钥配置';
  }
  if (normalized.includes('authentication') || normalized.includes('invalid') || normalized.includes('unauthorized') || normalized.includes('401')) {
    return '密钥验证失败';
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return '请求超时';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many') || normalized.includes('429')) {
    return '请求过多，稍后再试';
  }
  if (normalized.includes('budget')) {
    return '预算限制，已暂停';
  }
  if (error.includes('测试连接失败') || normalized.includes('network') || normalized.includes('connection') || normalized.includes('fetch')) {
    return '连接失败';
  }
  if (normalized.includes('json')) {
    return '响应格式异常';
  }
  return '请求失败，可展开排错信息';
}

export function sanitizeModelCallError(error?: string | null): string {
  if (!error) {
    return '无';
  }
  return error
    .replace(/(api\s*key\s*[:=]\s*)[^\s"',}]+/gi, '$1已隐藏')
    .replace(/(api_key\s*[:=]\s*)[^\s"',}]+/gi, '$1已隐藏')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, '$1已隐藏')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-已隐藏')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, 'token-已隐藏');
}
