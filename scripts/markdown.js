function escapeHtml(value) {
  return (value ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url) {
  const trimmed = (url ?? "").toString().trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return null;
  if (/^(https?:|mailto:|\/|\.\/|\.\.\/|#)/i.test(trimmed)) {
    return trimmed.replace(/\"/g, "%22");
  }
  return null;
}

function applyInlineFormatting(text) {
  const inlineBlocks = [];
  let output = text.replace(/`([^`]+)`/g, (_, code) => {
    const html = `<code>${code}</code>`;
    inlineBlocks.push(html);
    return `@@INLINE${inlineBlocks.length - 1}@@`;
  });

  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) {
      return `${label} (${url})`;
    }
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  output = output.replace(/@@INLINE(\d+)@@/g, (_, index) => inlineBlocks[Number(index)] ?? "");
  return output;
}

export function renderMarkdown(raw) {
  const escaped = escapeHtml(raw ?? "");
  const blocks = [];
  const withBlocks = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
    const html = `<pre><code>${code.replace(/\n$/, "")}</code></pre>`;
    blocks.push(html);
    return `@@BLOCK${blocks.length - 1}@@`;
  });

  const lines = withBlocks.split("\n");
  let html = "";
  let inParagraph = false;
  let inList = false;

  const closeParagraph = () => {
    if (inParagraph) {
      html += "</p>";
      inParagraph = false;
    }
  };

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  const addParagraphLine = (line) => {
    if (!inParagraph) {
      html += "<p>";
      inParagraph = true;
    } else {
      html += "<br />";
    }
    html += applyInlineFormatting(line);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeParagraph();
      closeList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeParagraph();
      closeList();
      const level = headingMatch[1].length;
      html += `<h${level}>${applyInlineFormatting(headingMatch[2])}</h${level}>`;
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      closeParagraph();
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${applyInlineFormatting(listMatch[1])}</li>`;
      continue;
    }

    closeList();
    addParagraphLine(line);
  }

  closeParagraph();
  closeList();

  html = html.replace(/@@BLOCK(\d+)@@/g, (_, index) => blocks[Number(index)] ?? "");
  return html;
}
