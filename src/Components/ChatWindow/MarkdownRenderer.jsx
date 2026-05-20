// src/Components/ChatWindow/MarkdownRenderer.jsx

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Mail,
  Bot,
  Workflow,
  CircleCheckBig,
  BarChart3,
  FileText,
} from "lucide-react";
import "highlight.js/styles/github-dark.css";

const getStatusClass = (value = "") => {
  const v = String(value).trim().toLowerCase();

  if (v.includes("pending")) return "status-pending";
  if (v.includes("complete") || v.includes("completed")) return "status-complete";
  if (v.includes("reject") || v.includes("rejected")) return "status-reject";

  return "";
};

const extractPlainText = (children) => {
  if (typeof children === "string") return children.trim();
  if (typeof children === "number") return String(children).trim();

  if (Array.isArray(children)) {
    return children
      .map((child) => {
        if (typeof child === "string" || typeof child === "number") {
          return String(child);
        }

        if (React.isValidElement(child)) {
          return extractPlainText(child.props?.children);
        }

        return "";
      })
      .join("")
      .trim();
  }

  if (React.isValidElement(children)) {
    return extractPlainText(children.props?.children);
  }

  return "";
};

const getHeadingIcon = (headingText = "") => {
  const text = headingText.toLowerCase();

  if (text.includes("request status")) return <BarChart3 size={20} />;
  if (text.includes("customer communication")) return <Mail size={18} />;
  if (text.includes("workflow progress")) return <Workflow size={18} />;
  if (text.includes("task summary")) return <FileText size={18} />;
  if (text.includes("ai generated") || text.includes("ai summary")) return <Bot size={18} />;
  if (text.includes("next recommended") || text.includes("next action")) {
    return <CircleCheckBig size={18} />;
  }

  return null;
};

const renderHeading = (Tag, children, className = "") => {
  const headingText = extractPlainText(children);
  const icon = getHeadingIcon(headingText);

  return (
    <Tag className={`markdown-heading-with-icon ${className}`}>
      {icon && <span className="markdown-heading-icon">{icon}</span>}
      <span>{children}</span>
    </Tag>
  );
};

const MarkdownRenderer = ({ text, onRequestRowClick }) => {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1({ children }) {
            return renderHeading("h1", children, "markdown-h1");
          },

          h2({ children }) {
            return renderHeading("h2", children, "markdown-h2");
          },

          h3({ children }) {
            return renderHeading("h3", children, "markdown-h3");
          },

          table({ children }) {
            return (
              <div className="table-scroll-wrap">
                <table>{children}</table>
              </div>
            );
          },

          tr({ children, ...props }) {
            const cells = React.Children.toArray(children);

            const firstChild = cells[0];
            const firstType =
              React.isValidElement(firstChild) && typeof firstChild.type === "string"
                ? firstChild.type
                : "";

            const isHeaderRow = firstType === "th";

            if (isHeaderRow) {
              return <tr {...props}>{children}</tr>;
            }

            const firstCell = cells[0];
            const requestKey = React.isValidElement(firstCell)
              ? extractPlainText(firstCell.props?.children)
              : "";

            const handleClick = () => {
              if (requestKey && onRequestRowClick) {
                onRequestRowClick(requestKey);
              }
            };

            return (
              <tr
                {...props}
                className={`clickable-status-row ${requestKey ? "is-clickable" : ""}`}
                onClick={handleClick}
                title={requestKey ? `Open request chat: ${requestKey}` : ""}
                role={requestKey ? "button" : undefined}
                tabIndex={requestKey ? 0 : undefined}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && requestKey) {
                    e.preventDefault();
                    handleClick();
                  }
                }}
              >
                {children}
              </tr>
            );
          },

          td({ children, ...props }) {
            const rawText = extractPlainText(children);
            const statusClass = getStatusClass(rawText);

            if (statusClass) {
              return (
                <td {...props}>
                  <span className={statusClass}>{rawText}</span>
                </td>
              );
            }

            return <td {...props}>{children}</td>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;