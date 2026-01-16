/**
 * SourcePillInput - A specialized pill input for sources with inline editing
 * Features:
 * - Click pill to expand into inline editor (not remove)
 * - Type dropdown: Web, Book, Essay, Video, Audio, Person, Unknown
 * - Type-specific input fields
 * - Emoji icons for each source type
 * - Only one pill can be edited at a time
 */

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(text, maxLength = 20) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength);
}

// Source type definitions with emojis and fields
const SOURCE_TYPES = {
  unknown: {
    label: "Unknown",
    emoji: "❓",
    fields: []
  },
  web: {
    label: "Web",
    emoji: "🌐",
    fields: [
      { name: "url", label: "URL", type: "url", placeholder: "https://example.com" },
      { name: "siteName", label: "Site Name", type: "text", placeholder: "Wikipedia" },
      { name: "accessDate", label: "Access Date", type: "date", placeholder: "" }
    ]
  },
  book: {
    label: "Book",
    emoji: "📚",
    fields: [
      { name: "author", label: "Author", type: "text", placeholder: "Author name" },
      { name: "publisher", label: "Publisher", type: "text", placeholder: "Publisher name" },
      { name: "year", label: "Year", type: "text", placeholder: "2024" },
      { name: "pages", label: "Pages", type: "text", placeholder: "42-58" },
      { name: "isbn", label: "ISBN", type: "text", placeholder: "978-3-16-148410-0" }
    ]
  },
  essay: {
    label: "Essay",
    emoji: "✍️",
    fields: [
      { name: "author", label: "Author", type: "text", placeholder: "Author name" },
      { name: "publication", label: "Publication", type: "text", placeholder: "Journal/Magazine name" },
      { name: "date", label: "Date", type: "date", placeholder: "" }
    ]
  },
  video: {
    label: "Video",
    emoji: "🎥",
    fields: [
      { name: "url", label: "URL", type: "url", placeholder: "https://youtube.com/..." },
      { name: "creator", label: "Creator", type: "text", placeholder: "Channel name" },
      { name: "timestamp", label: "Timestamp", type: "text", placeholder: "1:23:45" }
    ]
  },
  audio: {
    label: "Audio",
    emoji: "🎵",
    fields: [
      { name: "url", label: "URL", type: "url", placeholder: "https://..." },
      { name: "creator", label: "Creator", type: "text", placeholder: "Podcast/Artist name" },
      { name: "episode", label: "Episode", type: "text", placeholder: "Episode title" },
      { name: "timestamp", label: "Timestamp", type: "text", placeholder: "1:23:45" }
    ]
  },
  person: {
    label: "Person",
    emoji: "👤",
    fields: [
      { name: "role", label: "Role/Title", type: "text", placeholder: "Expert, Witness, etc." },
      { name: "organization", label: "Organization", type: "text", placeholder: "Company/Institution" },
      { name: "contactDate", label: "Contact Date", type: "date", placeholder: "" }
    ]
  }
};

export function getSourceEmoji(sourceType) {
  return SOURCE_TYPES[sourceType]?.emoji || SOURCE_TYPES.unknown.emoji;
}

export function getSourceDisplayText(source) {
  if (typeof source === "string") return source;
  return source?.text || "";
}

export function getSourceType(source) {
  if (typeof source === "string") return "unknown";
  return source?.type || "unknown";
}

export class SourcePillInput {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      maxLength: options.maxLength || 20,
      placeholder: options.placeholder || "Type a source and press Enter...",
      emptyMessage: options.emptyMessage || "No sources added yet.",
      ...options
    };
    
    // Items are now source objects: { text, type, ...typeSpecificFields }
    this.items = [];
    this.input = null;
    this.pillGrid = null;
    this.editingIndex = null; // Track which pill is currently being edited
    this.justOpened = false; // Flag to prevent immediate close
    
    this.init();
  }
  
  init() {
    this.container.innerHTML = `
      <div class="source-pill-input-container">
        <input 
          type="text" 
          class="input source-pill-input__field" 
          placeholder="${escapeHtml(this.options.placeholder)}"
        />
        <div class="source-pill-grid source-pill-grid--empty">
          ${escapeHtml(this.options.emptyMessage)}
        </div>
      </div>
    `;
    
    this.input = this.container.querySelector(".source-pill-input__field");
    this.pillGrid = this.container.querySelector(".source-pill-grid");
    
    // Event listeners
    this.input.addEventListener("keydown", (e) => this.handleKeyDown(e));
    this.pillGrid.addEventListener("click", (e) => this.handlePillClick(e));
    
    // Close editor when clicking outside
    document.addEventListener("click", (e) => this.handleDocumentClick(e));
  }
  
  handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      this.addItem();
    }
  }
  
  addItem() {
    const value = this.input.value.trim();
    if (!value) return;
    
    // Avoid duplicates (check by text)
    if (this.items.some(item => this.getItemText(item) === value)) {
      this.input.value = "";
      return;
    }
    
    // Create new source with default type
    const newSource = {
      text: value,
      type: "unknown"
    };
    
    this.items.push(newSource);
    this.input.value = "";
    this.render();
    this.notifyChange();
  }
  
  getItemText(item) {
    if (typeof item === "string") return item;
    return item?.text || "";
  }
  
  handlePillClick(e) {
    const pill = e.target.closest(".source-pill-item");
    if (!pill) return;
    
    // Handle remove button click
    if (e.target.closest(".source-pill-item__remove")) {
      const index = parseInt(pill.dataset.index, 10);
      if (isNaN(index) || index < 0 || index >= this.items.length) return;
      
      const item = this.items[index];
      this.items.splice(index, 1);
      this.input.value = this.getItemText(item);
      this.editingIndex = null;
      this.render();
      this.notifyChange();
      this.input.focus();
      return;
    }
    
    // Handle save button in editor
    if (e.target.closest(".source-editor__save")) {
      this.saveEditor();
      return;
    }
    
    // Handle cancel button in editor
    if (e.target.closest(".source-editor__cancel")) {
      this.closeEditor();
      return;
    }
    
    // Don't toggle editor if clicking inside editor area
    if (e.target.closest(".source-editor")) {
      return;
    }
    
    // Toggle editor on pill click
    const index = parseInt(pill.dataset.index, 10);
    if (isNaN(index) || index < 0 || index >= this.items.length) return;
    
    // If already editing this pill, close editor
    if (this.editingIndex === index) {
      this.closeEditor();
    } else {
      // Open editor for this pill
      this.openEditor(index);
    }
  }
  
  handleDocumentClick(e) {
    // If clicking outside the pill grid, close any open editor
    // Skip if we just opened the editor (to prevent immediate close)
    if (this.justOpened) {
      this.justOpened = false;
      return;
    }
    if (this.editingIndex !== null && !this.container.contains(e.target)) {
      this.saveEditor();
    }
  }
  
  openEditor(index) {
    this.editingIndex = index;
    this.justOpened = true;
    this.render();
  }
  
  closeEditor() {
    this.editingIndex = null;
    this.render();
  }
  
  saveEditor() {
    if (this.editingIndex === null) return;
    
    const pill = this.pillGrid.querySelector(`[data-index="${this.editingIndex}"]`);
    if (!pill) {
      this.closeEditor();
      return;
    }
    
    const editor = pill.querySelector(".source-editor");
    if (!editor) {
      this.closeEditor();
      return;
    }
    
    // Get updated values from editor
    const textInput = editor.querySelector(".source-editor__text");
    const typeSelect = editor.querySelector(".source-editor__type");
    
    const item = this.items[this.editingIndex];
    if (!item) {
      this.closeEditor();
      return;
    }
    
    // Update source object
    const newText = textInput?.value?.trim() || this.getItemText(item);
    const newType = typeSelect?.value || item.type || "unknown";
    
    // Build updated source object
    const updatedSource = {
      text: newText,
      type: newType
    };
    
    // Get type-specific field values
    const typeConfig = SOURCE_TYPES[newType];
    if (typeConfig?.fields) {
      typeConfig.fields.forEach(field => {
        const fieldInput = editor.querySelector(`[data-field="${field.name}"]`);
        if (fieldInput && fieldInput.value.trim()) {
          updatedSource[field.name] = fieldInput.value.trim();
        }
      });
    }
    
    this.items[this.editingIndex] = updatedSource;
    this.editingIndex = null;
    this.render();
    this.notifyChange();
  }
  
  render() {
    if (this.items.length === 0) {
      this.pillGrid.classList.add("source-pill-grid--empty");
      this.pillGrid.innerHTML = escapeHtml(this.options.emptyMessage);
      return;
    }
    
    this.pillGrid.classList.remove("source-pill-grid--empty");
    
    this.pillGrid.innerHTML = this.items
      .map((item, index) => this.renderPill(item, index))
      .join("");
    
    // Add event listeners for editor controls
    if (this.editingIndex !== null) {
      const typeSelect = this.pillGrid.querySelector(".source-editor__type");
      if (typeSelect) {
        typeSelect.addEventListener("change", (e) => {
          // Update the type-specific fields when type changes
          this.updateEditorFields(e.target.value);
        });
      }
      
      // Add direct event listeners for Save and Cancel buttons
      const saveBtn = this.pillGrid.querySelector(".source-editor__save");
      const cancelBtn = this.pillGrid.querySelector(".source-editor__cancel");
      
      if (saveBtn) {
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveEditor();
        });
      }
      
      if (cancelBtn) {
        cancelBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeEditor();
        });
      }
    }
  }
  
  renderPill(item, index) {
    const text = this.getItemText(item);
    const type = typeof item === "string" ? "unknown" : (item.type || "unknown");
    const emoji = getSourceEmoji(type);
    const truncated = truncate(text, this.options.maxLength);
    const needsTooltip = text.length > this.options.maxLength;
    const isEditing = this.editingIndex === index;
    
    let editorHtml = "";
    if (isEditing) {
      editorHtml = this.renderEditor(item, type);
    }
    
    return `
      <div class="source-pill-item ${isEditing ? "source-pill-item--editing" : ""}" data-index="${index}" role="button" aria-label="Edit ${escapeHtml(text)}">
        <span class="source-pill-item__emoji" aria-label="${escapeHtml(SOURCE_TYPES[type]?.label || "Unknown")}">${emoji}</span>
        <span class="source-pill-item__text">${escapeHtml(truncated)}</span>
        ${needsTooltip && !isEditing ? `<span class="source-pill-item__full">${escapeHtml(text)}</span>` : ""}
        <span class="source-pill-item__remove" aria-hidden="true" title="Remove">×</span>
        ${editorHtml}
      </div>
    `;
  }
  
  renderEditor(item, currentType) {
    const text = this.getItemText(item);
    const typeOptions = Object.entries(SOURCE_TYPES)
      .map(([key, config]) => 
        `<option value="${key}" ${key === currentType ? "selected" : ""}>${config.emoji} ${config.label}</option>`
      )
      .join("");
    
    const typeConfig = SOURCE_TYPES[currentType] || SOURCE_TYPES.unknown;
    const fieldsHtml = typeConfig.fields.map(field => `
      <label class="source-editor__field">
        <span class="source-editor__label">${escapeHtml(field.label)}</span>
        <input 
          type="${field.type}" 
          class="input source-editor__input" 
          data-field="${field.name}"
          value="${escapeHtml(typeof item === "object" ? (item[field.name] || "") : "")}"
          placeholder="${escapeHtml(field.placeholder)}"
        />
      </label>
    `).join("");
    
    return `
      <div class="source-editor" onclick="event.stopPropagation()">
        <label class="source-editor__field">
          <span class="source-editor__label">Title</span>
          <input 
            type="text" 
            class="input source-editor__text" 
            value="${escapeHtml(text)}"
            placeholder="Source title or description"
          />
        </label>
        <label class="source-editor__field">
          <span class="source-editor__label">Type</span>
          <select class="select source-editor__type">
            ${typeOptions}
          </select>
        </label>
        <div class="source-editor__type-fields">
          ${fieldsHtml}
        </div>
        <div class="source-editor__actions">
          <button type="button" class="btn btn--secondary source-editor__save">Save</button>
          <button type="button" class="btn btn--outline source-editor__cancel">Cancel</button>
        </div>
      </div>
    `;
  }
  
  updateEditorFields(newType) {
    const editor = this.pillGrid.querySelector(".source-editor");
    if (!editor) return;
    
    const typeFieldsContainer = editor.querySelector(".source-editor__type-fields");
    if (!typeFieldsContainer) return;
    
    const typeConfig = SOURCE_TYPES[newType] || SOURCE_TYPES.unknown;
    const item = this.items[this.editingIndex] || {};
    
    typeFieldsContainer.innerHTML = typeConfig.fields.map(field => `
      <label class="source-editor__field">
        <span class="source-editor__label">${escapeHtml(field.label)}</span>
        <input 
          type="${field.type}" 
          class="input source-editor__input" 
          data-field="${field.name}"
          value="${escapeHtml(typeof item === "object" ? (item[field.name] || "") : "")}"
          placeholder="${escapeHtml(field.placeholder)}"
        />
      </label>
    `).join("");
  }
  
  notifyChange() {
    if (this.options.onChange) {
      this.options.onChange(this.items);
    }
  }
  
  // Public API
  getItems() {
    return this.items.map(item => {
      // Return as objects with at least text and type
      if (typeof item === "string") {
        return { text: item, type: "unknown" };
      }
      return { ...item };
    });
  }
  
  setItems(items) {
    // Handle both plain strings and source objects for backward compatibility
    this.items = Array.isArray(items)
      ? items
          .filter(Boolean)
          .map(item => {
            if (typeof item === "string") {
              return { text: item, type: "unknown" };
            }
            return item;
          })
      : [];
    this.editingIndex = null;
    this.render();
  }
  
  clear() {
    this.items = [];
    this.input.value = "";
    this.editingIndex = null;
    this.render();
  }
}
