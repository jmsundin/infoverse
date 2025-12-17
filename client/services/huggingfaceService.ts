import { ExpandResponse } from "../types";

// Helper to make authenticated requests
const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  // Credentials include cookies for session
  const res = await fetch(url, { ...options, headers, credentials: "include" });

  if (res.status === 429) {
    throw new Error("LIMIT_REACHED");
  }

  if (!res.ok) {
    throw new Error(`API Error: ${res.statusText}`);
  }
  return res;
};

/**
 * Chats with Hugging Face via backend proxy.
 * Supports streaming via onToken callback.
 */
export const sendChatMessage = async (
  history: { role: "user" | "model"; text: string }[],
  newMessage: string,
  onToken?: (text: string) => void
): Promise<{ text: string; sources?: { uri: string; title: string }[] }> => {
  try {
    const response = await fetchWithAuth("/api/huggingface/chat", {
      method: "POST",
      body: JSON.stringify({ history, newMessage }),
    });

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let sources: { uri: string; title: string }[] = [];

    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split("\n");
      // Keep the last line in the buffer if it's incomplete
      buffer = lines.pop() || "";

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

    // Flush any remaining buffer or decoder content
    buffer += decoder.decode(); // Flush decoder
    
    if (buffer.trim()) {
      try {
        // Handle cases where the last line didn't have a newline
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line);
          if (data.text) {
            fullText += data.text;
            if (onToken) onToken(data.text);
          }
          if (data.sources) {
            sources = [...sources, ...data.sources];
          }
        }
      } catch (e) {
        console.error("Error parsing final buffer", e);
      }
    }

    if (!fullText) fullText = "I couldn't generate a response.";

    return {
      text: fullText,
      sources: sources.length > 0 ? sources : undefined,
    };
  } catch (error: any) {
    if (error.message === "LIMIT_REACHED") throw error;
    console.error("HF Chat Error:", error);
    return { text: "Error connecting to Hugging Face." };
  }
};

/**
 * Generates a concise title for a chat node based on the conversation.
 */
export const generateTitle = async (
  userMessage: string,
  modelResponse: string
): Promise<string> => {
  try {
    const res = await fetchWithAuth("/api/huggingface/title", {
      method: "POST",
      body: JSON.stringify({ userMessage, modelResponse }),
    });
    const data = await res.json();
    return data.title;
  } catch (e: any) {
    if (e.message === "LIMIT_REACHED") throw e;
    console.error("Title generation failed", e);
    return "New Chat";
  }
};

/**
 * Expands a node by finding hierarchical relationships using HF via backend.
 */
export const expandNodeTopic = async (
  topic: string,
  existingContext: string[] = []
): Promise<ExpandResponse> => {
  try {
    const res = await fetchWithAuth("/api/huggingface/expand", {
      method: "POST",
      body: JSON.stringify({ topic, existingContext }),
    });
    return (await res.json()) as ExpandResponse;
  } catch (error: any) {
    if (error.message === "LIMIT_REACHED") throw error;
    console.error("HF Expansion Error:", error);
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
    const res = await fetchWithAuth("/api/huggingface/relationships", {
      method: "POST",
      body: JSON.stringify({ sourceNode, targetNodes }),
    });
    return await res.json();
  } catch (error: any) {
    if (error.message === "LIMIT_REACHED") throw error;
    console.error("Relationship discovery failed", error);
    return [];
  }
};
