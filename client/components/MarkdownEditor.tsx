import React, { useCallback, useEffect, useRef, useState } from "react";
import { GraphNode } from "../types";
import { NODE_COLORS } from "../constants";
import { INTERNAL_NODE_LINK_REGEX, getNodeTitle } from "../utils/wikiLinks";

interface MarkdownEditorProps {
  initialContent: string;
  onChange: (content: string) => void;
  className?: string;
  placeholder?: string;
  onNavigateToNode?: (title: string) => void;
  allNodes?: GraphNode[];
}

type LoadedCodeMirror = {
  EditorView: any;
  EditorState: any;
  EditorSelection: any;
  keymap: any;
  ViewPlugin: any;
  Decoration: any;
  WidgetType: any;
  placeholder: any;
  defaultKeymap: any[];
  historyKeymap: any[];
  history: () => any;
  markdown: any;
  markdownLanguage: any;
  syntaxTree: any;
  languages: any;
  syntaxHighlighting: any;
  defaultHighlightStyle: any;
  hljs: any;
};

type LinkDropdownState = {
  position: { left: number; top: number };
  query: string;
};

const INLINE_LINK_DROPDOWN_WIDTH = 320;

const cmImport = (specifier: string) =>
  `https://esm.sh/${specifier}?target=esnext`;

let loadPromise: Promise<LoadedCodeMirror> | null = null;

const loadCodeMirror = async (): Promise<LoadedCodeMirror> => {
  if (!loadPromise) {
    loadPromise = (async () => {
      const [
        viewModule,
        stateModule,
        commandsModule,
        markdownModule,
        languageModule,
        languageDataModule,
        highlightModule,
      ] = await Promise.all([
        import(/* @vite-ignore */ cmImport("@codemirror/view@6.39.3")),
        import(/* @vite-ignore */ cmImport("@codemirror/state@6.5.2")),
        import(/* @vite-ignore */ cmImport("@codemirror/commands@6.10.0")),
        import(/* @vite-ignore */ cmImport("@codemirror/lang-markdown@6.5.0")),
        import(/* @vite-ignore */ cmImport("@codemirror/language@6.11.3")),
        import(/* @vite-ignore */ cmImport("@codemirror/language-data@6.5.2")),
        import(/* @vite-ignore */ cmImport("highlight.js@11.9.0")),
      ]);
      const hljs = (highlightModule.default || highlightModule) as any;

      return {
        EditorView: viewModule.EditorView,
        EditorState: stateModule.EditorState,
        EditorSelection: stateModule.EditorSelection,
        keymap: viewModule.keymap,
        ViewPlugin: viewModule.ViewPlugin,
        Decoration: viewModule.Decoration,
        WidgetType: viewModule.WidgetType,
        placeholder: viewModule.placeholder,
        defaultKeymap: commandsModule.defaultKeymap,
        historyKeymap: commandsModule.historyKeymap,
        history: commandsModule.history,
        markdown: markdownModule.markdown,
        markdownLanguage: markdownModule.markdownLanguage,
        syntaxTree: languageModule.syntaxTree,
        languages: languageDataModule.languages,
        syntaxHighlighting: languageModule.syntaxHighlighting,
        defaultHighlightStyle: languageModule.defaultHighlightStyle,
        hljs,
      };
    })();
  }

  return loadPromise;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const createLivePreviewPlugin = (
  cm: LoadedCodeMirror,
  getNavigateToNode?: () => ((title: string) => void) | undefined
) => {
  const { ViewPlugin, Decoration, WidgetType, syntaxTree, hljs } = cm;

  const getActiveLineNumbers = (state: any) => {
    const lines = new Set<number>();
    if (!state?.selection?.ranges) return lines;
    state.selection.ranges.forEach((range: any) => {
      const anchorLine = state.doc.lineAt(range.anchor).number;
      const headLine = state.doc.lineAt(range.head).number;
      const from = Math.min(anchorLine, headLine);
      const to = Math.max(anchorLine, headLine);
      for (let line = from; line <= to; line++) {
        lines.add(line);
      }
    });
    return lines;
  };

  const nodeTouchesActiveLine = (
    state: any,
    node: { from: number; to: number },
    activeLines: Set<number>
  ) => {
    const startLine = state.doc.lineAt(node.from).number;
    const endLine = state.doc.lineAt(node.to).number;
    for (let line = startLine; line <= endLine; line++) {
      if (activeLines.has(line)) return true;
    }
    return false;
  };

  const highlightCode = (code: string, lang?: string | null) => {
    if (!code) return "";
    if (!hljs || typeof hljs.highlight !== "function") return escapeHtml(code);
    try {
      if (lang && hljs.getLanguage?.(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  };

  class CodeBlockWidget extends WidgetType {
    html: string;
    langLabel: string | null;
    constructor(html: string, langLabel: string | null) {
      super();
      this.html = html;
      this.langLabel = langLabel;
    }
    eq(other: CodeBlockWidget) {
      return other.html === this.html && other.langLabel === this.langLabel;
    }
    toDOM() {
      const wrapper = document.createElement("div");
      wrapper.className = "cm-md-codeblock";
      if (this.langLabel) {
        const badge = document.createElement("span");
        badge.className = "cm-md-codeblock-lang";
        badge.textContent = this.langLabel.toUpperCase();
        wrapper.appendChild(badge);
      }
      const pre = document.createElement("pre");
      pre.className = "hljs";
      pre.innerHTML = this.html;
      wrapper.appendChild(pre);
      return wrapper;
    }
  }

  class WikiLinkWidget extends WidgetType {
    label: string;
    target: string;
    getNavigate?: () => ((title: string) => void) | undefined;

    constructor(
      label: string,
      target: string,
      getNavigate?: () => ((title: string) => void) | undefined
    ) {
      super();
      this.label = label;
      this.target = target;
      this.getNavigate = getNavigate;
    }

    eq(other: WikiLinkWidget) {
      return other.label === this.label && other.target === this.target;
    }

    toDOM() {
      const anchor = document.createElement("span");
      anchor.className = "cm-md-internal-link";
      anchor.textContent = this.label;
      anchor.title = `Jump to ${this.target}`;
      anchor.addEventListener("mousedown", (e) => e.preventDefault());
      anchor.addEventListener("click", (e) => {
        e.preventDefault();
        const navigate = this.getNavigate?.();
        navigate?.(this.target);
      });
      return anchor;
    }
  }

  const computeDecorations = (view: any) => {
    const ranges: any[] = [];
    const activeLines = getActiveLineNumbers(view.state);
    const processedLines = new Set<number>();
    const suppressedRanges: Array<{ from: number; to: number }> = [];
    const isSuppressed = (pos: number) =>
      suppressedRanges.some((range) => pos >= range.from && pos < range.to);

    class BulletWidget extends WidgetType {
      bulletChar: string;
      constructor(bulletChar: string) {
        super();
        this.bulletChar = bulletChar;
      }
      eq(other: BulletWidget) {
        return other.bulletChar === this.bulletChar;
      }
      toDOM() {
        const span = document.createElement("span");
        span.className = "cm-md-bullet";
        span.textContent = "• ";
        return span;
      }
    }

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter: (node: any) => {
          if (nodeTouchesActiveLine(view.state, node, activeLines)) return;
          const text = view.state.sliceDoc(node.from, node.to);

          if (node.name === "StrongEmphasis") {
            const markerLength =
              text.startsWith("**") || text.startsWith("__") ? 2 : 0;
            if (markerLength >= 2 && text.length >= markerLength * 2) {
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.from,
                  node.from + markerLength
                )
              );
              ranges.push(
                Decoration.mark({ class: "cm-md-bold" }).range(
                  node.from + markerLength,
                  node.to - markerLength
                )
              );
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.to - markerLength,
                  node.to
                )
              );
            }
          } else if (node.name === "Emphasis") {
            const markerLength =
              (text.startsWith("*") && text.endsWith("*")) ||
              (text.startsWith("_") && text.endsWith("_"))
                ? 1
                : 0;
            if (markerLength === 1 && text.length >= 2) {
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.from,
                  node.from + 1
                )
              );
              ranges.push(
                Decoration.mark({ class: "cm-md-italic" }).range(
                  node.from + 1,
                  node.to - 1
                )
              );
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.to - 1,
                  node.to
                )
              );
            }
          } else if (node.name?.startsWith("ATXHeading")) {
            const match = text.match(/^(#{1,6})\s+/);
            if (match) {
              const level = match[1].length;
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.from,
                  node.from + match[0].length
                )
              );
              ranges.push(
                Decoration.mark({
                  class:
                    level === 1
                      ? "cm-md-h1"
                      : level === 2
                      ? "cm-md-h2"
                      : "cm-md-h3",
                }).range(node.from + match[0].length, node.to)
              );
            }
          } else if (node.name === "Blockquote") {
            if (text.startsWith(">")) {
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.from,
                  node.from + 1
                )
              );
              ranges.push(
                Decoration.mark({ class: "cm-md-quote" }).range(
                  node.from + 1,
                  node.to
                )
              );
            }
          } else if (node.name === "CodeSpan") {
            if (text.startsWith("`") && text.endsWith("`")) {
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.from,
                  node.from + 1
                )
              );
              ranges.push(
                Decoration.mark({ class: "cm-md-code" }).range(
                  node.from + 1,
                  node.to - 1
                )
              );
              ranges.push(
                Decoration.mark({ class: "cm-md-hidden" }).range(
                  node.to - 1,
                  node.to
                )
              );
            }
          } else if (node.name === "FencedCode") {
            if (nodeTouchesActiveLine(view.state, node, activeLines)) return;
            const fenceLine = view.state.doc.lineAt(node.from);
            const langMatch = fenceLine.text.match(/^```([^\s]*)?/);
            const langLabel = langMatch?.[1]?.trim() || null;
            const afterFenceStart =
              fenceLine.number < view.state.doc.lines
                ? fenceLine.to + 1
                : fenceLine.to;
            const endLine = view.state.doc.lineAt(
              Math.max(node.to - 1, node.from)
            );
            let contentStart = Math.min(afterFenceStart, node.to);
            let contentEnd = node.to;
            if (endLine.number !== fenceLine.number) {
              if (endLine.text.trim().startsWith("```")) {
                contentEnd = Math.max(contentStart, endLine.from);
              }
            }
            const code = view.state.sliceDoc(contentStart, contentEnd);
            const html = highlightCode(code, langLabel?.toLowerCase());
            ranges.push(
              Decoration.widget({
                widget: new CodeBlockWidget(html, langLabel),
              }).range(fenceLine.from, fenceLine.from)
            );
            ranges.push(
              Decoration.mark({ class: "cm-md-block-hidden" }).range(
                fenceLine.from,
                node.to
              )
            );
            suppressedRanges.push({ from: fenceLine.from, to: node.to });
          }
        },
      });
    }

    for (const { from, to } of view.visibleRanges) {
      let line = view.state.doc.lineAt(from);
      while (true) {
        if (!processedLines.has(line.number)) {
          const lineSuppressed = isSuppressed(line.from);
          if (lineSuppressed) {
            processedLines.add(line.number);
            if (line.to >= to || line.number >= view.state.doc.lines) break;
            line = view.state.doc.line(line.number + 1);
            continue;
          }
          const match = line.text.match(/^(\s*)([-*])\s+/);
          if (match) {
            const indentLength = match[1].length;
            const bulletStart = line.from + indentLength;
            const bulletEnd = bulletStart + match[0].length - indentLength;
            ranges.push(
              Decoration.widget({
                widget: new BulletWidget(match[2]),
                side: -1,
              }).range(bulletStart, bulletStart)
            );
            ranges.push(
              Decoration.mark({ class: "cm-md-hidden" }).range(
                bulletStart,
                bulletEnd
              )
            );
          }

          if (!activeLines.has(line.number)) {
            const wikiRegex = new RegExp(
              INTERNAL_NODE_LINK_REGEX.source,
              "g"
            );
            let wikiMatch;
            while ((wikiMatch = wikiRegex.exec(line.text)) !== null) {
              if (wikiMatch.index == null) continue;
              const rawTarget = wikiMatch[1] || "";
              const [target, display] = rawTarget.split("|");
              const trimmedTarget = target?.trim();
              if (!trimmedTarget) continue;
              const label = (display ?? target)?.trim() || trimmedTarget;
              const start = line.from + wikiMatch.index;
              const end = start + wikiMatch[0].length;
              ranges.push(
                Decoration.replace({
                  widget: new WikiLinkWidget(
                    label,
                    trimmedTarget,
                    getNavigateToNode
                  ),
                }).range(start, end)
              );
            }
          }
          processedLines.add(line.number);
        }
        if (line.to >= to || line.number >= view.state.doc.lines) break;
        line = view.state.doc.line(line.number + 1);
      }
    }

    return Decoration.set(ranges.sort((a: any, b: any) => a.from - b.from));
  };

  return ViewPlugin.fromClass(
    class {
      decorations: any;
      constructor(view: any) {
        this.decorations = computeDecorations(view);
      }
      update(update: any) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = computeDecorations(update.view);
        }
      }
    },
    {
      decorations: (v: any) => v.decorations,
    }
  );
};

const createEditorKeymap = (cm: LoadedCodeMirror) => {
  const { EditorSelection } = cm;
  const insertTab = (view: any) => {
    const tabText = "  ";
    const transaction = view.state.changeByRange((range: any) => ({
      changes: { from: range.from, to: range.to, insert: tabText },
      range: EditorSelection.cursor(range.from + tabText.length),
    }));
    view.dispatch(transaction);
    return true;
  };

  return [
    {
      key: "Enter",
      run: (view: any) => {
        const { state } = view;
        const { main } = state.selection;
        if (!main.empty) return false;
        const line = state.doc.lineAt(main.head);
        const match = line.text.match(/^(\s*)([-*])\s+/);
        if (!match) return false;
        const indentLength = match[1].length;
        const bulletLength = match[0].length - indentLength;
        const bulletStart = line.from + indentLength;
        if (main.head < bulletStart + bulletLength) return false;
        const afterText = line.text.slice(match[0].length);
        if (afterText.trim().length === 0) {
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: "" },
            selection: { anchor: line.from },
          });
          return false;
        }
        const insertText = `\n${match[1]}${match[2]} `;
        view.dispatch({
          changes: { from: main.head, to: main.head, insert: insertText },
          selection: { anchor: main.head + insertText.length },
          scrollIntoView: true,
        });
        return true;
      },
    },
    {
      key: "Tab",
      run: insertTab,
    },
  ];
};

const createTripleBacktickHandler = (cm: LoadedCodeMirror) =>
  cm.EditorView.inputHandler.of((view: any, from: number, to: number, text: string) => {
    if (text !== "`" || from !== to) return false;
    if (from < 2) return false;
    const prevTwo = view.state.doc.sliceString(from - 2, from);
    if (prevTwo !== "``") return false;
    const insertText = "`\n\n```";
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + 2 },
      scrollIntoView: true,
    });
    return true;
  });

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  initialContent,
  onChange,
  className,
  placeholder,
  onNavigateToNode,
  allNodes,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{ view: any; cm: LoadedCodeMirror } | null>(null);
  const onChangeRef = useRef(onChange);
  const onNavigateToNodeRef = useRef(onNavigateToNode);
  const allNodesRef = useRef<GraphNode[] | undefined>(allNodes);
  const activeLinkStartRef = useRef<number | null>(null);
  const [linkDropdown, setLinkDropdown] = useState<LinkDropdownState | null>(
    null
  );
  const [linkResults, setLinkResults] = useState<GraphNode[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onNavigateToNodeRef.current = onNavigateToNode;
  }, [onNavigateToNode]);

  useEffect(() => {
    allNodesRef.current = allNodes;
  }, [allNodes]);

  const closeLinkSearch = useCallback(() => {
    setLinkDropdown(null);
    setLinkResults([]);
    setActiveResultIndex(0);
    activeLinkStartRef.current = null;
  }, []);

  const computeLinkMatches = useCallback((query: string) => {
    const nodes = allNodesRef.current || [];
    if (!nodes.length) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return nodes
        .slice()
        .sort((a, b) =>
          getNodeTitle(a).localeCompare(getNodeTitle(b), undefined, {
            sensitivity: "base",
          })
        )
        .slice(0, 6);
    }

    type ScoredNode = { node: GraphNode; score: number };
    const scored = nodes
      .map<ScoredNode | null>((node) => {
        const title = getNodeTitle(node);
        const titleLower = title.toLowerCase();
        const summaryLower = (node.summary || node.content || "").toLowerCase();
        const aliasHit = node.aliases?.find((alias) =>
          alias.toLowerCase().includes(normalized)
        );

        if (titleLower.startsWith(normalized)) {
          return { node, score: titleLower.indexOf(normalized) };
        }
        if (titleLower.includes(normalized)) {
          return { node, score: 50 + titleLower.indexOf(normalized) };
        }
        if (aliasHit) {
          return { node, score: 200 };
        }
        if (summaryLower.includes(normalized)) {
          return { node, score: 500 };
        }
        return null;
      })
      .filter((entry): entry is ScoredNode => !!entry)
      .sort((a, b) => a.score - b.score)
      .slice(0, 6)
      .map((entry) => entry.node);

    return scored;
  }, []);

  const evaluateLinkSearch = useCallback(
    (view: any) => {
      if (!view) return;
      const selection = view.state.selection?.main;
      if (!selection || !selection.empty) {
        closeLinkSearch();
        return;
      }

      const cursorPos = selection.head;
      const textBefore = view.state.doc.sliceString(0, cursorPos);
      const start = textBefore.lastIndexOf("[[");
      if (start === -1) {
        closeLinkSearch();
        return;
      }
      const closingIndex = textBefore.indexOf("]]", start + 2);
      if (closingIndex !== -1) {
        closeLinkSearch();
        return;
      }

      const rawQuery = view.state.doc.sliceString(start + 2, cursorPos);
      if (rawQuery.includes("|") || rawQuery.includes("\n")) {
        closeLinkSearch();
        return;
      }
      activeLinkStartRef.current = start;
      const query = rawQuery;
      const coords = view.coordsAtPos(cursorPos);
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!coords || !containerRect) {
        closeLinkSearch();
        return;
      }

      const matches = computeLinkMatches(query);
      setLinkResults(matches);
      setActiveResultIndex((prev) =>
            matches.length === 0 ? 0 : Math.min(prev, matches.length - 1)
          );
      const rawLeft = coords.left - containerRect.left;
      const rawTop = coords.bottom - containerRect.top + 4;
      const maxLeft =
        containerRect.width - INLINE_LINK_DROPDOWN_WIDTH - 8;
      const clampedLeft = Math.max(
        0,
        Math.min(rawLeft, Math.max(maxLeft, 0))
      );
      setLinkDropdown({
        position: {
          left: clampedLeft,
          top: rawTop,
        },
        query,
      });
    },
    [closeLinkSearch, computeLinkMatches]
  );

  const insertInternalLink = useCallback(
    (title: string) => {
      const view = viewRef.current?.view;
      const start = activeLinkStartRef.current;
      if (!view || start == null) return;
      const head = view.state.selection.main.head;
      const insertText = `[[${title}]]`;

      view.dispatch({
        changes: { from: start, to: head, insert: insertText },
        selection: { anchor: start + insertText.length },
        scrollIntoView: true,
      });
      view.focus();
      closeLinkSearch();
    },
    [closeLinkSearch]
  );

  const handleResultSelect = useCallback(
    (node: GraphNode) => {
      insertInternalLink(getNodeTitle(node));
    },
    [insertInternalLink]
  );

  const selectActiveResult = useCallback(() => {
    if (!linkResults.length) {
      closeLinkSearch();
      return;
    }
    const index = Math.min(activeResultIndex, linkResults.length - 1);
    const node = linkResults[index];
    if (node) {
      handleResultSelect(node);
    }
  }, [activeResultIndex, linkResults, handleResultSelect, closeLinkSearch]);

  useEffect(() => {
    if (!linkDropdown) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveResultIndex((prev) =>
          Math.min(prev + 1, Math.max(linkResults.length - 1, 0))
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveResultIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        selectActiveResult();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeLinkSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [linkDropdown, linkResults.length, closeLinkSearch, selectActiveResult]);

  useEffect(() => {
    let disposed = false;
    let viewInstance: any = null;
    let cmModules: LoadedCodeMirror | null = null;
    let blurHandler: (() => void) | null = null;

    const init = async () => {
      try {
        cmModules = await loadCodeMirror();
        if (disposed || !containerRef.current) return;

        const livePreview = createLivePreviewPlugin(
          cmModules,
          () => onNavigateToNodeRef.current
        );
        const editorKeymap = createEditorKeymap(cmModules);
        const tripleBacktickHandler = createTripleBacktickHandler(cmModules);
        const updateListener = cmModules.EditorView.updateListener.of(
          (update: any) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (
              update.docChanged ||
              update.selectionSet ||
              update.viewportChanged
            ) {
              evaluateLinkSearch(update.view);
            }
          }
        );
        const extensions = [
          cmModules.history(),
          cmModules.keymap.of([
            ...editorKeymap,
            ...cmModules.defaultKeymap,
            ...cmModules.historyKeymap,
          ]),
          cmModules.markdown({
            base: cmModules.markdownLanguage,
            codeLanguages: cmModules.languages,
          }),
          cmModules.syntaxHighlighting(cmModules.defaultHighlightStyle, {
            fallback: true,
          }),
          cmModules.EditorView.lineWrapping,
          tripleBacktickHandler,
          livePreview,
          updateListener,
          cmModules.EditorView.theme({
            "&": {
              backgroundColor: "transparent",
              color: "inherit",
              height: "100%",
              fontSize: "inherit",
            },
            ".cm-content": {
              fontFamily: "inherit",
              caretColor: "white",
            },
            ".cm-scroller": {
              overflow: "auto",
              lineHeight: "1.6",
            },
            ".cm-md-hidden": {
              opacity: 0,
              width: 0,
            },
            ".cm-md-bold": {
              fontWeight: "bold",
            },
            ".cm-md-italic": {
              fontStyle: "italic",
            },
            ".cm-md-h1": {
              fontSize: "1.4em",
              fontWeight: "bold",
              borderBottom: "1px solid rgba(255,255,255,0.2)",
              display: "inline-block",
              width: "100%",
            },
            ".cm-md-h2": {
              fontSize: "1.2em",
              fontWeight: "bold",
            },
            ".cm-md-h3": {
              fontSize: "1.1em",
              fontWeight: "bold",
            },
            ".cm-md-quote": {
              borderLeft: "2px solid rgba(255,255,255,0.3)",
              paddingLeft: "0.75rem",
              fontStyle: "italic",
              opacity: 0.9,
            },
            ".cm-md-code": {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace",
              backgroundColor: "rgba(255,255,255,0.08)",
              borderRadius: "4px",
              padding: "0 0.25rem",
              fontSize: "0.9em",
            },
            ".cm-md-codeblock": {
              display: "block",
              position: "relative",
              backgroundColor: "rgba(15,23,42,0.75)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace",
              fontSize: "0.9em",
              margin: "0.25rem 0",
              whiteSpace: "pre",
            },
            ".cm-md-codeblock-lang": {
              position: "absolute",
              top: "0.35rem",
              right: "0.5rem",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(148, 163, 184, 0.9)",
            },
            ".cm-md-bullet": {
              display: "inline-block",
              width: "1.25rem",
              color: "rgba(248,250,252,0.9)",
            },
            ".cm-md-internal-link": {
              color: "#7dd3fc",
              textDecoration: "underline",
              cursor: "pointer",
            },
            ".cm-md-block-hidden": {
              display: "none",
            },
            ".hljs": {
              color: "#e2e8f0",
              background: "transparent",
            },
            ".hljs-keyword, .hljs-selector-tag, .hljs-literal": {
              color: "#93c5fd",
            },
            ".hljs-string, .hljs-title, .hljs-section, .hljs-attribute": {
              color: "#bef264",
            },
            ".hljs-number, .hljs-name, .hljs-type": {
              color: "#f472b6",
            },
            ".hljs-comment": {
              color: "#94a3b8",
              fontStyle: "italic",
            },
          }),
        ];

        if (placeholder) {
          extensions.push(cmModules.placeholder(placeholder));
        }

        const state = cmModules.EditorState.create({
          doc: initialContent,
          extensions,
        });

        viewInstance = new cmModules.EditorView({
          state,
          parent: containerRef.current,
        });
        blurHandler = () => closeLinkSearch();
        viewInstance.dom.addEventListener("blur", blurHandler);
        evaluateLinkSearch(viewInstance);
        viewRef.current = { view: viewInstance, cm: cmModules };
      } catch (err) {
        console.error("Failed to load CodeMirror", err);
      }
    };

    init();

    return () => {
      disposed = true;
      if (viewInstance) {
        if (blurHandler) {
          viewInstance.dom.removeEventListener("blur", blurHandler);
        }
        viewInstance.destroy();
      }
      viewRef.current = null;
    };
  }, [placeholder, evaluateLinkSearch, closeLinkSearch]);

  useEffect(() => {
    if (!viewRef.current) return;
    const { view } = viewRef.current;
    const current = view.state.doc.toString();
    if (current !== initialContent) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: initialContent },
      });
    }
  }, [initialContent]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className={`h-full w-full ${className ?? ""}`}
      />
      {linkDropdown && (
        <div
          className="absolute z-50 rounded-xl border border-slate-700 bg-slate-900/95 text-slate-100 shadow-2xl pointer-events-auto backdrop-blur"
          style={{
            left: linkDropdown.position.left,
            top: linkDropdown.position.top,
            width: INLINE_LINK_DROPDOWN_WIDTH,
          }}
        >
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-800">
            Link to existing node
          </div>
          <div className="max-h-64 overflow-y-auto">
            {linkResults.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500">
                {allNodesRef.current?.length
                  ? "No nodes match that title."
                  : "No nodes available yet."}
              </div>
            ) : (
              linkResults.map((result, index) => {
                const title = getNodeTitle(result);
                const description =
                  result.summary || (result.content || "").slice(0, 120);
                const colorClass =
                  (result.color && NODE_COLORS[result.color]?.indicator) ||
                  NODE_COLORS.slate.indicator;
                const isActive = index === activeResultIndex;
                return (
                  <button
                    key={result.id}
                    type="button"
                    className={`w-full px-3 py-2 flex gap-3 text-left items-center transition-colors ${
                      isActive
                        ? "bg-sky-700/30 text-white"
                        : "hover:bg-slate-800/70"
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.preventDefault();
                      handleResultSelect(result);
                    }}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {title}
                      </div>
                      {description && (
                        <div className="text-xs text-slate-400 truncate">
                          {description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="px-3 py-1.5 text-[10px] text-slate-500 border-t border-slate-800">
            Type to filter • Enter to select • Esc to dismiss
          </div>
        </div>
      )}
    </div>
  );
};
