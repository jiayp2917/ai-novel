// 覆盖范围：components/models/modelsShared.ts 中的纯函数
//   - statusCardClass(tone)
//   - formatDate(value)
//   - friendlyUrl(value)
//   - summarizeModelCallError(error)
//   - sanitizeModelCallError(error)
import { describe, it, expect } from 'vitest';
import {
  statusCardClass,
  formatDate,
  friendlyUrl,
  summarizeModelCallError,
  sanitizeModelCallError,
} from '../components/models/modelsShared';

describe('statusCardClass', () => {
  it('neutral 返回 neutral 卡片类', () => {
    expect(statusCardClass('neutral')).toBe('metric-card metric-card--neutral');
  });

  it('ok 返回 ok 卡片类', () => {
    expect(statusCardClass('ok')).toBe('metric-card metric-card--ok');
  });

  it('danger 返回 danger 卡片类', () => {
    expect(statusCardClass('danger')).toBe('metric-card metric-card--danger');
  });
});

describe('formatDate', () => {
  it('null 返回 暂无', () => {
    expect(formatDate(null)).toBe('暂无');
  });

  it('空字符串返回 暂无', () => {
    expect(formatDate('')).toBe('暂无');
  });

  it('非法日期返回原值', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('合法 ISO 日期返回 toLocaleString 且包含年份', () => {
    const result = formatDate('2024-06-17T12:00:00Z');
    expect(result).not.toBe('2024-06-17T12:00:00Z');
    // 年份出现在本地化字符串中（中文/英文 locale 均包含四位年份）
    expect(result).toMatch(/2024/);
  });
});

describe('friendlyUrl', () => {
  it('undefined 返回 未配置', () => {
    expect(friendlyUrl(undefined)).toBe('未配置');
  });

  it('空字符串返回 未配置', () => {
    expect(friendlyUrl('')).toBe('未配置');
  });

  it('合法 URL 返回 hostname', () => {
    expect(friendlyUrl('https://api.example.com/v1/chat')).toBe('api.example.com');
  });

  it('带端口的合法 URL 返回 hostname', () => {
    expect(friendlyUrl('http://localhost:8000/path')).toBe('localhost');
  });

  it('非法 URL 返回原值', () => {
    expect(friendlyUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('summarizeModelCallError', () => {
  it('null 返回 无', () => {
    expect(summarizeModelCallError(null)).toBe('无');
  });

  it('undefined 返回 无', () => {
    expect(summarizeModelCallError(undefined)).toBe('无');
  });

  it('空字符串返回 无', () => {
    expect(summarizeModelCallError('')).toBe('无');
  });

  it('包含 missing api key 返回 缺少密钥配置', () => {
    expect(summarizeModelCallError('Missing API key for writer')).toBe('缺少密钥配置');
  });

  it('包含 api_key 返回 缺少密钥配置', () => {
    expect(summarizeModelCallError('error: invalid api_key')).toBe('缺少密钥配置');
  });

  it('包含 api key env 返回 缺少密钥配置', () => {
    expect(summarizeModelCallError('api key env not set')).toBe('缺少密钥配置');
  });

  it('包含 authentication 返回 密钥验证失败', () => {
    expect(summarizeModelCallError('Authentication failed')).toBe('密钥验证失败');
  });

  it('包含 invalid 返回 密钥验证失败', () => {
    expect(summarizeModelCallError('invalid credentials')).toBe('密钥验证失败');
  });

  it('包含 unauthorized 返回 密钥验证失败', () => {
    expect(summarizeModelCallError('Unauthorized access')).toBe('密钥验证失败');
  });

  it('包含 401 返回 密钥验证失败', () => {
    expect(summarizeModelCallError('HTTP 401')).toBe('密钥验证失败');
  });

  it('包含 timeout 返回 请求超时', () => {
    expect(summarizeModelCallError('request timeout')).toBe('请求超时');
  });

  it('包含 timed out 返回 请求超时', () => {
    expect(summarizeModelCallError('request timed out')).toBe('请求超时');
  });

  it('包含 rate limit 返回 请求过多', () => {
    expect(summarizeModelCallError('rate limit exceeded')).toBe('请求过多，稍后再试');
  });

  it('包含 too many 返回 请求过多', () => {
    expect(summarizeModelCallError('too many requests')).toBe('请求过多，稍后再试');
  });

  it('包含 429 返回 请求过多', () => {
    expect(summarizeModelCallError('HTTP 429')).toBe('请求过多，稍后再试');
  });

  it('包含 budget 返回 预算限制', () => {
    expect(summarizeModelCallError('daily budget exceeded')).toBe('预算限制，已暂停');
  });

  it('包含 测试连接失败 返回 连接失败', () => {
    expect(summarizeModelCallError('测试连接失败')).toBe('连接失败');
  });

  it('包含 network 返回 连接失败', () => {
    expect(summarizeModelCallError('network error')).toBe('连接失败');
  });

  it('包含 connection 返回 连接失败', () => {
    expect(summarizeModelCallError('connection refused')).toBe('连接失败');
  });

  it('包含 fetch 返回 连接失败', () => {
    expect(summarizeModelCallError('failed to fetch')).toBe('连接失败');
  });

  it('包含 json 返回 响应格式异常', () => {
    expect(summarizeModelCallError('parse json failed')).toBe('响应格式异常');
  });

  it('其余错误返回 请求失败', () => {
    expect(summarizeModelCallError('something unexpected happened')).toBe('请求失败，可展开排错信息');
  });

  it('api_key 优先级高于 json（先匹配先返回）', () => {
    expect(summarizeModelCallError('api_key missing and json invalid')).toBe('缺少密钥配置');
  });
});

describe('sanitizeModelCallError', () => {
  it('null 返回 无', () => {
    expect(sanitizeModelCallError(null)).toBe('无');
  });

  it('undefined 返回 无', () => {
    expect(sanitizeModelCallError(undefined)).toBe('无');
  });

  it('空字符串返回 无', () => {
    expect(sanitizeModelCallError('')).toBe('无');
  });

  it('脱敏 api_key=xxx', () => {
    const result = sanitizeModelCallError('api_key=sk-secret123456');
    expect(result).toBe('api_key=已隐藏');
    expect(result).not.toContain('secret123456');
  });

  it('脱敏 api key:xxx（带空格）', () => {
    const result = sanitizeModelCallError('api key: my-secret-value');
    expect(result).toBe('api key: 已隐藏');
    expect(result).not.toContain('my-secret-value');
  });

  it('脱敏 Authorization: Bearer xxx', () => {
    const result = sanitizeModelCallError('Authorization: Bearer abc.def.ghi-token-1234567890');
    expect(result).toBe('Authorization: Bearer 已隐藏');
    expect(result).not.toContain('abc.def.ghi-token-1234567890');
  });

  it('脱敏 sk- 前缀密钥（8+字符）', () => {
    const result = sanitizeModelCallError('error using sk-abcdefgh1234');
    expect(result).toBe('error using sk-已隐藏');
    expect(result).not.toContain('abcdefgh1234');
  });

  it('脱敏 JWT 形式 token（每段 16+字符）', () => {
    const jwt = 'headerpart12345678.payloadpart123456.signature12345678';
    const result = sanitizeModelCallError('token=' + jwt);
    expect(result).toBe('token=token-已隐藏');
    expect(result).not.toContain('payloadpart123456');
  });

  it('不含敏感信息的错误保持不变', () => {
    const result = sanitizeModelCallError('request timed out');
    expect(result).toBe('request timed out');
  });
});
