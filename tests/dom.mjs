// A small DOM for tests, on htmlparser2 from the Foundry install: enough of querySelector, insertAdjacentHTML,
// classList, dataset and events for the module's sheet code. Selectors: descendant chains of tag, .class, [attr] and
// [attr='value'] parts.
import { createRequire } from "node:module";
const require = createRequire(process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app/");
const { parseDocument } = require("htmlparser2");

const wrappers = new WeakMap();

function wrap(node) {
	if (!node || node.type !== "tag") {
		return null;
	}
	if (!wrappers.has(node)) {
		wrappers.set(node, new Element(node));
	}
	return wrappers.get(node);
}

function parsePart(part) {
	const tag = part.match(/^[a-z][a-z0-9-]*/i)?.[0] ?? null;
	const classes = [...part.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
	const attributes = [...part.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g)].map(([, name, value]) => ({ name, value }));
	return { tag, classes, attributes };
}

function matchesPart(node, { tag, classes, attributes }) {
	if (node.type !== "tag" || (tag && node.name !== tag.toLowerCase())) {
		return false;
	}
	const own = (node.attribs.class ?? "").split(/\s+/);
	return classes.every(name => own.includes(name)) && attributes.every(({ name, value }) => name in node.attribs && (value === undefined || node.attribs[name] === value));
}

function descendants(node) {
	return (node.children ?? []).flatMap(child => (child.type === "tag" ? [child, ...descendants(child)] : []));
}

export class Element {
	constructor(node) {
		this.node = node;
		this.listeners = {};
	}

	get dataset() {
		const element = this;
		return new Proxy({}, {
			get: (target, key) => element.node.attribs[`data-${String(key).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`],
			ownKeys: () => Object.keys(element.node.attribs).filter(name => name.startsWith("data-")).map(name => name.slice(5).replace(/-(\w)/g, (m, letter) => letter.toUpperCase())),
			getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
		});
	}

	get classList() {
		const node = this.node;
		const list = () => (node.attribs.class ?? "").split(/\s+/).filter(Boolean);
		return {
			add: name => { node.attribs.class = [...new Set([...list(), name])].join(" "); },
			remove: name => { node.attribs.class = list().filter(own => own !== name).join(" "); },
			contains: name => list().includes(name)
		};
	}

	getAttribute(name) {
		return this.node.attribs[name] ?? null;
	}

	get disabled() {
		return "disabled" in this.node.attribs;
	}

	get checked() {
		return "checked" in this.node.attribs;
	}

	get value() {
		return this.node.attribs.value ?? "";
	}

	get textContent() {
		const text = node => (node.type === "text" ? node.data : (node.children ?? []).map(text).join(""));
		return text(this.node).replace(/\s+/g, " ").trim();
	}

	querySelectorAll(selector) {
		const parts = selector.trim().split(/\s+/).map(parsePart);
		return descendants(this.node).filter(node => {
			if (!matchesPart(node, parts.at(-1))) {
				return false;
			}
			let index = parts.length - 2;
			for (let up = node.parent; up && up !== this.node.parent && index >= 0; up = up.parent) {
				if (matchesPart(up, parts[index])) {
					index--;
				}
			}
			return index < 0;
		}).map(wrap);
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	insertAdjacentHTML(position, html) {
		const nodes = parseDocument(html).children;
		for (const node of nodes) {
			node.parent = this.node;
		}
		this.node.children.push(...nodes);
	}

	remove() {
		const siblings = this.node.parent?.children;
		siblings?.splice(siblings.indexOf(this.node), 1);
	}

	addEventListener(type, listener) {
		(this.listeners[type] ??= []).push(listener);
	}

	/** Fires listeners as the browser would; for change events the value or checked state is set first. */
	async fire(type, { value, checked } = {}) {
		if (value !== undefined) {
			this.node.attribs.value = String(value);
		}
		if (checked !== undefined) {
			if (checked) {
				this.node.attribs.checked = "";
			} else {
				delete this.node.attribs.checked;
			}
		}
		const target = { value: this.value, checked: this.checked };
		for (const listener of this.listeners[type] ?? []) {
			await listener({ target, preventDefault() {}, stopPropagation() {} });
		}
	}
}

/** A root element holding the given HTML. */
export function html(source) {
	const root = parseDocument(`<div class="test-root">${source}</div>`).children[0];
	return wrap(root);
}
