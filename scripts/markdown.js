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

  output = renderInlineImages(output);

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

function renderInlineImages(text) {
  let result = "";
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("![", index);
    if (start === -1) {
      result += text.slice(index);
      break;
    }

    result += text.slice(index, start);
    const altStart = start + 2;
    const altEnd = text.indexOf("](", altStart);
    if (altEnd === -1) {
      result += text.slice(start);
      break;
    }

    const urlStart = altEnd + 2;
    const urlEnd = text.indexOf(")", urlStart);
    if (urlEnd === -1) {
      result += text.slice(start);
      break;
    }

    const altText = text.slice(altStart, altEnd);
    const urlText = text.slice(urlStart, urlEnd);
    const safeUrl = sanitizeUrl(urlText);
    let alignment = null;
    let suffixLength = 0;

    if (text.startsWith("::left", urlEnd + 1)) {
      alignment = "left";
      suffixLength = "::left".length;
    } else if (text.startsWith("::center", urlEnd + 1)) {
      alignment = "center";
      suffixLength = "::center".length;
    } else if (text.startsWith("::right", urlEnd + 1)) {
      alignment = "right";
      suffixLength = "::right".length;
    }

    if (safeUrl) {
      const className = alignment ? ` class="md-img md-img-${alignment}"` : "";
      result += `<img src="${safeUrl}" alt="${altText}"${className} />`;
    } else {
      result += `![${altText}](${urlText})`;
    }

    index = urlEnd + 1 + suffixLength;
  }

  return result;
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
  let listType = null;

  const closeParagraph = () => {
    if (inParagraph) {
      html += "</p>";
      inParagraph = false;
    }
  };

  const closeList = () => {
    if (inList) {
      html += `</${listType ?? "ul"}>`;
      inList = false;
      listType = null;
    }
  };

  const renderListItem = (content) => {
    const splitIndex = content.indexOf("||");
    if (splitIndex === -1) {
      return `<li>${applyInlineFormatting(content)}</li>`;
    }
    const leftText = content.slice(0, splitIndex).trimEnd();
    const rightText = content.slice(splitIndex + 2).trimStart();
    return `<li><div class="md-line-split"><div class="md-line-left">${applyInlineFormatting(leftText)}</div><div class="md-line-right">${applyInlineFormatting(rightText)}</div></div></li>`;
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
      if (!inList || listType !== "ul") {
        closeList();
        html += "<ul>";
        inList = true;
        listType = "ul";
      }
      html += renderListItem(listMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      closeParagraph();
      if (!inList || listType !== "ol") {
        closeList();
        html += "<ol>";
        inList = true;
        listType = "ol";
      }
      html += renderListItem(orderedMatch[1]);
      continue;
    }

    const splitIndex = line.indexOf("||");
    if (splitIndex !== -1) {
      closeParagraph();
      closeList();
      const leftText = line.slice(0, splitIndex).trimEnd();
      const rightText = line.slice(splitIndex + 2).trimStart();
      html += `<div class="md-line-split"><div class="md-line-left">${applyInlineFormatting(leftText)}</div><div class="md-line-right">${applyInlineFormatting(rightText)}</div></div>`;
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
