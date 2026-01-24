import { useState, useRef, useCallback } from "react";
import { GraphNode, GraphEdge, NodeType, ViewportTransform, SimulationTrigger, PendingExpansion, DuplicateCheckResult, ExpandResponse } from "../types";
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  WIKIDATA_SUBTOPIC_LIMIT,
  WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL
} from "../constants";
import { fetchWikidataSubtopics, WikidataSubtopic } from "../services/wikidataService";
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
  const [pendingExpansion, setPendingExpansion] = useState<PendingExpansion | null>(null);
  const wikidataExpansionInFlightRef = useRef<Set<string>>(new Set());

  // Helper to create nodes and edges from AI expansion result
  const createNodesFromAIResult = useCallback(
    (
      result: ExpandResponse,
      sourceNode: GraphNode,
      parentNodeId: string,
      excludeIndices: Set<number> = new Set()
    ): { nodesToAdd: GraphNode[]; edgesToAdd: GraphEdge[] } => {
      const nodesToAdd: GraphNode[] = [];
      const edgesToAdd: GraphEdge[] = [];
      const parentNodeX = sourceNode.x;
      const parentNodeY = sourceNode.y;

      const fixedRadius = 500;
      const startAngle = Math.random() * Math.PI;

      // Filter out excluded indices (nodes that will link to existing instead)
      const nodesToCreate = result.nodes.filter((_, i) => !excludeIndices.has(i));

      const subNodes: GraphNode[] = nodesToCreate.map((n, i) => {
        const angle = startAngle + (i / Math.max(nodesToCreate.length, 1)) * 2 * Math.PI;
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
          parentId: parentNodeId,
          summary: n.description,
          autoExpandDepth: sourceNode.autoExpandDepth,
        };
      });

      nodesToAdd.push(...subNodes);

      // Create map for edge matching (case-insensitive)
      const nameToNode = new Map<string, GraphNode>();
      let subNodeIndex = 0;
      result.nodes.forEach((n, i) => {
        if (!excludeIndices.has(i)) {
          nameToNode.set(n.name.toLowerCase(), subNodes[subNodeIndex]);
          subNodeIndex++;
        }
      });

      // Connect edges (case-insensitive matching)
      result.edges.forEach((e) => {
        const targetNameLower = e.targetName.toLowerCase();
        const targetSubNode = nameToNode.get(targetNameLower);
        const targetExistingNode = nodes.find((n) => {
          const nodeTitle = deriveTitleFromContent(n.content);
          return (
            nodeTitle.toLowerCase() === targetNameLower &&
            (n.scopeId ?? null) === (currentScopeId ?? null)
          );
        });

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

      // Fallback connectivity - ensure all new nodes have at least one edge
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

      console.log('[AI Expansion] Edges to add:', edgesToAdd.length, 'from', result.edges.length, 'AI edges');

      return { nodesToAdd, edgesToAdd };
    },
    [nodes, currentScopeId]
  );

  // Helper to create nodes from Wikidata subtopics
  const createNodesFromWikidata = useCallback(
    (
      subtopics: WikidataSubtopic[],
      sourceNode: GraphNode,
      parentNodeId: string,
      excludeIndices: Set<number> = new Set()
    ): { nodesToAdd: GraphNode[]; edgesToAdd: GraphEdge[] } => {
      const nodesToAdd: GraphNode[] = [];
      const edgesToAdd: GraphEdge[] = [];
      const parentNodeX = sourceNode.x;
      const parentNodeY = sourceNode.y;

      const fixedRadius = 500;
      const startAngle = Math.random() * Math.PI;

      const subtopicsToCreate = subtopics.filter((_, i) => !excludeIndices.has(i));

      const createdNodes: GraphNode[] = subtopicsToCreate.map((st, i) => {
        const angle = startAngle + (i / Math.max(subtopicsToCreate.length, 1)) * 2 * Math.PI;
        return {
          id: crypto.randomUUID(),
          type: NodeType.CHAT,
          x: parentNodeX + fixedRadius * Math.cos(angle),
          y: parentNodeY + fixedRadius * Math.sin(angle),
          content: `# ${st.label}${st.description ? `\n\n**assistant**: ${st.description}` : ""}`,
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
          link: st.wikidataUrl,
          scopeId: currentScopeId || undefined,
          parentId: parentNodeId,
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

      return { nodesToAdd, edgesToAdd };
    },
    [currentScopeId]
  );

  // Helper to pan/zoom to fit new nodes
  const panToFitNodes = useCallback(
    (sourceNode: GraphNode, newNodes: GraphNode[]) => {
      if (newNodes.length === 0) return;

      let minX = sourceNode.x;
      let maxX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH);
      let minY = sourceNode.y;
      let maxY = sourceNode.y + (sourceNode.height || DEFAULT_NODE_HEIGHT);

      newNodes.forEach((n) => {
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

      const scaleX = window.innerWidth / width;
      const scaleY = window.innerHeight / height;
      let newK = Math.min(scaleX, scaleY, 1);
      newK = Math.max(newK, 0.1);

      setViewTransform({
        x: window.innerWidth / 2 - centerX * newK,
        y: window.innerHeight / 2 - centerY * newK,
        k: newK,
      });
    },
    [setViewTransform]
  );

  // Handler for "Create All Anyway" in duplicate modal
  const handleCreateAllAnyway = useCallback(() => {
    if (!pendingExpansion) return;

    const { sourceNode, sourceNodeId, result, isWikidata, wikidataSubtopics } = pendingExpansion;

    if (isWikidata && wikidataSubtopics) {
      const { nodesToAdd, edgesToAdd } = createNodesFromWikidata(
        wikidataSubtopics,
        sourceNode,
        sourceNodeId
      );
      setNodesCallback((prev) => [...prev, ...nodesToAdd]);
      setEdgesCallback((prev) => [...prev, ...edgesToAdd]);
      panToFitNodes(sourceNode, nodesToAdd);
    } else {
      const { nodesToAdd, edgesToAdd } = createNodesFromAIResult(
        result,
        sourceNode,
        sourceNodeId
      );
      setNodesCallback((prev) => [...prev, ...nodesToAdd]);
      setEdgesCallback((prev) => [...prev, ...edgesToAdd]);
      panToFitNodes(sourceNode, nodesToAdd);
    }

    setExpandingNodeIds((prev) => prev.filter((nId) => nId !== sourceNodeId));
    setPendingExpansion(null);
  }, [pendingExpansion, createNodesFromAIResult, createNodesFromWikidata, setNodesCallback, setEdgesCallback, panToFitNodes]);

  // Handler for "Link to Existing" in duplicate modal
  const handleLinkToExisting = useCallback(
    (linkMapping: Map<number, string>) => {
      if (!pendingExpansion) return;

      const { sourceNode, sourceNodeId, result, duplicates, isWikidata, wikidataSubtopics } = pendingExpansion;

      // Build set of indices to exclude from creation (they'll link instead)
      const excludeIndices = new Set<number>();
      const edgesToExisting: GraphEdge[] = [];

      linkMapping.forEach((existingNodeId, proposedIndex) => {
        excludeIndices.add(proposedIndex);
        // Create edge to existing node
        edgesToExisting.push({
          id: crypto.randomUUID(),
          source: sourceNodeId,
          target: existingNodeId,
          label: "related",
          scopeId: currentScopeId || undefined,
        });
      });

      if (isWikidata && wikidataSubtopics) {
        const { nodesToAdd, edgesToAdd } = createNodesFromWikidata(
          wikidataSubtopics,
          sourceNode,
          sourceNodeId,
          excludeIndices
        );
        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd, ...edgesToExisting]);
        panToFitNodes(sourceNode, nodesToAdd);
      } else {
        const { nodesToAdd, edgesToAdd } = createNodesFromAIResult(
          result,
          sourceNode,
          sourceNodeId,
          excludeIndices
        );
        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd, ...edgesToExisting]);
        panToFitNodes(sourceNode, nodesToAdd);
      }

      setExpandingNodeIds((prev) => prev.filter((nId) => nId !== sourceNodeId));
      setPendingExpansion(null);
    },
    [pendingExpansion, currentScopeId, createNodesFromAIResult, createNodesFromWikidata, setNodesCallback, setEdgesCallback, panToFitNodes]
  );

  // Handler for "Cancel" in duplicate modal
  const handleCancelExpansion = useCallback(() => {
    if (pendingExpansion) {
      setExpandingNodeIds((prev) => prev.filter((nId) => nId !== pendingExpansion.sourceNodeId));
    }
    setPendingExpansion(null);
  }, [pendingExpansion]);

  const handleExpandNodeFromWikidata = useCallback(
    async (
      id: string,
      topic: string,
      nodeOverride?: GraphNode,
      depth?: number,
      options: { suppressToast?: boolean; skipDuplicateCheck?: boolean } = {}
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
          setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
          wikidataExpansionInFlightRef.current.delete(id);
          return false;
        }

        // Filter out exact label matches first (existing behavior)
        const existingByLowerLabel = new Map<string, GraphNode>();
        for (const existingNode of nodes) {
          existingByLowerLabel.set(
            existingNode.content.trim().toLowerCase(),
            existingNode
          );
        }

        const subtopicsToCreate = subtopics.filter((st) => {
          const lower = st.label.trim().toLowerCase();
          return !existingByLowerLabel.has(lower);
        });

        // Check for semantic duplicates if not skipped
        if (!options.skipDuplicateCheck && subtopicsToCreate.length > 0) {
          const duplicates = await geminiService.checkForDuplicates(
            subtopicsToCreate.map((st) => ({ name: st.label, description: st.description }))
          );

          if (duplicates.length > 0) {
            // Store pending expansion and show modal
            setPendingExpansion({
              sourceNodeId: id,
              sourceNode,
              result: { nodes: [], edges: [] }, // Not used for Wikidata
              duplicates,
              isWikidata: true,
              wikidataSubtopics: subtopicsToCreate,
            });
            wikidataExpansionInFlightRef.current.delete(id);
            // Don't clear expandingNodeIds - modal handlers will do that
            return false;
          }
        }

        // No duplicates found, proceed with creation
        const { nodesToAdd, edgesToAdd } = createNodesFromWikidata(
          subtopicsToCreate,
          sourceNode,
          id
        );

        // Also create edges to existing nodes that match by label
        for (const st of subtopics) {
          const lower = st.label.trim().toLowerCase();
          const existingNode = existingByLowerLabel.get(lower);
          if (existingNode) {
            edgesToAdd.push({
              id: crypto.randomUUID(),
              source: id,
              target: existingNode.id,
              label: "subtopic",
              scopeId: currentScopeId || undefined,
            });
          }
        }

        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd]);
        panToFitNodes(sourceNode, nodesToAdd);

        if (depthToUse > 1 && nodesToAdd.length > 0) {
          const nodesForRecursion = nodesToAdd.slice(
            0,
            WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL
          );
          Promise.all(
            nodesForRecursion.map((node) =>
              handleExpandNodeFromWikidata(
                node.id,
                deriveTitleFromContent(node.content),
                node,
                depthToUse - 1,
                { skipDuplicateCheck: true } // Skip duplicate check for recursive expansions
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
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback, setToast, createNodesFromWikidata, panToFitNodes]
  );

  const handleExpandNode = useCallback(
    async (
      id: string,
      topic: string,
      nodeOverride?: GraphNode,
      depth?: number,
      options: { skipDuplicateCheck?: boolean } = {}
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
        // Improved heuristic for local breakdown vs knowledge expansion
        const isList = /^\s*[-*•]|\d+\./m.test(topic);
        const isContentBreakdown =
          topic.length > 100 || topic.includes("\n") || isList;

        console.log('[AI Expansion] handleExpandNode called');
        console.log('[AI Expansion] topic:', topic);
        console.log('[AI Expansion] topic.length:', topic.length, 'isList:', isList, 'isContentBreakdown:', isContentBreakdown);

        if (isContentBreakdown) {
          // --- Local Parsing Mode with Hierarchical Logic ---
          // Skip duplicate checking for local content breakdown (user's own content)
          const subItems = parseTextToNodes(topic);
          const parentNodeId = id;
          const parentNodeX = sourceNode.x;
          const parentNodeY = sourceNode.y;

          const nodesToAdd: GraphNode[] = [];
          const edgesToAdd: GraphEdge[] = [];

          // Generate titles for items that have long descriptions
          const titleService = aiProvider === "huggingface" ? hfService : geminiService;
          const titlePromises = subItems.map(async (item) => {
            if (isShortContent(item.description)) {
              return item.name;
            }
            try {
              const aiTitle = await titleService.generateTitleFromContent(item.description);
              return cleanTitleMarkdown(aiTitle || extractFirstNounPhrase(item.description));
            } catch {
              return cleanTitleMarkdown(extractFirstNounPhrase(item.description));
            }
          });

          const generatedTitles = await Promise.all(titlePromises);

          const stack = [
            { indent: -1, id: parentNodeId, x: parentNodeX, y: parentNodeY },
          ];

          subItems.forEach((item, i) => {
            while (
              stack.length > 1 &&
              stack[stack.length - 1].indent >= item.indent
            ) {
              stack.pop();
            }

            const parent = stack[stack.length - 1];
            const newNodeId = crypto.randomUUID();
            const angle = Math.random() * 2 * Math.PI;
            const dist = 500;
            const newNodeX = parent.x + dist * Math.cos(angle);
            const newNodeY = parent.y + dist * Math.sin(angle);

            const newNode: GraphNode = {
              id: newNodeId,
              type: NodeType.CHAT,
              x: newNodeX,
              y: newNodeY,
              content: `# ${generatedTitles[i]}\n\n**assistant**: ${item.description}`,
              width: DEFAULT_NODE_WIDTH,
              height: DEFAULT_NODE_HEIGHT,
              scopeId: currentScopeId || undefined,
              parentId: parent.id,
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

            stack.push({
              indent: item.indent,
              id: newNodeId,
              x: newNodeX,
              y: newNodeY,
            });
          });

          setNodesCallback((prev) => [...prev, ...nodesToAdd]);
          setEdgesCallback((prev) => [...prev, ...edgesToAdd]);
          panToFitNodes(sourceNode, nodesToAdd);
        } else {
          // --- Gemini API Mode (AI Expansion) ---
          console.log('[AI Expansion] Starting expansion for topic:', topic);

          const existingNodeNames = nodes
            .filter((n) => (n.scopeId ?? null) === (currentScopeId ?? null))
            .map((n) => n.content);
          const result = await (aiProvider === "huggingface"
            ? hfService
            : geminiService
          ).expandNodeTopic(topic, existingNodeNames);

          console.log('[AI Expansion] AI result:', result);
          console.log('[AI Expansion] result.nodes.length:', result.nodes.length);

          if (result.nodes.length > 0) {
            // Check for semantic duplicates if not skipped
            if (!options.skipDuplicateCheck) {
              const duplicates = await geminiService.checkForDuplicates(
                result.nodes.map((n) => ({ name: n.name, description: n.description }))
              );

              if (duplicates.length > 0) {
                // Store pending expansion and show modal
                setPendingExpansion({
                  sourceNodeId: id,
                  sourceNode,
                  result,
                  duplicates,
                  isWikidata: false,
                });
                // Don't clear expandingNodeIds - modal handlers will do that
                return;
              }
            }

            // No duplicates found, proceed with creation using helper
            const { nodesToAdd, edgesToAdd } = createNodesFromAIResult(
              result,
              sourceNode,
              id
            );

            setNodesCallback((prev) => [...prev, ...nodesToAdd]);
            setEdgesCallback((prev) => [...prev, ...edgesToAdd]);
            panToFitNodes(sourceNode, nodesToAdd);

            // Recursive Expansion
            if (depthToUse > 1 && nodesToAdd.length > 0) {
              Promise.all(
                nodesToAdd.map((node) =>
                  handleExpandNode(node.id, deriveTitleFromContent(node.content), node, depthToUse - 1, { skipDuplicateCheck: true })
                )
              );
            }
          }
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
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback, aiProvider, setShowLimitModal, createNodesFromAIResult, panToFitNodes]
  );

  return {
    expandingNodeIds,
    handleExpandNode,
    handleExpandNodeFromWikidata,
    pendingExpansion,
    handleCreateAllAnyway,
    handleLinkToExisting,
    handleCancelExpansion,
  };
};

