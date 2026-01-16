import { useState, useRef, useCallback } from "react";
import { GraphNode, GraphEdge, NodeType, ViewportTransform, SimulationTrigger } from "../types";
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  WIKIDATA_SUBTOPIC_LIMIT,
  WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL
} from "../constants";
import { fetchWikidataSubtopics } from "../services/wikidataService";
import * as geminiService from "../services/geminiService";
import * as hfService from "../services/huggingfaceService";
import { parseTextToNodes } from "../utils/graphUtils";
import { extractFirstNounPhrase, isShortContent, cleanTitleMarkdown, deriveTitleFromContent } from "../utils/titleUtils";

export const useExpansion = (
  nodes: GraphNode[],
  currentScopeId: string | null,
  setNodesCallback: (newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => void,
  setEdgesCallback: (newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => void,
  aiProvider: 'gemini' | 'huggingface',
  setViewTransform: (transform: ViewportTransform) => void,
  setToast: (toast: { visible: boolean; message: string; action?: () => void }) => void,
  setShowLimitModal: (show: boolean) => void,
  startSimulation?: (trigger: SimulationTrigger, subtreeRootId?: string) => void
) => {
  const [expandingNodeIds, setExpandingNodeIds] = useState<string[]>([]);
  const wikidataExpansionInFlightRef = useRef<Set<string>>(new Set());

  const handleExpandNodeFromWikidata = useCallback(
    async (
      id: string,
      topic: string,
      nodeOverride?: GraphNode,
      depth?: number,
      options: { suppressToast?: boolean } = {}
    ): Promise<boolean> => {
      if (wikidataExpansionInFlightRef.current.has(id)) return false;
      wikidataExpansionInFlightRef.current.add(id);

      setExpandingNodeIds((prev) => (prev.includes(id) ? prev : [...prev, id]));

      const sourceNode = nodeOverride || nodes.find((n) => n.id === id);
      if (!sourceNode) {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        wikidataExpansionInFlightRef.current.delete(id);
        return false;
      }

      const depthToUse =
        depth !== undefined ? depth : sourceNode.autoExpandDepth || 1;

      try {
        const subtopics = await fetchWikidataSubtopics(topic, {
          language: "en",
          resultLimit: WIKIDATA_SUBTOPIC_LIMIT,
        });

        if (subtopics.length === 0) {
          if (!options.suppressToast) {
            setToast({
              visible: true,
              message: `No Wikidata subtopics found for "${topic}".`,
            });
          }
          return false;
        }

        const parentNodeId = id;
        const parentNodeX = sourceNode.x;
        const parentNodeY = sourceNode.y;

        const nodesToAdd: GraphNode[] = [];
        const edgesToAdd: GraphEdge[] = [];

        const existingNodesInScope = nodes.filter(
          (n) => (n.scopeId ?? null) === (currentScopeId ?? null)
        );

        const existingByLowerLabel = new Map<string, GraphNode>();
        for (const existingNode of existingNodesInScope) {
          existingByLowerLabel.set(
            existingNode.content.trim().toLowerCase(),
            existingNode
          );
        }

        const subtopicsToCreate = subtopics.filter((st) => {
          const lower = st.label.trim().toLowerCase();
          return !existingByLowerLabel.has(lower);
        });

        const fixedRadius = 500; // Standardized Edge Length
        const startAngle = Math.random() * Math.PI;

        const createdNodes: GraphNode[] = subtopicsToCreate.map((st, i) => {
          const angle =
            startAngle +
            (i / Math.max(subtopicsToCreate.length, 1)) * 2 * Math.PI;

          return {
            id: crypto.randomUUID(),
            type: NodeType.CHAT,
            x: parentNodeX + fixedRadius * Math.cos(angle),
            y: parentNodeY + fixedRadius * Math.sin(angle),
            // Title is now derived from content's first # heading
            content: `# ${st.label}${st.description ? `\n\n**assistant**: ${st.description}` : ''}`,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            link: st.wikidataUrl,
            scopeId: currentScopeId || undefined,
            parentId: id, // Set outline hierarchy parent
            summary: st.description,
            autoExpandDepth: sourceNode.autoExpandDepth,
          };
        });

        nodesToAdd.push(...createdNodes);

        for (const newNode of createdNodes) {
          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: parentNodeId,
            target: newNode.id,
            label: "subtopic",
            scopeId: currentScopeId || undefined,
          });
        }

        for (const st of subtopics) {
          const lower = st.label.trim().toLowerCase();
          const existingNode = existingByLowerLabel.get(lower);
          if (!existingNode) continue;

          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: parentNodeId,
            target: existingNode.id,
            label: "subtopic",
            scopeId: currentScopeId || undefined,
          });
        }

        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd]);

        // Physics simulation disabled - user can trigger manually via node menu
        // if (nodesToAdd.length > 0 && startSimulation) {
        //   setTimeout(() => {
        //     startSimulation('node-expansion', id);
        //   }, 0);
        // }

        if (nodesToAdd.length > 0) {
          let minX = sourceNode.x;
          let maxX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH);
          let minY = sourceNode.y;
          let maxY = sourceNode.y + (sourceNode.height || DEFAULT_NODE_HEIGHT);

          nodesToAdd.forEach((n) => {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x + (n.width || DEFAULT_NODE_WIDTH));
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y + (n.height || DEFAULT_NODE_HEIGHT));
          });

          const padding = 200;
          const width = maxX - minX + padding * 2;
          const height = maxY - minY + padding * 2;

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;

          // Calculate zoom to fit
          const scaleX = window.innerWidth / width;
          const scaleY = window.innerHeight / height;
          let newK = Math.min(scaleX, scaleY, 1);
          newK = Math.max(newK, 0.1);

          setViewTransform({
            x: window.innerWidth / 2 - centerX * newK,
            y: window.innerHeight / 2 - centerY * newK,
            k: newK,
          });
        }

        if (depthToUse > 1 && createdNodes.length > 0) {
          const nodesForRecursion = createdNodes.slice(
            0,
            WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL
          );
          Promise.all(
            nodesForRecursion.map((node) =>
              handleExpandNodeFromWikidata(
                node.id,
                deriveTitleFromContent(node.content),
                node,
                depthToUse - 1
              )
            )
          );
        }
        return true;
      } catch (e: any) {
        console.error("Failed to expand from Wikidata:", e);
        if (!options.suppressToast) {
          setToast({
            visible: true,
            message: `Wikidata request failed for "${topic}".`,
          });
        }
        return false;
      } finally {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        wikidataExpansionInFlightRef.current.delete(id);
      }
    },
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback, setViewTransform, setToast, startSimulation]
  );

  const handleExpandNode = useCallback(
    async (
      id: string,
      topic: string,
      nodeOverride?: GraphNode,
      depth?: number
    ) => {
      setExpandingNodeIds((prev) => [...prev, id]);

      const sourceNode = nodeOverride || nodes.find((n) => n.id === id);
      if (!sourceNode) {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        return;
      }

      const depthToUse =
        depth !== undefined ? depth : sourceNode.autoExpandDepth || 1;

      try {
        const isSelfExpansion =
          sourceNode.content.trim().toLowerCase() ===
          topic.trim().toLowerCase();
        // Improved heuristic for local breakdown vs knowledge expansion
        const isList = /^\s*[-*•]|\d+\./m.test(topic);
        const isContentBreakdown =
          topic.length > 100 || topic.includes("\n") || isList;

        let parentNodeId = id;
        let parentNodeX = sourceNode.x;
        let parentNodeY = sourceNode.y;

        const nodesToAdd: GraphNode[] = [];
        const edgesToAdd: GraphEdge[] = [];
        let topicNode: GraphNode | null = null;
        let nextNodesToExpand: GraphNode[] = [];

        if (!isSelfExpansion && !isContentBreakdown) {
          const topicNodeId = crypto.randomUUID();
          const angle = Math.random() * 2 * Math.PI;
          const offset = 500; // Standardized Edge Length

          parentNodeX = sourceNode.x + offset * Math.cos(angle);
          parentNodeY = sourceNode.y + offset * Math.sin(angle);

          // Title is derived from content's first # heading
          const topicTitle = isShortContent(topic) ? topic : extractFirstNounPhrase(topic);
          topicNode = {
            id: topicNodeId,
            type: NodeType.CHAT,
            x: parentNodeX,
            y: parentNodeY,
            content: `# ${topicTitle}\n\n**assistant**: Expanded topic from "${sourceNode.content}".`,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            scopeId: currentScopeId || undefined,
            parentId: id, // Set outline hierarchy parent
            autoExpandDepth: sourceNode.autoExpandDepth, // Inherit expansion settings
          };

          nodesToAdd.push(topicNode);
          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: id,
            target: topicNodeId,
            label: "includes",
            scopeId: currentScopeId || undefined,
          });

          parentNodeId = topicNodeId;
        }

        if (isContentBreakdown) {
          // --- Local Parsing Mode with Hierarchical Logic ---
          const subItems = parseTextToNodes(topic);

          // Generate titles for items that have long descriptions
          // Use AI for long content, fallback to noun phrase extraction
          const titleService = aiProvider === "huggingface" ? hfService : geminiService;
          const titlePromises = subItems.map(async (item) => {
            // If description is short enough, use item.name directly
            if (isShortContent(item.description)) {
              return item.name;
            }
            // Try AI generation, fall back to noun phrase extraction
            try {
              const aiTitle = await titleService.generateTitleFromContent(item.description);
              return cleanTitleMarkdown(aiTitle || extractFirstNounPhrase(item.description));
            } catch {
              return cleanTitleMarkdown(extractFirstNounPhrase(item.description));
            }
          });

          // Wait for all titles to be generated
          const generatedTitles = await Promise.all(titlePromises);

          // Stack to manage parent context based on indentation
          // Initial context is the source node (or topic node)
          const stack = [
            { indent: -1, id: parentNodeId, x: parentNodeX, y: parentNodeY },
          ];

          subItems.forEach((item, i) => {
            // Algorithm:
            // 1. Find the correct parent. The parent is the node on the stack with indentation strictly less than current item.
            //    If stack top indent >= item indent, pop stack (we are ending that child's scope).
            while (
              stack.length > 1 &&
              stack[stack.length - 1].indent >= item.indent
            ) {
              stack.pop();
            }

            const parent = stack[stack.length - 1];

            const newNodeId = crypto.randomUUID();

            // Place node relative to its specific parent
            // Random angle and distance for organic tree feel
            const angle = Math.random() * 2 * Math.PI;
            const dist = 500; // Standardized Edge Length

            const newNodeX = parent.x + dist * Math.cos(angle);
            const newNodeY = parent.y + dist * Math.sin(angle);

            // Title is derived from content's first # heading
            const newNode: GraphNode = {
              id: newNodeId,
              type: NodeType.CHAT,
              x: newNodeX,
              y: newNodeY,
              content: `# ${generatedTitles[i]}\n\n**assistant**: ${item.description}`,
              width: DEFAULT_NODE_WIDTH,
              height: DEFAULT_NODE_HEIGHT,
              scopeId: currentScopeId || undefined,
              parentId: parent.id, // Set outline hierarchy parent
              summary: item.description,
              autoExpandDepth: sourceNode.autoExpandDepth,
            };

            nodesToAdd.push(newNode);

            edgesToAdd.push({
              id: crypto.randomUUID(),
              source: parent.id,
              target: newNodeId,
              label: item.indent > parent.indent ? "sub-item" : "related",
              scopeId: currentScopeId || undefined,
            });

            // Push current node to stack as a potential parent for subsequent items
            stack.push({
              indent: item.indent,
              id: newNodeId,
              x: newNodeX,
              y: newNodeY,
            });
          });
        } else {
          // --- Gemini API Mode (AI Expansion) ---
          const existingNodeNames = nodes
            .filter((n) => (n.scopeId ?? null) === (currentScopeId ?? null))
            .map((n) => n.content);
          const result = await (aiProvider === "huggingface"
            ? hfService
            : geminiService
          ).expandNodeTopic(topic, existingNodeNames);

          if (topicNode && result.mainTopic) {
            topicNode.content = result.mainTopic;
          }

          if (result.nodes.length > 0) {
            // Standardized Circular Placement
            const fixedRadius = 500; // Standardized Edge Length
            const startAngle = Math.random() * Math.PI;

            const subNodes: GraphNode[] = result.nodes.map((n, i) => {
              // Distribute evenly in a circle to maintain roughly equal edge length
              const angle =
                startAngle + (i / result.nodes.length) * 2 * Math.PI;

              // Title is derived from content's first # heading
              return {
                id: crypto.randomUUID(),
                type: NodeType.CHAT,
                x: parentNodeX + fixedRadius * Math.cos(angle),
                y: parentNodeY + fixedRadius * Math.sin(angle),
                content: `# ${n.name}\n\n**assistant**: ${n.description}`,
                width: DEFAULT_NODE_WIDTH,
                height: DEFAULT_NODE_HEIGHT,
                link: n.wikiLink,
                scopeId: currentScopeId || undefined,
                parentId: parentNodeId, // Set outline hierarchy parent
                summary: n.description, // Store description for semantic zoom
                autoExpandDepth: sourceNode.autoExpandDepth,
              };
            });

            nodesToAdd.push(...subNodes);
            nextNodesToExpand = subNodes; // Mark these for potential recursion

            // Create map for edge matching using original AI names
            const nameToNode = new Map<string, GraphNode>();
            result.nodes.forEach((n, i) => {
              nameToNode.set(n.name, subNodes[i]);
            });

            // Connect edges
            result.edges.forEach((e) => {
              // Match against original AI-returned name (exact match)
              const targetSubNode = nameToNode.get(e.targetName);

              // For existing nodes, also try case-insensitive match
              const targetExistingNode = nodes.find(
                (n) => {
                  const nodeTitle = deriveTitleFromContent(n.content);
                  return (nodeTitle === e.targetName ||
                          nodeTitle.toLowerCase() === e.targetName.toLowerCase()) &&
                         (n.scopeId ?? null) === (currentScopeId ?? null);
                }
              );

              if (targetSubNode) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: targetSubNode.id,
                  label: e.relationship,
                  scopeId: currentScopeId || undefined,
                });
              } else if (targetExistingNode) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: targetExistingNode.id,
                  label: e.relationship,
                  scopeId: currentScopeId || undefined,
                });
              }
            });

            // Fallback connectivity
            subNodes.forEach((sn) => {
              const isConnected = edgesToAdd.some((e) => e.target === sn.id);
              if (!isConnected) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: sn.id,
                  label: "related",
                  scopeId: currentScopeId || undefined,
                });
              }
            });
          }
        }

        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd]);

        // Physics simulation disabled - user can trigger manually via node menu
        // if (nodesToAdd.length > 0 && startSimulation) {
        //   setTimeout(() => {
        //     startSimulation('node-expansion', id);
        //   }, 0);
        // }

        if (nodesToAdd.length > 0) {
          // Calculate bounds of the new cluster + parent
          let minX = sourceNode.x;
          let maxX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH);
          let minY = sourceNode.y;
          let maxY = sourceNode.y + (sourceNode.height || DEFAULT_NODE_HEIGHT);

          nodesToAdd.forEach((n) => {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x + (n.width || DEFAULT_NODE_WIDTH));
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y + (n.height || DEFAULT_NODE_HEIGHT));
          });

          const padding = 200; // Increased padding for larger graph
          const width = maxX - minX + padding * 2;
          const height = maxY - minY + padding * 2;

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;

          // Calculate zoom to fit
          const scaleX = window.innerWidth / width;
          const scaleY = window.innerHeight / height;
          let newK = Math.min(scaleX, scaleY, 1); // Cap at 1.0 zoom (don't zoom in too close)
          newK = Math.max(newK, 0.1);

          setViewTransform({
            x: window.innerWidth / 2 - centerX * newK,
            y: window.innerHeight / 2 - centerY * newK,
            k: newK,
          });
        }

        // Recursive Expansion
        if (depthToUse > 1 && nextNodesToExpand.length > 0) {
          // We process these asynchronously without blocking UI
          Promise.all(
            nextNodesToExpand.map((node) =>
              handleExpandNode(node.id, node.content, node, depthToUse - 1)
            )
          );
        }
      } catch (e: any) {
        if (e.message === "LIMIT_REACHED") {
          setShowLimitModal(true);
        } else {
          console.error("Failed to expand:", e);
        }
      } finally {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
      }
    },
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback, aiProvider, handleExpandNodeFromWikidata, setViewTransform, setShowLimitModal, startSimulation]
  );

  return {
    expandingNodeIds,
    handleExpandNode,
    handleExpandNodeFromWikidata,
  };
};

