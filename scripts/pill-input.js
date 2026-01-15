/**
 * PillInput - A component for managing tags/sources as pill bubbles
 * Features:
 * - Type and press Enter to add pills
 * - Click pill to remove it and put text back in input
 * - Truncate display to 20 characters
 * - Hover shows full text (desktop)
 * - Tap once to show full text, tap again to remove (mobile)
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

export class PillInput {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      maxLength: options.maxLength || 20,
      placeholder: options.placeholder || "Type and press Enter to add...",
      emptyMessage: options.emptyMessage || "No items added yet.",
      ...options
    };
    
    this.items = [];
    this.input = null;
    this.pillGrid = null;
    
    this.init();
  }
  
  init() {
    // Create structure
    this.container.innerHTML = `
      <div class="pill-input-container">
        <input 
          type="text" 
          class="input pill-input__field" 
          placeholder="${escapeHtml(this.options.placeholder)}"
        />
        <div class="pill-grid pill-grid--empty">
          ${escapeHtml(this.options.emptyMessage)}
        </div>
      </div>
    `;
    
    this.input = this.container.querySelector(".pill-input__field");
    this.pillGrid = this.container.querySelector(".pill-grid");
    
    // Event listeners
    this.input.addEventListener("keydown", (e) => this.handleKeyDown(e));
    this.pillGrid.addEventListener("click", (e) => this.handlePillClick(e));
    
    // Mobile touch handling for showing full text
    let tapTimer = null;
    let lastTappedPill = null;
    
    this.pillGrid.addEventListener("touchstart", (e) => {
      const pill = e.target.closest(".pill-item");
      if (!pill) return;
      
      // If tapping the same pill within 300ms, it's a double tap (remove)
      if (lastTappedPill === pill && tapTimer) {
        clearTimeout(tapTimer);
        tapTimer = null;
        lastTappedPill = null;
        // Let the click handler do the removal
        return;
      }
      
      // First tap: show full text
      lastTappedPill = pill;
      
      // Remove show-full-text from all pills
      this.container.querySelectorAll(".pill-item").forEach(p => {
        if (p !== pill) p.classList.remove("show-full-text");
      });
      
      // Toggle full text display
      if (!pill.classList.contains("show-full-text")) {
        pill.classList.add("show-full-text");
        e.preventDefault(); // Prevent click event on first tap
        
        // Set up double-tap detection
        tapTimer = setTimeout(() => {
          tapTimer = null;
          lastTappedPill = null;
        }, 300);
      }
    }, { passive: false });
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
    
    // Avoid duplicates
    if (this.items.includes(value)) {
      this.input.value = "";
      return;
    }
    
    this.items.push(value);
    this.input.value = "";
    this.render();
    this.notifyChange();
  }
  
  handlePillClick(e) {
    const pill = e.target.closest(".pill-item");
    if (!pill) return;
    
    // On mobile with show-full-text, first click shows text, second removes
    if (window.innerWidth <= 720 && !pill.classList.contains("show-full-text")) {
      pill.classList.add("show-full-text");
      e.preventDefault();
      return;
    }
    
    const index = parseInt(pill.dataset.index, 10);
    if (isNaN(index) || index < 0 || index >= this.items.length) return;
    
    const item = this.items[index];
    this.items.splice(index, 1);
    this.input.value = item;
    this.render();
    this.notifyChange();
    this.input.focus();
  }
  
  render() {
    if (this.items.length === 0) {
      this.pillGrid.classList.add("pill-grid--empty");
      this.pillGrid.innerHTML = escapeHtml(this.options.emptyMessage);
      return;
    }
    
    this.pillGrid.classList.remove("pill-grid--empty");
    
    this.pillGrid.innerHTML = this.items
      .map((item, index) => {
        const truncated = truncate(item, this.options.maxLength);
        const needsTooltip = item.length > this.options.maxLength;
        
        return `
          <div class="pill-item" data-index="${index}" role="button" aria-label="Remove ${escapeHtml(item)}">
            <span class="pill-item__text">${escapeHtml(truncated)}</span>
            ${needsTooltip ? `<span class="pill-item__full">${escapeHtml(item)}</span>` : ""}
            <span class="pill-item__remove" aria-hidden="true">×</span>
          </div>
        `;
      })
      .join("");
  }
  
  notifyChange() {
    if (this.options.onChange) {
      this.options.onChange(this.items);
    }
  }
  
  // Public API
  getItems() {
    return [...this.items];
  }
  
  setItems(items) {
    this.items = Array.isArray(items) ? items.filter(Boolean) : [];
    this.render();
  }
  
  clear() {
    this.items = [];
    this.input.value = "";
    this.render();
  }
}
