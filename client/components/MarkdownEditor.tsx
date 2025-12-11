import React, { useEffect, useRef } from 'react';
import { EditorView, keymap, ViewUpdate, ViewPlugin, Decoration, DecorationSet } from '@codemirror/view';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

interface MarkdownEditorProps {
  initialContent: string;
  onChange: (content: string) => void;
  className?: string;
  placeholder?: string;
}

// State effect to toggle "idle" mode (preview mode)
const setIdle = StateEffect.define<boolean>();

// State field to track idle status
const idleState = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setIdle)) return effect.value;
    }
    // If user types, we are not idle
    if (tr.docChanged) return false;
    return value;
  }
});

// ViewPlugin to apply decorations based on idle state
const markdownDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.computeDecorations(view);
  }

  update(update: ViewUpdate) {
    // Recompute if doc changed, viewport changed, or idle state changed
    const idleChanged = update.startState.field(idleState) !== update.state.field(idleState);
    if (update.docChanged || update.viewportChanged || idleChanged) {
      this.decorations = this.computeDecorations(update.view);
    }
  }

  computeDecorations(view: EditorView): DecorationSet {
    const isIdle = view.state.field(idleState);
    if (!isIdle) return Decoration.none;

    const widgets: any[] = [];
    
    // Use syntax tree to find markdown nodes
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter: (node) => {
          if (node.name === 'StrongEmphasis') {
             // **bold** or __bold__
             const text = view.state.sliceDoc(node.from, node.to);
             if (text.startsWith('**') && text.endsWith('**') && text.length >= 4) {
                widgets.push(Decoration.mark({ class: 'cm-md-syntax-hidden' }).range(node.from, node.from + 2));
                widgets.push(Decoration.mark({ class: 'cm-md-bold' }).range(node.from + 2, node.to - 2));
                widgets.push(Decoration.mark({ class: 'cm-md-syntax-hidden' }).range(node.to - 2, node.to));
             } else if (text.startsWith('__') && text.endsWith('__') && text.length >= 4) {
                widgets.push(Decoration.mark({ class: 'cm-md-syntax-hidden' }).range(node.from, node.from + 2));
                widgets.push(Decoration.mark({ class: 'cm-md-bold' }).range(node.from + 2, node.to - 2));
                widgets.push(Decoration.mark({ class: 'cm-md-syntax-hidden' }).range(node.to - 2, node.to));
             }
          } else if (node.name === 'Emphasis') {
             // *italic* or _italic_
             const text = view.state.sliceDoc(node.from, node.to);
             if ((text.startsWith('*') && text.endsWith('*')) || (text.startsWith('_') && text.endsWith('_'))) {
               if (text.length >= 2) {
                widgets.push(Decoration.mark({ class: 'cm-md-syntax-hidden' }).range(node.from, node.from + 1));
                widgets.push(Decoration.mark({ class: 'cm-md-italic' }).range(node.from + 1, node.to - 1));
                widgets.push(Decoration.mark({ class: 'cm-md-syntax-hidden' }).range(node.to - 1, node.to));
               }
             }
          } else if (node.name === 'ATXHeading1' || node.name === 'ATXHeading2' || node.name === 'ATXHeading3') {
             const text = view.state.sliceDoc(node.from, node.to);
             const match = text.match(/^(#{1,6})\s+/);
             if (match) {
                 const level = match[1].length;
                 const className = level === 1 ? 'cm-md-h1' : level === 2 ? 'cm-md-h2' : 'cm-md-h3';
                 widgets.push(Decoration.mark({ class: 'cm-md-syntax-hidden' }).range(node.from, node.from + match[0].length));
                 widgets.push(Decoration.mark({ class: className }).range(node.from + match[0].length, node.to));
             }
          }
        }
      });
    }

    return Decoration.set(widgets.sort((a, b) => a.from - b.from));
  }
}, {
  decorations: v => v.decorations
});


export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ 
  initialContent, 
  onChange,
  className,
  placeholder 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const idleTimerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        idleState,
        markdownDecorations,
        EditorView.updateListener.of((update) => {
           if (update.docChanged) {
             const content = update.state.doc.toString();
             onChange(content);
             
             if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
             
             idleTimerRef.current = setTimeout(() => {
               if (viewRef.current) {
                 viewRef.current.dispatch({ effects: setIdle.of(true) });
               }
             }, 2000); 
           }
        }),
        EditorView.theme({
          "&": {
            backgroundColor: "transparent",
            height: "100%",
            color: "inherit",
            fontSize: "inherit"
          },
          ".cm-content": {
            fontFamily: "inherit",
            caretColor: "white",
            padding: "0"
          },
          ".cm-scroller": {
            overflow: "auto",
            lineHeight: "1.6"
          },
          ".cm-line": {
            padding: "0"
          },
          // Custom Styles
          ".cm-md-syntax-hidden": {
             display: "none"
          },
          ".cm-md-bold": {
             fontWeight: "bold"
          },
          ".cm-md-italic": {
             fontStyle: "italic"
          },
          ".cm-md-h1": {
             fontSize: "1.5em",
             fontWeight: "bold",
             borderBottom: "1px solid rgba(255,255,255,0.2)",
             display: "inline-block",
             width: "100%"
          },
          ".cm-md-h2": {
             fontSize: "1.3em",
             fontWeight: "bold"
          },
          ".cm-md-h3": {
             fontSize: "1.1em",
             fontWeight: "bold"
          }
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: containerRef.current
    });

    viewRef.current = view;
    
    idleTimerRef.current = setTimeout(() => {
        if (viewRef.current) {
          viewRef.current.dispatch({ effects: setIdle.of(true) });
        }
    }, 2000);


    return () => {
      view.destroy();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []); 

  // Handle external updates
  useEffect(() => {
    if (viewRef.current) {
      const currentDoc = viewRef.current.state.doc.toString();
      if (initialContent !== currentDoc) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: initialContent }
        });
      }
    }
  }, [initialContent]);

  return (
    <div ref={containerRef} className={`h-full w-full ${className}`} />
  );
};
