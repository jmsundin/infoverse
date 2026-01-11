/**
 * Utility functions for generating and extracting node titles
 */

/**
 * Extract the first noun phrase from text as a fallback title.
 * Uses regex-based heuristics for common English patterns.
 */
export const extractFirstNounPhrase = (text: string, maxLength: number = 30): string => {
  if (!text) return 'Untitled';

  // Clean the text - get first line and remove markdown formatting
  const cleaned = text
    .split('\n')[0]  // First line only
    .replace(/^#+\s*/, '')  // Remove markdown headings with space
    .replace(/^#+/, '')  // Remove markdown headings without space
    .replace(/^\*\*(.+?)\*\*/, '$1')  // Remove bold at start
    .replace(/^\*(.+?)\*/, '$1')  // Remove italic at start
    .replace(/^[-*•]\s*/, '')  // Remove list markers
    .replace(/^\d+\.\s*/, '')  // Remove numbered list markers
    .trim();

  if (!cleaned) return 'Untitled';

  // Pattern 1: Colon-prefixed structure "Topic: Description" -> "Topic"
  const colonMatch = cleaned.match(/^([^:]+):/);
  if (colonMatch && colonMatch[1].length >= 2 && colonMatch[1].length <= maxLength) {
    return colonMatch[1].trim();
  }

  // Pattern 2: Extract text before common sentence-ending punctuation or conjunctions
  // This captures the subject/noun phrase before the verb phrase typically begins
  const sentenceStart = cleaned.split(/[.!?;,]|(\s+(?:is|are|was|were|has|have|had|will|would|can|could|should|must|may|might)\s+)/i)[0];

  if (sentenceStart && sentenceStart.length >= 3 && sentenceStart.length <= maxLength) {
    // Trim trailing articles/prepositions that might be captured
    const trimmed = sentenceStart.replace(/\s+(the|a|an|of|in|on|at|to|for|with|by|from|as)$/i, '').trim();
    if (trimmed.length >= 3) {
      return trimmed;
    }
  }

  // Pattern 3: First N words (up to 3 words or maxLength chars)
  const words = cleaned.split(/\s+/).slice(0, 3);
  let result = words.join(' ');

  // Strip leading articles for more concise noun phrases
  result = result.replace(/^(The|A|An)\s+/i, '');

  if (result.length > maxLength) {
    result = result.substring(0, maxLength - 3).trim() + '...';
  }

  return result || 'Untitled';
};

/**
 * Check if content is short enough to use directly as a title
 */
export const isShortContent = (content: string, maxLength: number = 40): boolean => {
  const trimmed = content.trim();
  return trimmed.length <= maxLength && !trimmed.includes('\n');
};

/**
 * Get a display title for a node, using explicit title or extracting from content
 */
export const getDisplayTitle = (
  title: string | undefined,
  content: string,
  summary?: string
): string => {
  // Use explicit title if available
  if (title) return title;

  // For short content, use it directly
  if (isShortContent(content)) {
    return content.trim() || 'Untitled';
  }

  // Extract from content
  const extracted = extractFirstNounPhrase(content);
  if (extracted !== 'Untitled') return extracted;

  // Fallback to summary if available
  if (summary) {
    const summaryExtracted = extractFirstNounPhrase(summary);
    if (summaryExtracted !== 'Untitled') return summaryExtracted;
  }

  return 'Untitled';
};

/**
 * Clean markdown and special characters from a title.
 * Titles should be alphanumeric with spaces, colons, hyphens, and apostrophes only.
 */
export const cleanTitleMarkdown = (title: string): string => {
  if (!title) return 'Untitled';

  return title
    .replace(/^[\s#]+/, '')             // Remove all leading whitespace and # characters (handles "# # # #" pattern)
    .replace(/\*\*(.+?)\*\*/g, '$1')    // Remove bold **
    .replace(/\*(.+?)\*/g, '$1')        // Remove italic *
    .replace(/__(.+?)__/g, '$1')        // Remove bold __
    .replace(/_(.+?)_/g, '$1')          // Remove italic _
    .replace(/`(.+?)`/g, '$1')          // Remove inline code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links, keep text
    .replace(/\.{2,}/g, '')             // Remove ellipses (2+ dots)
    .replace(/[^\w\s:'\-]/g, '')        // Keep only alphanumeric, spaces, colons, hyphens, apostrophes
    .replace(/\s+/g, ' ')               // Normalize whitespace
    .trim() || 'Untitled';
};
