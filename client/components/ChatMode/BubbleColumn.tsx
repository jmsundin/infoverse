import React, { useCallback } from 'react';
import { GraphNode, NodeType } from '../../types';
import { deriveTitleFromContent } from '../../utils/titleUtils';

interface BubbleInfo {
  node: GraphNode;
  isExpanded: boolean;
}

interface BubbleColumnProps {
  bubbles: BubbleInfo[];
  onBubbleTap: (nodeId: string, isExpanded: boolean) => void;
}

export const BubbleColumn: React.FC<BubbleColumnProps> = ({
  bubbles,
  onBubbleTap,
}) => {
  if (bubbles.length === 0) return null;

  return (
    <div className="bubble-column absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50">
      {bubbles.map(({ node, isExpanded }) => (
        <Bubble
          key={node.id}
          node={node}
          isExpanded={isExpanded}
          onTap={() => onBubbleTap(node.id, isExpanded)}
        />
      ))}
    </div>
  );
};

interface BubbleProps {
  node: GraphNode;
  isExpanded: boolean;
  onTap: () => void;
}

const Bubble: React.FC<BubbleProps> = ({ node, isExpanded, onTap }) => {
  const title = deriveTitleFromContent(node.content || '') || node.summary || 'Untitled';
  const firstLetter = title.charAt(0).toUpperCase();
  const isChatNode = node.type === NodeType.CHAT;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTap();
    },
    [onTap]
  );

  return (
    <div
      className={`bubble cursor-pointer transition-all duration-200 ease-out ${
        isExpanded ? 'bubble-expanded' : ''
      }`}
      onClick={handleClick}
    >
      <div
        className={`flex items-center gap-2 rounded-full bg-slate-800 shadow-lg transition-all duration-200 hover:bg-slate-700`}
        style={{
          minWidth: '40px',
          height: '40px',
          padding: isExpanded ? '0 14px 0 0' : '0',
        }}
      >
        {/* Circle with letter/icon */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            isChatNode ? 'bg-emerald-500/15' : 'bg-sky-500/15'
          }`}
        >
          {isChatNode ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-400"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          ) : (
            <span className="text-sm font-semibold text-sky-400">
              {firstLetter}
            </span>
          )}
        </div>

        {/* Title (shown when expanded) */}
        {isExpanded && (
          <span
            className="bubble-title text-xs font-medium text-slate-300 whitespace-nowrap overflow-hidden text-ellipsis animate-fadeIn"
            style={{ maxWidth: '120px' }}
          >
            {title}
          </span>
        )}
      </div>
    </div>
  );
};

// CSS for animations (add to your global styles or use styled-components)
const styles = `
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .animate-fadeIn {
    animation: fadeIn 200ms ease-out forwards;
  }

  @keyframes bubblePop {
    0% {
      transform: scale(0);
      opacity: 0;
    }
    70% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .bubble {
    animation: bubblePop 300ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
`;

// Inject styles (only in browser)
if (typeof document !== 'undefined') {
  const styleElement = document.getElementById('bubble-column-styles') || document.createElement('style');
  styleElement.id = 'bubble-column-styles';
  styleElement.textContent = styles;
  if (!styleElement.parentNode) {
    document.head.appendChild(styleElement);
  }
}
