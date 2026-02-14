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
import { CodeBlock } from '../CodeBlock';
import {
  INTERNAL_NODE_LINK_PREFIX,
  extractInternalNodeTitle,
  formatInternalNodeLinks,
} from '../../utils/wikiLinks';
import { cleanTitleMarkdown, updateTitleInContent, deriveTitleFromContent } from '../../utils/titleUtils';
import { extractPrefixContent } from '../../utils/chatFormatUtils';
import { deriveChatMessagesFromContent } from '../../utils/nodeContentUtils';

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

  const titleText = deriveTitleFromContent(node.content || '') || node.summary || 'Untitled';
  const contentMessages = useMemo(() => {
    if (node.messages && node.messages.length > 0) return node.messages;
    return deriveChatMessagesFromContent(node.content || '') || [];
  }, [node.messages, node.content]);

  // Scroll chat to bottom when messages update
  useEffect(() => {
    if (chatContainerRef.current && node.type === NodeType.CHAT) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [contentMessages, streamingContent, node.type]);

  // Handle text selection for tooltip
  const handleMouseUp = useCallback((_e: React.MouseEvent) => {
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
    const updatedMessages = [...contentMessages, userMsg];
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

  const displayMessages = useMemo(() => contentMessages, [contentMessages]);

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
          <CodeBlock
            code={String(children).replace(/\n$/, '')}
            language={match[1]}
            customStyle={{
              margin: '0.75rem 0',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}
            {...props}
          />
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

  // Parent peek view - minimal side tab
  if (isParentPeek) {
    return (
      <div
        ref={panelRef}
        className="chat-mode-panel parent-peek h-full flex-shrink-0 cursor-pointer transition-all duration-300 hover:bg-slate-800/50 group"
        style={{ width: '44px' }}
        onClick={onFocus}
      >
        <div className="h-full flex flex-col items-center pt-4 gap-3">
          {/* Type indicator */}
          <div
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-transform group-hover:scale-125 ${
              node.type === NodeType.CHAT ? 'bg-emerald-400' : 'bg-sky-400'
            }`}
          />
          {/* Vertical title */}
          <span
            className="text-slate-400 group-hover:text-slate-200 font-medium text-xs whitespace-nowrap transform -rotate-90 origin-center transition-colors"
            style={{ maxWidth: '70vh', marginTop: '40px' }}
          >
            {titleText.substring(0, 24)}{titleText.length > 24 ? '...' : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex mx-auto">
    <div
      ref={panelRef}
      className={`chat-mode-panel h-full flex-shrink-0 flex flex-col transition-all duration-300 bg-slate-950`}
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100vw' : '720px',
      }}
      onClick={() => !isFocused && onFocus()}
      onMouseUp={handleMouseUp}
    >
      {/* Title header */}
      <div className="flex-shrink-0 px-6 pt-20 pb-4">
        <h1 className="text-2xl font-semibold text-slate-100 leading-tight">
          {titleText}
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col bg-slate-950">
        {node.type === NodeType.NOTE ? (
          <div className="w-full h-full">
            <MarkdownEditor
              initialContent={node.content || ''}
              onChange={handleNoteEditorChange}
              onNavigateToNode={onNavigateToNode}
              allNodes={allNodes}
              className="w-full h-full text-slate-200 text-base px-6 py-4 leading-relaxed"
              placeholder="Write a note (Markdown supported)..."
            />
          </div>
        ) : (
          <>
            {/* Chat messages */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto px-6 py-4"
            >
              {displayMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div className="text-slate-500 text-sm">Start a conversation</div>
                </div>
              )}
              <div className="space-y-4">
                {displayMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-800 text-slate-200'
                      }`}
                    >
                      <ReactMarkdown components={markdownComponents}>
                        {formatInternalNodeLinks(msg.text)}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}

                {streamingContent && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed bg-slate-800 text-slate-200">
                      <ReactMarkdown components={markdownComponents}>
                        {formatInternalNodeLinks(streamingContent + ' ▍')}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {isChatting && !streamingContent && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800 text-slate-400 rounded-2xl px-4 py-3 text-[15px]">
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Chat input */}
            <div className="px-4 py-3 border-t border-slate-800/50">
              <div className="flex items-center gap-2 bg-slate-800 rounded-xl px-3 py-1">
                <input
                  type="text"
                  className="flex-1 bg-transparent text-slate-200 text-[15px] py-2.5 focus:outline-none placeholder-slate-500"
                  placeholder="Message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isChatting || !input.trim()}
                  className="p-2 rounded-lg text-sky-400 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </div>
  );
};
