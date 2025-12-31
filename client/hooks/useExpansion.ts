import { useState, useRef, useCallback } from "react";
import { GraphNode, GraphEdge, NodeType, ViewportTransform } from "../types";
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

export const useExpansion = (
  nodes: GraphNode[],
  currentScopeId: string | null,
  setNodesCallback: (newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => void,
  setEdgesCallback: (newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => void,
  aiProvider: 'gemini' | 'huggingface',
  setViewTransform: (transform: ViewportTransform) => void,
  setToast: (toast: { visible: boolean; message: string; action?: () => void }) => void,
  setShowLimitModal: (show: boolean) => void
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
          (n) => (n.parentId ?? null) === (currentScopeId ?? null)
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
            content: st.label,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            link: st.wikidataUrl,
            parentId: currentScopeId || undefined,
            summary: st.description,
            autoExpandDepth: sourceNode.autoExpandDepth,
            messages: st.description
              ? [
                  {
                    role: "model",
                    text: st.description,
                    timestamp: Date.now(),
                  },
                ]
              : [],
          };
        });

        nodesToAdd.push(...createdNodes);

        for (const newNode of createdNodes) {
          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: parentNodeId,
            target: newNode.id,
            label: "subtopic",
            parentId: currentScopeId || undefined,
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
            parentId: currentScopeId || undefined,
          });
        }

        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd]);

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
                node.content,
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
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback, setViewTransform, setToast]
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

          topicNode = {
            id: topicNodeId,
            type: NodeType.CHAT,
            x: parentNodeX,
            y: parentNodeY,
            content: topic,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            parentId: currentScopeId || undefined,
            autoExpandDepth: sourceNode.autoExpandDepth, // Inherit expansion settings
            messages: [
              {
                role: "model",
                text: `Expanded topic from "${sourceNode.content}".`,
                timestamp: Date.now(),
              },
            ],
          };

          nodesToAdd.push(topicNode);
          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: id,
            target: topicNodeId,
            label: "includes",
            parentId: currentScopeId || undefined,
          });

          parentNodeId = topicNodeId;
        }

        if (isContentBreakdown) {
          // --- Local Parsing Mode with Hierarchical Logic ---
          const subItems = parseTextToNodes(topic);

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

            const newNode: GraphNode = {
              id: newNodeId,
              type: NodeType.CHAT,
              x: newNodeX,
              y: newNodeY,
              content: item.name,
              width: DEFAULT_NODE_WIDTH,
              height: DEFAULT_NODE_HEIGHT,
              parentId: currentScopeId || undefined,
              summary: item.description,
              autoExpandDepth: sourceNode.autoExpandDepth,
              messages: [
                {
                  role: "model",
                  text: item.description,
                  timestamp: Date.now(),
                },
              ],
            };

            nodesToAdd.push(newNode);

            edgesToAdd.push({
              id: crypto.randomUUID(),
              source: parent.id,
              target: newNodeId,
              label: item.indent > parent.indent ? "sub-item" : "related",
              parentId: currentScopeId || undefined,
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
          // --- Wikidata Check ---
          // Try to expand from Wikidata first
          const wikidataSuccess = await handleExpandNodeFromWikidata(
            id,
            topic,
            sourceNode,
            depth,
            { suppressToast: true }
          );

          if (wikidataSuccess) return;

          // Restart spinner if fallback (it was removed by handleExpandNodeFromWikidata)
          setExpandingNodeIds((prev) => [...prev, id]);

          // --- Gemini API Mode ---
          const existingNodeNames = nodes
            .filter((n) => (n.parentId ?? null) === (currentScopeId ?? null))
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

              return {
                id: crypto.randomUUID(),
                type: NodeType.CHAT,
                x: parentNodeX + fixedRadius * Math.cos(angle),
                y: parentNodeY + fixedRadius * Math.sin(angle),
                content: n.name,
                width: DEFAULT_NODE_WIDTH,
                height: DEFAULT_NODE_HEIGHT,
                link: n.wikiLink,
                parentId: currentScopeId || undefined,
                summary: n.description, // Store description for semantic zoom
                autoExpandDepth: sourceNode.autoExpandDepth,
                messages: [
                  {
                    role: "model",
                    text: n.description,
                    timestamp: Date.now(),
                  },
                ],
              };
            });

            nodesToAdd.push(...subNodes);
            nextNodesToExpand = subNodes; // Mark these for potential recursion

            // Connect edges
            result.edges.forEach((e) => {
              const targetSubNode = subNodes.find(
                (sn) => sn.content === e.targetName
              );
              const targetExistingNode = nodes.find(
                (n) =>
                  n.content === e.targetName && (n.parentId ?? null) === (currentScopeId ?? null)
              );

              if (targetSubNode) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: targetSubNode.id,
                  label: e.relationship,
                  parentId: currentScopeId || undefined,
                });
              } else if (targetExistingNode) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: targetExistingNode.id,
                  label: e.relationship,
                  parentId: currentScopeId || undefined,
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
                  parentId: currentScopeId || undefined,
                });
              }
            });
          }
        }

        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd]);

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
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback, aiProvider, handleExpandNodeFromWikidata, setViewTransform, setShowLimitModal]
  );

  return {
    expandingNodeIds,
    handleExpandNode,
    handleExpandNodeFromWikidata,
  };
};

