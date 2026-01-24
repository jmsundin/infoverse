import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import ReactMarkdown from 'react-markdown';
import { MarkdownEditor } from '../MarkdownEditor';
import { GraphNode, NodeType, ChatMessage, SelectionTooltipState } from '../../types';
import * as geminiService from '../../services/geminiService';
import * as hfService from '../../services/huggingfaceService';
import { NODE_COLORS } from '../../constants';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  INTERNAL_NODE_LINK_PREFIX,
  extractInternalNodeTitle,
  formatInternalNodeLinks,
} from '../../utils/wikiLinks';
import { cleanTitleMarkdown, updateTitleInContent, deriveTitleFromContent } from '../../utils/titleUtils';
import { extractPrefixContent } from '../../utils/chatFormatUtils';

interface ChatModePanelProps {
  node: GraphNode;
  allNodes: GraphNode[];
  isFocused: boolean;
  isParentPeek: boolean;
  onFocus: () => void;
  onUpdate: (id: string, updates: Partial<GraphNode>) => void;
  onSelectionTooltip: (state: SelectionTooltipState | null) => void;
  onNavigateToNode?: (title: string) => void;
  onOpenLink?: (url: string) => void;
  aiProvider?: 'gemini' | 'huggingface';
  autoGraphEnabled?: boolean;
  onExpand?: (id: string, text: string) => void;
}

export const ChatModePanel: React.FC<ChatModePanelProps> = ({
  node,
  allNodes,
  isFocused,
  isParentPeek,
  onFocus,
  onUpdate,
  onSelectionTooltip,
  onNavigateToNode,
  onOpenLink,
  aiProvider = 'gemini',
  autoGraphEnabled = false,
  onExpand,
}) => {
  const [input, setInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const colorTheme = NODE_COLORS[node.color || 'slate'];
  const titleText = deriveTitleFromContent(node.content || '') || node.summary || 'Untitled';

  // Scroll chat to bottom when messages update
  useEffect(() => {
    if (chatContainerRef.current && node.type === NodeType.CHAT) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [node.messages, streamingContent, node.type]);

  // Handle text selection for tooltip
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isParentPeek) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    onSelectionTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top,
      bottom: rect.bottom,
      text,
      sourceId: node.id,
    });
  }, [isParentPeek, node.id, onSelectionTooltip]);

  // Send chat message
  const handleSendMessage = async () => {
    if (!input.trim() || node.type !== NodeType.CHAT) return;

    const userMsg: ChatMessage = {
      role: 'user',
      text: input,
      timestamp: Date.now(),
    };
    const updatedMessages = [...(node.messages || []), userMsg];
    const currentInput = input;

    onUpdate(node.id, { messages: updatedMessages });
    setInput('');
    setIsChatting(true);
    setStreamingContent('');

    const service = aiProvider === 'huggingface' ? hfService : geminiService;

    const topic = deriveTitleFromContent(node.content || '');
    const prefixContent = extractPrefixContent(node.content || '');

    const context = (topic && topic !== 'Untitled') || prefixContent
      ? {
          ...(topic && topic !== 'Untitled' ? { topic } : {}),
          ...(prefixContent ? { prefixContent } : {}),
        }
      : undefined;

    const result = await service.sendChatMessage(
      updatedMessages,
      userMsg.text,
      (chunk) => {
        setStreamingContent((prev) => (prev || '') + chunk);
      },
      context
    );

    const modelTextToDisplay = result.text;
    const isLongAnswer =
      result.text.length > 400 || result.text.split('\n\n').length > 1;

    if (autoGraphEnabled && node.type === NodeType.CHAT && isLongAnswer && onExpand) {
      onExpand(node.id, result.text);
    }

    const modelMsg: ChatMessage = {
      role: 'model',
      text: modelTextToDisplay,
      timestamp: Date.now(),
    };

    onUpdate(node.id, {
      messages: [...updatedMessages, modelMsg],
    });
    setIsChatting(false);
    setStreamingContent(null);

    // Generate title for chat nodes on first conversation exchange
    const existingTitle = deriveTitleFromContent(node.content || '');
    if (node.type === NodeType.CHAT && existingTitle === 'Untitled') {
      const titleService = aiProvider === 'huggingface' ? hfService : geminiService;
      const rawTitle = await titleService.generateTitle(currentInput, result.text);
      const cleanedTitle = cleanTitleMarkdown(rawTitle);
      const newContent = updateTitleInContent(node.content || '', cleanedTitle);
      onUpdate(node.id, { content: newContent });
    }
  };

  const handleNoteEditorChange = useCallback(
    (content: string) => {
      onUpdate(node.id, { content });
    },
    [node.id, onUpdate]
  );

  const handleLinkClick = useCallback(
    (e: React.MouseEvent, url: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (url?.startsWith(INTERNAL_NODE_LINK_PREFIX)) {
        const targetTitle = extractInternalNodeTitle(url);
        if (targetTitle && onNavigateToNode) {
          onNavigateToNode(targetTitle);
        }
        return;
      }
      if (onOpenLink) {
        onOpenLink(url);
      } else {
        window.open(url, '_blank');
      }
    },
    [onNavigateToNode, onOpenLink]
  );

  const displayMessages = useMemo(() => node.messages || [], [node.messages]);

  const formattedNoteContent = useMemo(
    () => formatInternalNodeLinks(node.content || ''),
    [node.content]
  );

  const markdownComponents = useMemo(
    () => ({
      ul: ({ node: _, ...props }: any) => (
        <ul className="list-disc pl-4 my-1 space-y-1" {...props} />
      ),
      ol: ({ node: _, ...props }: any) => (
        <ol className="list-decimal pl-4 my-1 space-y-1" {...props} />
      ),
      h1: ({ node: _, ...props }: any) => (
        <h1 className="text-2xl font-bold my-3" {...props} />
      ),
      h2: ({ node: _, ...props }: any) => (
        <h2 className="text-xl font-bold my-2" {...props} />
      ),
      h3: ({ node: _, ...props }: any) => (
        <h3 className="text-lg font-bold my-2" {...props} />
      ),
      a: ({ node: _, href, ...props }: any) => (
        <a
          href={href}
          onClick={(e) => {
            e.stopPropagation();
            handleLinkClick(e, href || '');
          }}
          className="text-sky-300 hover:underline cursor-pointer"
          {...props}
        />
      ),
      p: ({ node: _, ...props }: any) => (
        <p className="mb-3 last:mb-0 leading-relaxed whitespace-pre-wrap" {...props} />
      ),
      blockquote: ({ node: _, ...props }: any) => (
        <blockquote
          className="border-l-4 border-slate-500 pl-4 my-3 italic text-slate-300"
          {...props}
        />
      ),
      code: ({ inline, className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        return !inline && match ? (
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={match[1]}
            PreTag="div"
            customStyle={{
              margin: '0.75rem 0',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        ) : (
          <code
            className="bg-slate-700/50 px-1.5 py-0.5 rounded text-sm font-mono"
            {...props}
          >
            {children}
          </code>
        );
      },
    }),
    [handleLinkClick]
  );

  // Parent peek view - just show title vertically
  if (isParentPeek) {
    return (
      <div
        ref={panelRef}
        className={`chat-mode-panel parent-peek h-full flex-shrink-0 cursor-pointer transition-all duration-300 ${colorTheme.header} border-r border-slate-700`}
        style={{ width: '50px' }}
        onClick={onFocus}
      >
        <div className="h-full flex items-center justify-center">
          <span
            className={`${colorTheme.text} font-semibold text-sm whitespace-nowrap transform -rotate-90 origin-center`}
            style={{ maxWidth: '80vh' }}
          >
            {titleText.substring(0, 30)}{titleText.length > 30 ? '...' : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`chat-mode-panel h-full flex-shrink-0 flex flex-col transition-all duration-300 ${
        isFocused ? 'ring-2 ring-sky-500/50' : ''
      }`}
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100vw' : '66.67vw',
      }}
      onClick={() => !isFocused && onFocus()}
      onMouseUp={handleMouseUp}
    >
      {/* Header */}
      <div
        className={`flex-shrink-0 px-6 py-4 ${colorTheme.header} border-b ${colorTheme.border} flex items-center justify-between`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-3 h-3 rounded-full flex-shrink-0 ${
              node.type === NodeType.CHAT ? 'bg-emerald-400' : 'bg-sky-400'
            }`}
          />
          <h2 className={`text-xl font-semibold ${colorTheme.text} truncate`}>
            {titleText}
          </h2>
        </div>
        <div className={`text-xs ${colorTheme.text} opacity-60`}>
          {node.type === NodeType.CHAT ? 'Chat' : 'Note'}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 min-h-0 flex flex-col ${colorTheme.bg}`}>
        {node.type === NodeType.NOTE ? (
          <div className="w-full h-full">
            <MarkdownEditor
              initialContent={node.content || ''}
              onChange={handleNoteEditorChange}
              onNavigateToNode={onNavigateToNode}
              allNodes={allNodes}
              className={`w-full h-full ${colorTheme.text} text-base p-6 leading-relaxed`}
              placeholder="Write a note (Markdown supported)..."
            />
          </div>
        ) : (
          <>
            {/* Chat messages */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto space-y-4 p-6"
            >
              {displayMessages.length === 0 && (
                <div className="text-slate-500 text-center italic mt-8 text-base">
                  Start a conversation...
                </div>
              )}
              {displayMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="max-w-[80%] flex items-start gap-2">
                    <div
                      className={`rounded-lg leading-relaxed shadow-sm px-5 py-4 text-base ${
                        msg.role === 'user'
                          ? 'bg-sky-600 text-white rounded-tr-none'
                          : `${colorTheme.header} ${colorTheme.text} rounded-tl-none border ${colorTheme.border}`
                      }`}
                    >
                      <ReactMarkdown components={markdownComponents}>
                        {formatInternalNodeLinks(msg.text)}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}

              {streamingContent && (
                <div className="flex flex-col items-start">
                  <div className="max-w-[80%] flex items-start gap-2">
                    <div
                      className={`rounded-lg leading-relaxed shadow-sm px-5 py-4 text-base ${colorTheme.header} ${colorTheme.text} rounded-tl-none border ${colorTheme.border}`}
                    >
                      <ReactMarkdown components={markdownComponents}>
                        {formatInternalNodeLinks(streamingContent + ' ▍')}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              {isChatting && !streamingContent && (
                <div className="flex items-start">
                  <div
                    className={`${colorTheme.header} ${colorTheme.text} border ${colorTheme.border} rounded-lg rounded-tl-none px-5 py-4 animate-pulse text-base`}
                  >
                    Thinking...
                  </div>
                </div>
              )}
            </div>

            {/* Chat input */}
            <div className={`p-4 bg-black/10 border-t ${colorTheme.border} flex gap-3`}>
              <input
                type="text"
                className={`flex-1 bg-black/20 border ${colorTheme.border} rounded-lg ${colorTheme.text} text-base px-4 py-3 focus:outline-none focus:border-sky-400 placeholder-slate-500`}
                placeholder="Type a message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <button
                onClick={handleSendMessage}
                disabled={isChatting}
                className="bg-sky-600 hover:bg-sky-500 text-white rounded-lg px-6 py-3 text-base font-medium disabled:opacity-50 transition-colors"
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
