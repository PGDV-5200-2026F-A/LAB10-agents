/* ==========================================================================
   minidom - a small, self-contained DOM implementation.

   Purpose: verify dist/chart.js by running the real dashboard code in Node
   against the real dist/chart.html, without executing any externally
   downloaded package. It implements only the subset of the DOM that d3
   v7.9.0 (d3-selection, d3-axis) and chart.js actually use.

   Supported surface
     - document.createElement / createElementNS / createTextNode
     - Node: appendChild, insertBefore, removeChild, childNodes, parentNode,
             ownerDocument, textContent (get/set)
     - Element: attributes, setAttribute/getAttribute/removeAttribute/hasAttribute,
                className, classList, style, id, namespaceURI, tabIndex,
                getBoundingClientRect, addEventListener/removeEventListener/
                dispatchEvent, querySelector/querySelectorAll
     - A small HTML parser sufficient for the dashboard markup.

   It is NOT a browser: no layout, no paint, no CSS cascade. It exists to
   catch runtime errors and to produce a static SVG export.
   ========================================================================== */

"use strict";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

/* ------------------------------------------------------------------ style */

class Style {
  constructor() {
    this._props = new Map();
  }

  _key(name) {
    return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  setProperty(name, value, priority) {
    this._props.set(this._key(name), { value: value, priority: priority || "" });
  }

  getPropertyValue(name) {
    const entry = this._props.get(this._key(name));
    return entry ? entry.value : "";
  }

  removeProperty(name) {
    const key = this._key(name);
    const entry = this._props.get(key);
    this._props.delete(key);
    return entry ? entry.value : "";
  }

  get cssText() {
    const parts = [];
    this._props.forEach((entry, key) => {
      const name = key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      parts.push(name + ":" + entry.value);
    });
    return parts.join(";");
  }
}

/* ----------------------------------------------------------------- events */

class DomEvent {
  constructor(type, options) {
    this.type = type;
    this.bubbles = true;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    Object.assign(this, options || {});
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {}
}

/* ------------------------------------------------------------------- node */

class Node {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument || null;
    this.parentNode = null;
    this.childNodes = [];
    this.__data = undefined;
    this._listeners = new Map();
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }

  get previousSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) - 1] || null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map((n) => n.textContent).join("");
  }

  set textContent(value) {
    this.childNodes.forEach((n) => {
      n.parentNode = null;
    });
    this.childNodes = [];
    if (value !== "" && value !== null && value !== undefined) {
      const text = new TextNode(this.ownerDocument, String(value));
      this.appendChild(text);
    }
  }

  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this._listeners.get(type);
    if (!list) return;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    let node = this;
    const chain = [];
    while (node) {
      chain.push(node);
      node = node.parentNode;
    }
    chain.forEach((current) => {
      const list = current._listeners.get(event.type);
      if (!list) return;
      event.currentTarget = current;
      list.slice().forEach((listener) => {
        listener.call(current, event, current.__data);
      });
    });
    return !event.defaultPrevented;
  }
}

class TextNode extends Node {
  constructor(ownerDocument, text) {
    super(ownerDocument);
    this.nodeType = 3;
    this.nodeName = "#text";
    this._text = text;
  }

  get nodeValue() {
    return this._text;
  }

  set nodeValue(value) {
    this._text = String(value);
  }
}

/* ---------------------------------------------------------------- element */

class Element extends Node {
  constructor(ownerDocument, tagName, namespaceURI) {
    super(ownerDocument);
    this.nodeType = 1;
    this.tagName = tagName;
    this.nodeName = tagName;
    this.namespaceURI = namespaceURI || XHTML_NS;
    this.attributes = new Map();
    this.style = new Style();
    this.classList = createClassList(this);
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get tabIndex() {
    return Number(this.getAttribute("tabindex") || 0);
  }

  set tabIndex(value) {
    this.setAttribute("tabindex", String(value));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  focus() {}
  blur() {}

  querySelector(selector) {
    return querySelectorAll(this, selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const groups = parseSelectorList(selector);
    walk(this, (node) => {
      if (node === this) return;
      if (groups.some((group) => matchesGroup(node, group))) matches.push(node);
    });
    return matches;
  }

  get innerHTML() {
    return this.childNodes.map(serializeNode).join("");
  }
}

function createClassList(element) {
  const read = () => (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  const write = (list) => element.setAttribute("class", list.join(" "));
  return {
    add(...names) {
      const list = read();
      names.forEach((n) => {
        if (!list.includes(n)) list.push(n);
      });
      write(list);
    },
    remove(...names) {
      write(read().filter((n) => !names.includes(n)));
    },
    toggle(name, force) {
      const list = read();
      const has = list.includes(name);
      const shouldAdd = force === undefined ? !has : !!force;
      if (shouldAdd && !has) list.push(name);
      if (!shouldAdd && has) write(list.filter((n) => n !== name));
      if (shouldAdd && !has) write(list);
      return shouldAdd;
    },
    contains(name) {
      return read().includes(name);
    },
    get length() {
      return read().length;
    }
  };
}

/* --------------------------------------------------------------- matching */

function walk(node, visit) {
  visit(node);
  node.childNodes.slice().forEach((child) => {
    if (child.nodeType === 1) walk(child, visit);
  });
}

/* A deliberately small selector engine: tag, #id, .class, [attr], [attr=value]
   and comma-separated groups. That covers every selector this dashboard uses. */
function parseSelectorList(selector) {
  return String(selector)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const conditions = { tag: null, id: null, classes: [], attrs: [] };
      const pattern = /([.#]?[\w-]+|\[[^\]]+\])/g;
      let match;
      while ((match = pattern.exec(part)) !== null) {
        const token = match[1];
        if (token.startsWith("#")) {
          conditions.id = token.slice(1);
        } else if (token.startsWith(".")) {
          conditions.classes.push(token.slice(1));
        } else if (token.startsWith("[")) {
          const body = token.slice(1, -1);
          const eq = body.indexOf("=");
          if (eq < 0) {
            conditions.attrs.push({ name: body.trim(), value: null });
          } else {
            const name = body.slice(0, eq).trim();
            let value = body.slice(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            conditions.attrs.push({ name: name, value: value });
          }
        } else {
          conditions.tag = token.toLowerCase();
        }
      }
      return conditions;
    });
}

function matchesGroup(node, conditions) {
  if (node.nodeType !== 1) return false;
  if (conditions.tag && node.tagName.toLowerCase() !== conditions.tag) return false;
  if (conditions.id && node.getAttribute("id") !== conditions.id) return false;
  for (const cls of conditions.classes) {
    if (!node.classList.contains(cls)) return false;
  }
  for (const attr of conditions.attrs) {
    if (!node.hasAttribute(attr.name)) return false;
    if (attr.value !== null && node.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}

function querySelectorAll(root, selector) {
  const groups = parseSelectorList(selector);
  const results = [];
  walk(root, (node) => {
    if (node === root) return;
    if (groups.some((group) => matchesGroup(node, group))) results.push(node);
  });
  return results;
}

/* -------------------------------------------------------------- serializer */

function escapeText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeNode(node) {
  if (node.nodeType === 3) return escapeText(node.textContent);
  if (node.nodeType !== 1) return "";
  const attrs = [];
  node.attributes.forEach((value, name) => {
    attrs.push(" " + name + '="' + escapeAttr(value) + '"');
  });
  const tag = node.tagName;
  if (VOID_ELEMENTS.has(tag.toLowerCase())) {
    return "<" + tag + attrs.join("") + "/>";
  }
  const children = node.childNodes.map(serializeNode).join("");
  return "<" + tag + attrs.join("") + ">" + children + "</" + tag + ">";
}

/* ----------------------------------------------------------------- document */

class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.nodeName = "#document";
    this.readyState = "complete";
    this.documentElement = new Element(this, "html", XHTML_NS);
    this.appendChild(this.documentElement);
    this.body = new Element(this, "body", XHTML_NS);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new Element(this, tagName, XHTML_NS);
  }

  createElementNS(namespaceURI, tagName) {
    return new Element(this, tagName, namespaceURI);
  }

  createTextNode(text) {
    return new TextNode(this, text);
  }

  getElementById(id) {
    let found = null;
    walk(this, (node) => {
      if (!found && node.nodeType === 1 && node.getAttribute("id") === id) found = node;
    });
    return found;
  }

  querySelector(selector) {
    return querySelectorAll(this, selector)[0] || null;
  }

  querySelectorAll(selector) {
    return querySelectorAll(this, selector);
  }
}

/* ------------------------------------------------------------ html parser */

function parseAttributes(source) {
  const attributes = [];
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1];
    const value = match[2] !== undefined ? match[2]
      : match[3] !== undefined ? match[3]
      : match[4] !== undefined ? match[4] : "";
    attributes.push([name, value]);
  }
  return attributes;
}

/* Parses the subset of HTML the dashboard uses: elements, attributes, text,
   comments, doctype, void elements and raw-text (script/style) elements. */
function parseHTML(html) {
  const document = new Document();
  const stack = [document.body];
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt < 0) {
      const text = html.slice(index);
      if (text.trim()) stack[stack.length - 1].appendChild(document.createTextNode(decodeEntities(text)));
      break;
    }
    if (lt > index) {
      const text = html.slice(index, lt);
      if (text.trim()) {
        stack[stack.length - 1].appendChild(document.createTextNode(decodeEntities(text)));
      }
    }

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt)) {
      const end = html.indexOf(">", lt);
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith("</", lt)) {
      const end = html.indexOf(">", lt);
      const name = html.slice(lt + 2, end).trim().toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName.toLowerCase() === name) {
          stack.length = i;
          break;
        }
      }
      index = end + 1;
      continue;
    }

    const end = html.indexOf(">", lt);
    if (end < 0) break;
    const inner = html.slice(lt + 1, end);
    const selfClosing = inner.endsWith("/");
    const source = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([\w:-]+)/.exec(source);
    if (!nameMatch) {
      index = end + 1;
      continue;
    }
    const tagName = nameMatch[1];
    const attributes = parseAttributes(source.slice(tagName.length));

    let element;
    if (tagName === "svg" || tagName === "g" || tagName === "path" || tagName === "circle" ||
        tagName === "rect" || tagName === "line" || tagName === "text" || tagName === "tspan" ||
        tagName === "polyline" || tagName === "polygon" || tagName === "defs" ||
        tagName === "clipPath" || tagName === "use" || tagName === "title" ||
        tagName === "desc" || tagName === "linearGradient" || tagName === "stop") {
      element = new Element(document, tagName, SVG_NS);
    } else {
      element = new Element(document, tagName, XHTML_NS);
    }
    attributes.forEach(([name, value]) => element.setAttribute(name, value));
    stack[stack.length - 1].appendChild(element);
    index = end + 1;

    const lower = tagName.toLowerCase();
    if (RAW_TEXT_ELEMENTS.has(lower)) {
      const closeIndex = html.toLowerCase().indexOf("</" + lower, index);
      const raw = closeIndex < 0 ? html.slice(index) : html.slice(index, closeIndex);
      if (raw) element.appendChild(document.createTextNode(raw));
      index = closeIndex < 0 ? html.length : closeIndex;
      continue;
    }
    if (!selfClosing && !VOID_ELEMENTS.has(lower)) {
      stack.push(element);
    }
  }
  return document;
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

module.exports = {
  Document,
  Element,
  TextNode,
  DomEvent,
  parseHTML,
  serializeNode,
  querySelectorAll,
  SVG_NS,
  XHTML_NS
};
