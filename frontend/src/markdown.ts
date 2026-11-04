import { marked } from "marked";
import Prism from "prismjs";

// Developer language syntaxes
import "prismjs/components/prism-rust";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markdown";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const renderer = new marked.Renderer();

// Custom code block renderer with language badge and Copy button
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = (lang || "text").toLowerCase();
  const grammar = Prism.languages[language] || Prism.languages.text;
  const highlighted = grammar ? Prism.highlight(text, grammar, language) : escapeHtml(text);

  return `
    <div class="code-block-container">
      <div class="code-block-header">
        <span class="code-block-lang">${language.toUpperCase()}</span>
        <button class="code-copy-btn" title="Скопировать фрагмент кода">📋 Скопировать</button>
      </div>
      <pre class="code-block-pre"><code class="language-${language}">${highlighted}</code></pre>
    </div>
  `;
};

// Open external links in safe manner
renderer.link = function ({ href, title, text }: { href: string; title?: string | null; text: string }) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

/**
 * Parses markdown into safe, highlighted HTML.
 */
export function renderMarkdown(md: string): string {
  if (!md) return "";
  try {
    return marked.parse(md) as string;
  } catch (err) {
    console.error("[Markdown] Parsing error:", err);
    return escapeHtml(md);
  }
}

