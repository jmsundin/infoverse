import React, { useEffect, useRef } from "react";

interface MarkdownEditorProps {
  initialContent: string;
  onChange: (content: string) => void;
  className?: string;
  placeholder?: string;
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

const createLivePreviewPlugin = (cm: LoadedCodeMirror) => {
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

  const computeDecorations = (view: any) => {
    const ranges: any[] = [];
    const activeLines = getActiveLineNumbers(view.state);
    const processedLines = new Set<number>();
    const suppressedRanges: Array<{ from: number; to: number }> = [];

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
          const isSuppressed = suppressedRanges.some(
            (range) => line.from >= range.from && line.from < range.to
          );
          if (isSuppressed) {
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{ view: any; cm: LoadedCodeMirror } | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;
    let viewInstance: any = null;
    let cmModules: LoadedCodeMirror | null = null;

    const init = async () => {
      try {
        cmModules = await loadCodeMirror();
        if (disposed || !containerRef.current) return;

        const livePreview = createLivePreviewPlugin(cmModules);
        const editorKeymap = createEditorKeymap(cmModules);
        const tripleBacktickHandler = createTripleBacktickHandler(cmModules);
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
          cmModules.EditorView.updateListener.of((update: any) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
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
        viewRef.current = { view: viewInstance, cm: cmModules };
      } catch (err) {
        console.error("Failed to load CodeMirror", err);
      }
    };

    init();

    return () => {
      disposed = true;
      if (viewInstance) {
        viewInstance.destroy();
      }
      viewRef.current = null;
    };
  }, [placeholder]);

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
    <div
      ref={containerRef}
      className={`h-full w-full ${className ?? ""}`}
    />
  );
};
