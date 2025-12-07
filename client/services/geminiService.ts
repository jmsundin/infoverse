import { ExpandResponse } from "../types";

// Helper to make authenticated requests
const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  // Credentials include cookies for session
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (!res.ok) {
    throw new Error(`API Error: ${res.statusText}`);
  }
  return res;
};

/**
 * Chats with Gemini via backend proxy.
 * Supports streaming via onToken callback.
 */
export const sendChatMessage = async (
  history: { role: 'user' | 'model'; text: string }[],
  newMessage: string,
  onToken?: (text: string) => void
): Promise<{ text: string; sources?: { uri: string; title: string }[] }> => {
  
  try {
    const response = await fetchWithAuth('/api/gemini/chat', {
      method: 'POST',
      body: JSON.stringify({ history, newMessage })
    });

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let sources: { uri: string; title: string }[] = [];

    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split('\n');
      // Keep the last line in the buffer if it's incomplete
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.text) {
            fullText += data.text;
            if (onToken) onToken(data.text);
          }
          if (data.sources) {
            sources = [...sources, ...data.sources];
          }
        } catch (e) {
          console.error("Error parsing stream chunk", e);
        }
      }
    }

    if (!fullText) fullText = "I couldn't generate a response.";

    return { text: fullText, sources: sources.length > 0 ? sources : undefined };

  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return { text: "Error connecting to Gemini." };
  }
};

/**
 * Generates a concise title for a chat node based on the conversation.
 */
export const generateTitle = async (userMessage: string, modelResponse: string): Promise<string> => {
  try {
    const res = await fetchWithAuth('/api/gemini/title', {
      method: 'POST',
      body: JSON.stringify({ userMessage, modelResponse })
    });
    const data = await res.json();
    return data.title;
  } catch (e) {
    console.error("Title generation failed", e);
    return "New Chat";
  }
};

/**
 * Returns the prompt template for analyzing a topic and suggesting breakdown/connections.
 * Kept on client as it's just a string helper, but not used for API call construction anymore.
 */
export const getTopicSummaryPrompt = (topic: string) => `Step 1: Whenever I provide a [Topic], output a 50-word executive summary focusing on the core problem it solves and its main value.

Step 2: Immediately ask: "Would you like to see the breakdown and connections?"

Step 3: If I answer "Yes," provide the following two lists (keep them concise):

**1. Subtopics (The Breakdown)**
* List the 3-5 key components, pillars, or modules that exist *within* this topic.
* (Think: "What is this made of?")

**2. Related Topics (The Connections)**
* List 3-5 adjacent concepts, competitors, or prerequisites.
* (Think: "What sits next to this?" or "What often gets confused with this?")

Topic: ${topic}`;

/**
 * Expands a node by finding hierarchical relationships using Gemini via backend.
 */
export const expandNodeTopic = async (topic: string, existingContext: string[] = []): Promise<ExpandResponse> => {
  try {
    const res = await fetchWithAuth('/api/gemini/expand', {
      method: 'POST',
      body: JSON.stringify({ topic, existingContext })
    });
    return await res.json() as ExpandResponse;
  } catch (error) {
    console.error("Gemini Expansion Error:", error);
    return { nodes: [], edges: [] };
  }
};

/**
 * Analyzes two lists of nodes (source and targets) to find semantic relationships via backend.
 */
export const findRelationships = async (
  sourceNode: { id: string; content: string },
  targetNodes: { id: string; content: string }[]
): Promise<{ targetId: string; relationship: string }[]> => {
  if (targetNodes.length === 0) return [];

  try {
    const res = await fetchWithAuth('/api/gemini/relationships', {
      method: 'POST',
      body: JSON.stringify({ sourceNode, targetNodes })
    });
    return await res.json();
  } catch (error) {
    console.error("Relationship discovery failed", error);
    return [];
  }
};
