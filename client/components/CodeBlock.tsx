import React from "react";
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";

type SupportedLanguage =
  | "jsx"
  | "tsx"
  | "javascript"
  | "typescript"
  | "json"
  | "bash"
  | "markdown"
  | "python"
  | "sql"
  | "css"
  | "markup";

const registerLanguages = () => {
  const highlighter = SyntaxHighlighter as typeof SyntaxHighlighter & {
    registerLanguage: (name: SupportedLanguage, language: unknown) => void;
  };

  highlighter.registerLanguage("jsx", jsx);
  highlighter.registerLanguage("tsx", tsx);
  highlighter.registerLanguage("javascript", javascript);
  highlighter.registerLanguage("typescript", typescript);
  highlighter.registerLanguage("json", json);
  highlighter.registerLanguage("bash", bash);
  highlighter.registerLanguage("markdown", markdown);
  highlighter.registerLanguage("python", python);
  highlighter.registerLanguage("sql", sql);
  highlighter.registerLanguage("css", css);
  highlighter.registerLanguage("markup", markup);
};

registerLanguages();

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  sh: "bash",
  shell: "bash",
  yml: "markup",
  yaml: "markup",
  html: "markup",
  xml: "markup",
  md: "markdown",
  py: "python",
};

const normalizeLanguage = (language?: string): SupportedLanguage | undefined => {
  if (!language) return undefined;
  const normalized = language.toLowerCase();
  if (normalized in LANGUAGE_ALIASES) return LANGUAGE_ALIASES[normalized];
  if (
    normalized === "javascript" ||
    normalized === "typescript" ||
    normalized === "json" ||
    normalized === "bash" ||
    normalized === "markdown" ||
    normalized === "python" ||
    normalized === "sql" ||
    normalized === "css" ||
    normalized === "markup" ||
    normalized === "jsx" ||
    normalized === "tsx"
  ) {
    return normalized;
  }
  return undefined;
};

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  customStyle?: React.CSSProperties;
  wrapLongLines?: boolean;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  className,
  customStyle,
  wrapLongLines = true,
}) => {
  return (
    <SyntaxHighlighter
      style={vscDarkPlus}
      language={normalizeLanguage(language)}
      PreTag="div"
      className={className}
      customStyle={customStyle}
      wrapLongLines={wrapLongLines}
    >
      {code}
    </SyntaxHighlighter>
  );
};
