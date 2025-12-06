
import { GoogleGenAI, Type, Schema, GenerateContentResponse } from "@google/genai";
import { ExpandResponse } from "../types";

// Initialize the client
// Note: In a real production app, ensure API_KEY is handled securely.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Chats with Gemini, allowing it to use Google Search grounding to answer questions
 * about current events or specific entity details from Wikipedia.
 * Supports streaming via onToken callback.
 */
export const sendChatMessage = async (
  history: { role: 'user' | 'model'; text: string }[],
  newMessage: string,
  onToken?: (text: string) => void
): Promise<{ text: string; sources?: { uri: string; title: string }[] }> => {
  
  try {
    const historyContext = history.map(h => `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}`).join('\n');
    const fullPrompt = `
      ${historyContext}
      User: ${newMessage}
      
      System: You are a helpful assistant in a knowledge graph application. 
      Users use you to explore Wikidata and Wikipedia information.
      Keep answers concise and relevant. If referring to specific articles, verify with search.
    `;

    const result = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: fullPrompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "You are an intelligent assistant connected to an infinite canvas. Help the user explore topics using data from Wikipedia and Wikidata."
      }
    });

    let fullText = '';
    let sources: { uri: string; title: string }[] = [];

    for await (const chunk of result) {
      const c = chunk as GenerateContentResponse;
      
      if (c.text) {
        fullText += c.text;
        if (onToken) {
          onToken(c.text);
        }
      }

      // Extract grounding chunks if available in this chunk
      // Note: Grounding usually comes at the end, but we accumulate it
      const chunks = c.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        chunks.forEach(chunk => {
          if (chunk.web) {
            sources.push({ uri: chunk.web.uri || '', title: chunk.web.title || 'Source' });
          }
        });
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
    const prompt = `
      Based on the following conversation start, generate a very short, concise title (max 3-5 words) for this chat session. 
      Do not use quotes.
      
      User: ${userMessage}
      Model: ${modelResponse}
      
      Title:
    `;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
    });
    return response.text ? response.text.trim().replace(/^["']|["']$/g, '') : "New Chat";
  } catch (e) {
    console.error("Title generation failed", e);
    return "New Chat";
  }
};

/**
 * Returns the prompt template for analyzing a topic and suggesting breakdown/connections.
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
 * Expands a node by finding hierarchical relationships using Gemini.
 * It effectively queries the LLM to act as a semantic layer over Wikidata/Wikipedia.
 * 
 * @param topic The main topic to expand (or text to analyze)
 * @param existingContext Optional list of existing node names to find connections to
 */
export const expandNodeTopic = async (topic: string, existingContext: string[] = []): Promise<ExpandResponse> => {
  try {
    const isLongText = topic.length > 100;
    const contextPrompt = existingContext.length > 0 
        ? `\nConsider these existing topics in the graph: ${JSON.stringify(existingContext.slice(0, 50))}. If the generated topics are strongly related to any of them, include edges connecting to them (use the exact name from the list as targetName).`
        : '';

    const basePrompt = isLongText 
      ? `
        Analyze the following text: "${topic}".
        ${contextPrompt}
        Using your knowledge of the text content and general knowledge:
        1. Extract a concise Main Topic Title (max 5 words) that represents this text.
        2. Identify 3 to 5 key sub-concepts, entities, or related topics mentioned in or relevant to the text.
        3. Define the relationship from the Main Topic to these entities.
        4. Provide a short description and a likely English Wikipedia URL for each sub-concept.
      `
      : `
        Analyze the topic: "${topic}".
        ${contextPrompt}
        Using your knowledge of Wikidata properties and Wikipedia hierarchies:
        1. Identify 3 to 5 related entities or sub-concepts.
        2. Define the specific hierarchical relationship from "${topic}" to these new entities.
        3. Provide a short description and a likely English Wikipedia URL for each.
      `;

    const prompt = `
      ${basePrompt}
      Return the result strictly as JSON.
    `;

    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        mainTopic: { type: Type.STRING, description: "The concise title/topic of the analyzed text (only if input was long text)" },
        nodes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['concept', 'entity'] },
              wikiLink: { type: Type.STRING }
            },
            required: ['name', 'description', 'type']
          }
        },
        edges: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              targetName: { type: Type.STRING },
              relationship: { type: Type.STRING }
            },
            required: ['targetName', 'relationship']
          }
        }
      },
      required: ['nodes', 'edges']
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");

    return JSON.parse(text) as ExpandResponse;

  } catch (error) {
    console.error("Gemini Expansion Error:", error);
    return { nodes: [], edges: [] };
  }
};

/**
 * Analyzes two lists of nodes (source and targets) to find semantic relationships.
 */
export const findRelationships = async (
  sourceNode: { id: string; content: string },
  targetNodes: { id: string; content: string }[]
): Promise<{ targetId: string; relationship: string }[]> => {
  if (targetNodes.length === 0) return [];

  try {
    const targetsJson = targetNodes.map(n => ({ id: n.id, content: n.content }));
    const prompt = `
      Analyze the relationship between the Source Node and the list of Target Nodes.
      
      Source Node: "${sourceNode.content}"
      
      Target Nodes:
      ${JSON.stringify(targetsJson)}
      
      Identify if there are any strong, direct semantic relationships (e.g., "is a", "part of", "created by", "related to", "opposite of").
      Return a JSON object with a list of relationships found. Only include strong connections.
    `;

    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        relationships: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              targetId: { type: Type.STRING },
              relationship: { type: Type.STRING }
            },
            required: ['targetId', 'relationship']
          }
        }
      },
      required: ['relationships']
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const result = JSON.parse(text);
    return result.relationships || [];

  } catch (error) {
    console.error("Relationship discovery failed", error);
    return [];
  }
};
