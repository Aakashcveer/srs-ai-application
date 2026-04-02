// src/Components/ChatWindow/MarkdownRenderer.jsx

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
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

const MarkdownRenderer = ({ text, onRequestRowClick }) => {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          table({ children }) {
            return (
              <div className="table-scroll-wrap">
                <table>{children}</table>
              </div>
            );
          },

          tr({ children, ...props }) {
            const cells = React.Children.toArray(children);

            // header rows use th, body rows use td
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