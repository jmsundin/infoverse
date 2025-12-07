const express = require('express');
const router = express.Router();
const { GoogleGenAI, Type, Schema } = require("@google/genai");

// Initialize Gemini
// Ensure API_KEY is available in process.env
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Middleware to check authentication
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ message: 'Unauthorized' });
};

router.use(ensureAuthenticated);

// Chat Endpoint
router.post('/chat', async (req, res) => {
    const { history, newMessage } = req.body;

    if (!newMessage) {
        return res.status(400).json({ message: 'Message is required' });
    }

    try {
        const historyContext = history ? history.map(h => `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}`).join('\n') : '';
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

        // Set headers for streaming
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        for await (const chunk of result) {
            const c = chunk;
            
            // We'll send a JSON string per line for easier parsing on client if needed, 
            // or just the text if we want to keep it simple.
            // The client expects text tokens and then sources at the end.
            // Let's stick to a simple format: JSON-serialized chunks separated by newlines.
            
            const payload = {};
            if (c.text) {
                payload.text = c.text;
            }
            
            const chunks = c.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks) {
                payload.sources = [];
                chunks.forEach(chunk => {
                    if (chunk.web) {
                        payload.sources.push({ uri: chunk.web.uri || '', title: chunk.web.title || 'Source' });
                    }
                });
            }
            
            if (payload.text || payload.sources) {
                res.write(JSON.stringify(payload) + '\n');
            }
        }
        
        res.end();

    } catch (error) {
        console.error("Gemini Chat Error:", error);
        // If headers aren't sent yet
        if (!res.headersSent) {
            res.status(500).json({ message: "Error connecting to Gemini." });
        } else {
            res.end();
        }
    }
});

// Generate Title Endpoint
router.post('/title', async (req, res) => {
    const { userMessage, modelResponse } = req.body;
    
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
        const title = response.text ? response.text.trim().replace(/^["']|["']$/g, '') : "New Chat";
        res.json({ title });
    } catch (e) {
        console.error("Title generation failed", e);
        res.json({ title: "New Chat" });
    }
});

// Expand Topic Endpoint
router.post('/expand', async (req, res) => {
    const { topic, existingContext } = req.body;
    
    if (!topic) return res.status(400).json({ message: 'Topic required' });

    try {
        const isLongText = topic.length > 100;
        const contextPrompt = existingContext && existingContext.length > 0 
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

        const schema = {
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

        res.json(JSON.parse(text));

    } catch (error) {
        console.error("Gemini Expansion Error:", error);
        res.json({ nodes: [], edges: [] });
    }
});

// Relationships Endpoint
router.post('/relationships', async (req, res) => {
    const { sourceNode, targetNodes } = req.body;
    
    if (!sourceNode || !targetNodes) return res.status(400).json({ message: 'Source and target nodes required' });
    if (targetNodes.length === 0) return res.json([]);

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

        const schema = {
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
        if (!text) return res.json([]);
        
        const result = JSON.parse(text);
        res.json(result.relationships || []);

    } catch (error) {
        console.error("Relationship discovery failed", error);
        res.json([]);
    }
});

module.exports = router;

