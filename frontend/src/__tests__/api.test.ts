import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiRequestError, apiRequest } from '../api';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ApiRequestError', () => {
  it('stores status and detail', () => {
    const err = new ApiRequestError('test error', 404, 'Not Found');
    expect(err.message).toBe('test error');
    expect(err.status).toBe(404);
    expect(err.detail).toBe('Not Found');
    expect(err.name).toBe('ApiRequestError');
  });

  it('is an instance of Error', () => {
    const err = new ApiRequestError('msg', 500, 'detail');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiRequestError);
  });
});

describe('apiRequest', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns parsed JSON on success', async () => {
    const data = { id: 1, name: 'test' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });
    const result = await apiRequest('/api/test');
    expect(result).toEqual(data);
  });

  it('throws ApiRequestError on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Source file not found' }),
    });
    try {
      await apiRequest('/api/test');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(404);
    }
  });
});

describe('localizeApiError', () => {
  // Note: localizeApiError is not exported, but it's tested indirectly through apiRequest
  // Here we test the known translations via the error message
  it('translates known error messages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ detail: 'Source file not found' }),
    });
    try {
      await apiRequest('/api/test');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).message).toBe('源文件不存在。');
    }
  });

  it('passes through unknown error messages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Something unexpected' }),
    });
    try {
      await apiRequest('/api/test');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).message).toBe('Something unexpected');
    }
  });
});
