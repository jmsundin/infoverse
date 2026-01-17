import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DuplicateWarningModal } from '../DuplicateWarningModal';
import { DuplicateCheckResult } from '../../types';

describe('DuplicateWarningModal', () => {
  const mockDuplicates: DuplicateCheckResult[] = [
    {
      proposedIndex: 0,
      proposedName: 'Machine Learning',
      matches: [
        {
          id: 'existing-1',
          content: '# ML\n\n**assistant**: Machine learning basics',
          summary: 'Machine learning basics',
          similarity: 0.95,
        },
      ],
    },
  ];

  const defaultProps = {
    isOpen: true,
    duplicates: mockDuplicates,
    onCreateAll: vi.fn(),
    onLinkToExisting: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<DuplicateWarningModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Potential Duplicates Found')).toBeNull();
  });

  it('renders nothing when duplicates array is empty', () => {
    render(<DuplicateWarningModal {...defaultProps} duplicates={[]} />);
    expect(screen.queryByText('Potential Duplicates Found')).toBeNull();
  });

  it('renders modal header when open with duplicates', () => {
    render(<DuplicateWarningModal {...defaultProps} />);
    expect(screen.getByText('Potential Duplicates Found')).toBeInTheDocument();
  });

  it('renders proposed node name', () => {
    render(<DuplicateWarningModal {...defaultProps} />);
    expect(screen.getByText('Machine Learning')).toBeInTheDocument();
  });

  it('renders similarity percentage badge', () => {
    render(<DuplicateWarningModal {...defaultProps} />);
    expect(screen.getByText('95% similar')).toBeInTheDocument();
  });

  it('renders existing node summary', () => {
    render(<DuplicateWarningModal {...defaultProps} />);
    expect(screen.getByText('Machine learning basics')).toBeInTheDocument();
  });

  it('calls onCreateAll when "Create All Anyway" is clicked', () => {
    const onCreateAll = vi.fn();
    render(<DuplicateWarningModal {...defaultProps} onCreateAll={onCreateAll} />);

    fireEvent.click(screen.getByText('Create All Anyway'));
    expect(onCreateAll).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when "Cancel" is clicked', () => {
    const onCancel = vi.fn();
    render(<DuplicateWarningModal {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('pre-selects high similarity matches (>= 95%)', () => {
    render(<DuplicateWarningModal {...defaultProps} />);

    // The checkbox should be checked for 95% similarity match
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('does not pre-select lower similarity matches (< 95%)', () => {
    const lowerSimilarityDuplicates: DuplicateCheckResult[] = [
      {
        proposedIndex: 0,
        proposedName: 'Deep Learning',
        matches: [
          {
            id: 'existing-2',
            content: '# Neural Networks',
            summary: 'Neural network basics',
            similarity: 0.91, // Below 95%
          },
        ],
      },
    ];

    render(<DuplicateWarningModal {...defaultProps} duplicates={lowerSimilarityDuplicates} />);

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('toggles checkbox selection when match is clicked', () => {
    render(<DuplicateWarningModal {...defaultProps} />);

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked(); // Initially checked (>= 95%)

    // Click to deselect
    const matchButton = screen.getByRole('button', { name: /ML/i });
    fireEvent.click(matchButton);
    expect(checkbox).not.toBeChecked();

    // Click again to re-select
    fireEvent.click(matchButton);
    expect(checkbox).toBeChecked();
  });

  it('calls onLinkToExisting with correct mapping when applying selections', () => {
    const onLinkToExisting = vi.fn();
    render(<DuplicateWarningModal {...defaultProps} onLinkToExisting={onLinkToExisting} />);

    // The 95% match should be pre-selected, click the apply button
    const applyButton = screen.getByText(/Link 1, Create 0/i);
    fireEvent.click(applyButton);

    expect(onLinkToExisting).toHaveBeenCalledTimes(1);
    const mapping = onLinkToExisting.mock.calls[0][0] as Map<number, string>;
    expect(mapping.get(0)).toBe('existing-1');
  });

  it('shows count of duplicates found', () => {
    render(<DuplicateWarningModal {...defaultProps} />);
    expect(screen.getByText(/1 proposed node.*may already exist/i)).toBeInTheDocument();
  });

  it('handles multiple duplicates', () => {
    const multipleDuplicates: DuplicateCheckResult[] = [
      {
        proposedIndex: 0,
        proposedName: 'Machine Learning',
        matches: [{ id: 'e1', content: '# ML', summary: 'ML basics', similarity: 0.95 }],
      },
      {
        proposedIndex: 1,
        proposedName: 'Deep Learning',
        matches: [{ id: 'e2', content: '# DL', summary: 'DL basics', similarity: 0.92 }],
      },
    ];

    render(<DuplicateWarningModal {...defaultProps} duplicates={multipleDuplicates} />);

    expect(screen.getByText('Machine Learning')).toBeInTheDocument();
    expect(screen.getByText('Deep Learning')).toBeInTheDocument();
    expect(screen.getByText(/2 proposed nodes.*may already exist/i)).toBeInTheDocument();
  });

  it('applies different styling for high vs medium similarity', () => {
    const mixedSimilarityDuplicates: DuplicateCheckResult[] = [
      {
        proposedIndex: 0,
        proposedName: 'Topic A',
        matches: [{ id: 'e1', content: '', summary: '', similarity: 0.96 }],
      },
      {
        proposedIndex: 1,
        proposedName: 'Topic B',
        matches: [{ id: 'e2', content: '', summary: '', similarity: 0.91 }],
      },
    ];

    render(<DuplicateWarningModal {...defaultProps} duplicates={mixedSimilarityDuplicates} />);

    // High similarity should have red styling (96%)
    expect(screen.getByText('96% similar')).toHaveClass('bg-red-500/20');
    // Medium similarity should have amber styling (91%)
    expect(screen.getByText('91% similar')).toHaveClass('bg-amber-500/20');
  });
});
