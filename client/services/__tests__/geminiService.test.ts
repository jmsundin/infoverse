import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForDuplicates } from '../geminiService';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('checkForDuplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const result = await checkForDuplicates([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls API with correct payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ duplicates: [] }),
    });

    await checkForDuplicates([{ name: 'Machine Learning', description: 'AI subset' }], 0.9);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/search/duplicates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          nodes: [{ name: 'Machine Learning', description: 'AI subset' }],
          threshold: 0.9,
        }),
        credentials: 'include',
      })
    );
  });

  it('returns duplicates from API response', async () => {
    const mockDuplicates = [
      {
        proposedIndex: 0,
        proposedName: 'Machine Learning',
        matches: [
          { id: 'existing-1', content: '# ML', summary: 'ML basics', similarity: 0.95 },
        ],
      },
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ duplicates: mockDuplicates }),
    });

    const result = await checkForDuplicates([{ name: 'Machine Learning' }]);

    expect(result).toHaveLength(1);
    expect(result[0].proposedName).toBe('Machine Learning');
    expect(result[0].matches[0].similarity).toBe(0.95);
  });

  it('uses default threshold of 0.9', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ duplicates: [] }),
    });

    await checkForDuplicates([{ name: 'Test' }]);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.threshold).toBe(0.9);
  });

  it('respects custom threshold parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ duplicates: [] }),
    });

    await checkForDuplicates([{ name: 'Test' }], 0.85);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.threshold).toBe(0.85);
  });

  it('handles API errors gracefully (returns empty array)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await checkForDuplicates([{ name: 'Test' }]);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith('Duplicate check failed:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('handles non-ok response gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await checkForDuplicates([{ name: 'Test' }]);

    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('handles missing duplicates field in response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await checkForDuplicates([{ name: 'Test' }]);
    expect(result).toEqual([]);
  });

  it('handles multiple proposed nodes', async () => {
    const mockDuplicates = [
      { proposedIndex: 0, proposedName: 'ML', matches: [] },
      { proposedIndex: 1, proposedName: 'AI', matches: [{ id: 'x', content: '', summary: '', similarity: 0.92 }] },
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ duplicates: mockDuplicates }),
    });

    const result = await checkForDuplicates([
      { name: 'ML', description: 'Machine Learning' },
      { name: 'AI', description: 'Artificial Intelligence' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[1].matches).toHaveLength(1);
  });
});
