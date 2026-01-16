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
    let alignment = "left";
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
      const alignmentStyle = alignment === "center"
        ? "margin-left:auto; margin-right:auto;"
        : alignment === "right"
          ? "margin-left:auto; margin-right:0;"
          : "margin-left:0; margin-right:auto;";
      result += `<img src="${safeUrl}" alt="${altText}" style="display:block; ${alignmentStyle}" />`;
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
  let inTable = false;
  let tableAlignments = [];

  const splitTableRow = (row) => {
    const trimmedRow = row.trim();
    const withoutEdges = trimmedRow.startsWith("|") ? trimmedRow.slice(1) : trimmedRow;
    const normalized = withoutEdges.endsWith("|") ? withoutEdges.slice(0, -1) : withoutEdges;
    return normalized.split("|").map((cell) => cell.trim());
  };

  const isTableSeparator = (row) => {
    const trimmedRow = row.trim();
    if (!trimmedRow.includes("-")) return false;
    return /^(\|?\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmedRow);
  };

  const parseTableAlignments = (row) =>
    splitTableRow(row).map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return "left";
    });

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

  const closeTable = () => {
    if (inTable) {
      html += "</tbody></table>";
      inTable = false;
      tableAlignments = [];
    }
  };

  const splitColumns = (content) => {
    const parts = content.split("||");
    if (parts.length === 1) return null;
    const columns = parts.slice(0, 3);
    if (parts.length > 3) {
      columns[2] = [columns[2], ...parts.slice(3)].join("||");
    }
    return columns.map((part) => part.trim());
  };

  const renderColumns = (columns) => {
    const columnHtml = columns
      .map((column) => `<div class="md-column">${applyInlineFormatting(column)}</div>`)
      .join("");
    return `<div class="md-columns" style="--md-cols: ${columns.length};">${columnHtml}</div>`;
  };

  const renderListItem = (content) => {
    const columns = splitColumns(content);
    if (!columns) {
      return `<li>${applyInlineFormatting(content)}</li>`;
    }
    return `<li>${renderColumns(columns)}</li>`;
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      closeParagraph();
      closeList();
      closeTable();
      continue;
    }

    const tableHeader = splitTableRow(line);
    const nextLine = lines[index + 1] ?? "";
    if (tableHeader.length > 1 && isTableSeparator(nextLine)) {
      closeParagraph();
      closeList();
      closeTable();
      tableAlignments = parseTableAlignments(nextLine);
      html += "<table><thead><tr>";
      tableHeader.forEach((cell, cellIndex) => {
        const align = tableAlignments[cellIndex] ?? "left";
        html += `<th style="text-align:${align};">${applyInlineFormatting(cell)}</th>`;
      });
      html += "</tr></thead><tbody>";
      inTable = true;
      index += 1;
      continue;
    }

    if (inTable && trimmed.includes("|")) {
      const rowCells = splitTableRow(line);
      if (rowCells.length > 1) {
        html += "<tr>";
        rowCells.forEach((cell, cellIndex) => {
          const align = tableAlignments[cellIndex] ?? "left";
          html += `<td style="text-align:${align};">${applyInlineFormatting(cell)}</td>`;
        });
        html += "</tr>";
        continue;
      }
      closeTable();
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeParagraph();
      closeList();
      closeTable();
      const level = headingMatch[1].length;
      html += `<h${level}>${applyInlineFormatting(headingMatch[2])}</h${level}>`;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      closeParagraph();
      closeList();
      closeTable();
      html += "<hr />";
      continue;
    }

    const quoteMatch = line.match(/^(&gt;|>)\s?(.*)$/);
    if (quoteMatch) {
      closeParagraph();
      closeList();
      closeTable();
      const quoteLines = [quoteMatch[2]];
      while (lines[index + 1] && /^(&gt;|>)\s?/.test(lines[index + 1])) {
        index += 1;
        quoteLines.push(lines[index].replace(/^(&gt;|>)\s?/, ""));
      }
      const quoteContent = quoteLines.map((value) => applyInlineFormatting(value)).join("<br />");
      html += `<blockquote>${quoteContent}</blockquote>`;
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      closeParagraph();
      closeTable();
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
      closeTable();
      if (!inList || listType !== "ol") {
        closeList();
        html += "<ol>";
        inList = true;
        listType = "ol";
      }
      html += renderListItem(orderedMatch[1]);
      continue;
    }

    const columns = splitColumns(line);
    if (columns) {
      closeParagraph();
      closeList();
      closeTable();
      html += renderColumns(columns);
      continue;
    }

    closeList();
    closeTable();
    addParagraphLine(line);
  }

  closeParagraph();
  closeList();
  closeTable();

  html = html.replace(/@@BLOCK(\d+)@@/g, (_, index) => blocks[Number(index)] ?? "");
  return html;
}
