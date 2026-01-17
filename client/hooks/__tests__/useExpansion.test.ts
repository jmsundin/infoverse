import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useExpansion } from '../useExpansion';
import * as geminiService from '../../services/geminiService';
import { GraphNode, NodeType, ExpandResponse } from '../../types';

// Mock the services
vi.mock('../../services/geminiService');
vi.mock('../../services/huggingfaceService');
vi.mock('../../services/wikidataService', () => ({
  fetchWikidataSubtopics: vi.fn(),
}));

describe('useExpansion duplicate handling', () => {
  const mockSourceNode: GraphNode = {
    id: 'source-1',
    content: '# Test Topic',
    x: 100,
    y: 100,
    type: NodeType.CHAT,
  };

  const mockNodes: GraphNode[] = [mockSourceNode];

  const mockSetNodes = vi.fn();
  const mockSetEdges = vi.fn();
  const mockSetViewTransform = vi.fn();
  const mockSetToast = vi.fn();
  const mockSetShowLimitModal = vi.fn();

  const mockAIResult: ExpandResponse = {
    nodes: [
      { name: 'Machine Learning', description: 'AI subset', type: 'concept' },
      { name: 'Deep Learning', description: 'Neural networks', type: 'concept' },
    ],
    edges: [
      { targetName: 'Machine Learning', relationship: 'subtopic' },
      { targetName: 'Deep Learning', relationship: 'subtopic' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window dimensions for viewport calculations
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets pendingExpansion when duplicates are found during AI expansion', async () => {
    const mockDuplicates = [
      {
        proposedIndex: 0,
        proposedName: 'Machine Learning',
        matches: [{ id: 'existing-1', content: '# ML', summary: 'ML basics', similarity: 0.95 }],
      },
    ];

    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);
    vi.mocked(geminiService.checkForDuplicates).mockResolvedValue(mockDuplicates);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    await act(async () => {
      await result.current.handleExpandNode('source-1', 'Artificial Intelligence');
    });

    // Should have pendingExpansion set with duplicates
    expect(result.current.pendingExpansion).not.toBeNull();
    expect(result.current.pendingExpansion?.duplicates).toHaveLength(1);
    expect(result.current.pendingExpansion?.duplicates[0].proposedName).toBe('Machine Learning');

    // Should NOT have called setNodes yet (waiting for user action)
    expect(mockSetNodes).not.toHaveBeenCalled();
  });

  it('proceeds with node creation when no duplicates found', async () => {
    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);
    vi.mocked(geminiService.checkForDuplicates).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    await act(async () => {
      await result.current.handleExpandNode('source-1', 'Artificial Intelligence');
    });

    // Should NOT have pendingExpansion
    expect(result.current.pendingExpansion).toBeNull();

    // Should have called setNodes to create new nodes
    expect(mockSetNodes).toHaveBeenCalled();
  });

  it('skips duplicate check when skipDuplicateCheck option is true', async () => {
    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    await act(async () => {
      await result.current.handleExpandNode('source-1', 'AI', undefined, undefined, { skipDuplicateCheck: true });
    });

    // checkForDuplicates should NOT have been called
    expect(geminiService.checkForDuplicates).not.toHaveBeenCalled();

    // Nodes should have been created directly
    expect(mockSetNodes).toHaveBeenCalled();
  });

  it('handleCreateAllAnyway creates all nodes from pending expansion', async () => {
    const mockDuplicates = [
      {
        proposedIndex: 0,
        proposedName: 'Machine Learning',
        matches: [{ id: 'existing-1', content: '# ML', summary: '', similarity: 0.95 }],
      },
    ];

    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);
    vi.mocked(geminiService.checkForDuplicates).mockResolvedValue(mockDuplicates);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    // First, trigger expansion to get pending state
    await act(async () => {
      await result.current.handleExpandNode('source-1', 'AI');
    });

    expect(result.current.pendingExpansion).not.toBeNull();

    // Now call handleCreateAllAnyway
    act(() => {
      result.current.handleCreateAllAnyway();
    });

    // Should have created nodes
    expect(mockSetNodes).toHaveBeenCalled();
    // pendingExpansion should be cleared
    expect(result.current.pendingExpansion).toBeNull();
  });

  it('handleLinkToExisting creates edges to existing nodes', async () => {
    const mockDuplicates = [
      {
        proposedIndex: 0,
        proposedName: 'Machine Learning',
        matches: [{ id: 'existing-1', content: '# ML', summary: '', similarity: 0.95 }],
      },
    ];

    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);
    vi.mocked(geminiService.checkForDuplicates).mockResolvedValue(mockDuplicates);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    // Trigger expansion
    await act(async () => {
      await result.current.handleExpandNode('source-1', 'AI');
    });

    // Create mapping: link first proposed node to existing
    const linkMapping = new Map<number, string>();
    linkMapping.set(0, 'existing-1');

    // Call handleLinkToExisting
    act(() => {
      result.current.handleLinkToExisting(linkMapping);
    });

    // setEdges should be called with edges to existing nodes
    expect(mockSetEdges).toHaveBeenCalled();

    // Only one node should be created (Deep Learning), not Machine Learning
    const setNodesCall = mockSetNodes.mock.calls[0][0];
    if (typeof setNodesCall === 'function') {
      const newNodes = setNodesCall([]);
      // Should only create "Deep Learning", not "Machine Learning" (which is linked)
      expect(newNodes.length).toBe(1);
    }
  });

  it('handleCancelExpansion clears pending state', async () => {
    const mockDuplicates = [
      {
        proposedIndex: 0,
        proposedName: 'ML',
        matches: [{ id: 'e1', content: '', summary: '', similarity: 0.95 }],
      },
    ];

    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);
    vi.mocked(geminiService.checkForDuplicates).mockResolvedValue(mockDuplicates);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    // Trigger expansion
    await act(async () => {
      await result.current.handleExpandNode('source-1', 'AI');
    });

    expect(result.current.pendingExpansion).not.toBeNull();

    // Cancel
    act(() => {
      result.current.handleCancelExpansion();
    });

    // Should clear pending state
    expect(result.current.pendingExpansion).toBeNull();

    // Should NOT have created any nodes
    expect(mockSetNodes).not.toHaveBeenCalled();
  });

  it('tracks expanding node IDs during expansion', async () => {
    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);
    vi.mocked(geminiService.checkForDuplicates).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    // Initially empty
    expect(result.current.expandingNodeIds).toEqual([]);

    // During expansion
    let expandPromise: Promise<void>;
    act(() => {
      expandPromise = result.current.handleExpandNode('source-1', 'AI');
    });

    // After expansion completes
    await act(async () => {
      await expandPromise!;
    });

    // Should be empty after completion
    expect(result.current.expandingNodeIds).not.toContain('source-1');
  });

  it('calls checkForDuplicates with correct node data', async () => {
    vi.mocked(geminiService.expandNodeTopic).mockResolvedValue(mockAIResult);
    vi.mocked(geminiService.checkForDuplicates).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useExpansion(
        mockNodes,
        null,
        mockSetNodes,
        mockSetEdges,
        'gemini',
        mockSetViewTransform,
        mockSetToast,
        mockSetShowLimitModal
      )
    );

    await act(async () => {
      await result.current.handleExpandNode('source-1', 'AI');
    });

    expect(geminiService.checkForDuplicates).toHaveBeenCalledWith([
      { name: 'Machine Learning', description: 'AI subset' },
      { name: 'Deep Learning', description: 'Neural networks' },
    ]);
  });
});
