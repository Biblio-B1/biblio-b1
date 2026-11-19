"use client";

import "katex/dist/katex.min.css";
import { isValidElement, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { highlight } from "@/lib/highlight";

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    highlight(code, lang)
      .then((h) => alive && setHtml(h))
      .catch(() => alive && setHtml(null));
    return () => {
      alive = false;
    };
  }, [code, lang]);
  if (html) return <div dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

/** Markdown (GFM + maths KaTeX + blocs de code Shiki). Le HTML brut n'est pas interprété. */
export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="prose-bb">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Bloc de code : <pre><code class="language-x">…</code></pre>
          pre: ({ children }) => {
            if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return <pre>{children}</pre>;
            const lang = /language-([\w+-]+)/.exec(children.props.className ?? "")?.[1];
            return <CodeBlock code={String(children.props.children ?? "").replace(/\n$/, "")} lang={lang} />;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
