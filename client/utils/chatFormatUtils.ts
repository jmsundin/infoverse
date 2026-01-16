/**
 * Utilities for formatting chat messages in markdown body
 *
 * Chat format:
 * # Chat Title (optional)
 *
 * **user**: message text
 *
 * **assistant**: response text
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'model';
  text: string;
}

/**
 * Parse chat messages from markdown content
 */
export function parseChatMessages(content: string): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Match **role**: text pattern
  const regex = /\*\*(user|assistant|system|model)\*\*:\s*([\s\S]*?)(?=\n\n\*\*(?:user|assistant|system|model)\*\*:|$)/gi;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const role = match[1].toLowerCase() as ChatMessage['role'];
    const text = match[2].trim();
    messages.push({ role, text });
  }

  return messages;
}

/**
 * Format chat messages as markdown content
 */
export function formatChatContent(messages: ChatMessage[], title?: string): string {
  let content = '';

  if (title) {
    content += `# ${title}\n\n`;
  }

  content += messages
    .map(m => `**${m.role}**: ${m.text}`)
    .join('\n\n');

  return content;
}

/**
 * Append a message to chat content
 */
export function appendChatMessage(content: string, role: ChatMessage['role'], text: string): string {
  const separator = content.trim() ? '\n\n' : '';
  return content + separator + `**${role}**: ${text}`;
}

/**
 * Update the last assistant message in chat content (for streaming)
 */
export function updateLastAssistantMessage(content: string, newText: string): string {
  // Find the last **assistant**: or **model**: and replace its content
  const regex = /(\*\*(?:assistant|model)\*\*:\s*)([\s\S]*)$/i;
  const match = content.match(regex);

  if (match) {
    return content.slice(0, match.index) + match[1] + newText;
  }

  // If no assistant message found, append one
  return appendChatMessage(content, 'assistant', newText);
}

/**
 * Extract title from chat content (first # heading)
 */
export function extractChatTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}
