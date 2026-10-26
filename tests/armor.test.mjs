// Marked armor slots shown on every armor: rows of any inventory, the armor's own sheet, the contents of a container.
import assert from "node:assert/strict";
const S = new URL("../scripts", import.meta.url).href;
const getProperty = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const hooks = {};
globalThis.foundry = { utils: { getProperty, escapeHTML: s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;") } };
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: () => {} };
globalThis.game = {
	i18n: { format: (key, data) => `${key}:${data.used}/${data.max}`, localize: key => key },
	itempiles: { API: { isValidItemPile: () => false } }
};

const { armorSlots, slotsHTML, registerArmor } = await import(`${S}/armor.js`);
const { contentsTree } = await import(`${S}/packing.js`);
registerArmor();

const armor = (current, max, extra = {}) => ({ type: "armor", system: { armor: { current, max } }, ...extra });
assert.deepEqual(armorSlots(armor(2, 4)), { used: 2, max: 4 });
assert.deepEqual(armorSlots(armor(0, 3)), { used: 0, max: 3 });
assert.deepEqual(armorSlots(armor(6, 4)), { used: 4, max: 4 }, "never more marked than there are slots");
assert.deepEqual(armorSlots(armor(-1, 4)), { used: 0, max: 4 });
assert.deepEqual(armorSlots({ type: "armor", system: {} }), { used: 0, max: 0 }, "armor without slot data");
assert.equal(armorSlots({ type: "weapon", system: { armor: { current: 1, max: 2 } } }), null, "only armor");
assert.equal(armorSlots(null), null);
const pips = html => [(html.match(/fa-solid fa-shield/g) ?? []).length, (html.match(/fa-regular fa-shield/g) ?? []).length];
assert.deepEqual(pips(slotsHTML({ used: 2, max: 4 })), [2, 2]);
assert.deepEqual(pips(slotsHTML({ used: 0, max: 3 })), [0, 3]);
assert.ok(slotsHTML({ used: 2, max: 4 }).includes('<span class="mist-armor-count">2/4</span>'));

// A tiny DOM: rows with their tag lists, and an item sheet header.
class Element {
	constructor(classes = "", dataset = {}) { this.className = classes; this.dataset = dataset; this.children = []; this.parent = null; this.html = ""; }
	matches(name) { return this.className.split(/\s+/).includes(name); }
	append(child) { child.parent = this; this.children.push(child); return child; }
	remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
	all() { return this.children.flatMap(child => [child, ...child.all()]); }
	insertAdjacentHTML(position, html) {
		// Tags and header lines become children, so later renders can find and replace them.
		const [, classes] = html.match(/class="([^"]*)"/);
		const child = new Element(classes);
		child.html = html;
		this.append(child);
	}
	querySelectorAll(selector) {
		if (selector === "li.inventory-item[data-item-id]") { return this.all().filter(e => e.matches("inventory-item") && e.dataset.itemId); }
		if (selector === ".item-sheet-header .item-description") { return this.all().filter(e => e.matches("item-description") && e.parent?.matches("item-sheet-header")); }
		return this.all().filter(e => e.matches(selector.slice(1)));
	}
	querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
const row = id => {
	const li = new Element("inventory-item", { itemId: id });
	li.append(new Element("item-tags"));
	return li;
};
const tagsOf = (element, id) => element.querySelectorAll("li.inventory-item[data-item-id]").find(li => li.dataset.itemId === id).all().filter(e => e.matches("mist-armor-slots"));

const worn = armor(2, 4, { id: "worn", system: { armor: { current: 2, max: 4 }, equipped: true } });
const spare = armor(3, 3, { id: "spare" });
const fresh = armor(0, 5, { id: "fresh" });
const none = armor(0, 0, { id: "none" });
const sword = { id: "sword", type: "weapon", system: {} };
const items = new Map([worn, spare, fresh, none, sword].map(item => [item.id, item]));
const render = (document, element) => { for (const fn of hooks.renderActorSheetV2) { fn({ document }, element); } };
const sheetOf = (type, hasInventory = true) => ({ type, items, system: { metadata: { hasInventory } } });

for (const type of ["character", "party", "adversary"]) {
	const element = new Element();
	for (const id of items.keys()) { element.append(row(id)); }
	render(sheetOf(type), element);
	assert.deepEqual(["worn", "spare", "fresh", "none", "sword"].map(id => tagsOf(element, id).length), [1, 1, 1, 0, 0], `${type}: every armor with slots, worn or not`);
	const tag = tagsOf(element, "spare")[0];
	assert.ok(tag.html.includes('data-tooltip="MIST_EQUIP.ArmorSlotsHint:3/3"'), tag.html);
	assert.ok(tag.html.includes("mist-armor-slots marked") && tag.html.includes(">3/3<"));
	assert.ok(!tagsOf(element, "fresh")[0].html.includes("marked"), "nothing marked: no highlight");
	// Rendered again after a slot is marked: the one tag is replaced, not doubled.
	spare.system.armor.current = 1;
	render(sheetOf(type), element);
	assert.equal(tagsOf(element, "spare").length, 1);
	assert.ok(tagsOf(element, "spare")[0].html.includes(">1/3<"));
	spare.system.armor.current = 3;
}
const noInventory = new Element();
noInventory.append(row("worn"));
render(sheetOf("environment", false), noInventory);
assert.equal(tagsOf(noInventory, "worn").length, 0, "sheets without an inventory are left alone");

// The armor's own sheet: a line with the marked slots in its header, once.
const sheetElement = new Element();
sheetElement.append(new Element("item-sheet-header")).append(new Element("item-description"));
const renderItem = document => { for (const fn of hooks.renderItemSheetV2) { fn({ document }, sheetElement); } };
renderItem(worn);
renderItem(worn);
const lines = sheetElement.all().filter(e => e.matches("mist-armor-slots"));
assert.equal(lines.length, 1);
assert.ok(lines[0].html.includes("MIST_EQUIP.ArmorSlotsUsed:2/4") && lines[0].html.includes(">2/4<"));
const lootSheet = new Element();
lootSheet.append(new Element("item-sheet-header")).append(new Element("item-description"));
for (const fn of hooks.renderItemSheetV2) { fn({ document: { type: "loot", system: {} } }, lootSheet); }
assert.equal(lootSheet.all().filter(e => e.matches("mist-armor-slots")).length, 0);

// Armor packed in a backpack lying in the sidebar: the backpack's contents list shows its marked slots.
const packedBackpack = { type: "loot", parent: null, flags: { "mist-age-equipment": { container: true, contents: [
	{ name: "Chainmail", type: "armor", system: { armor: { current: 1, max: 4 } } },
	{ name: "Rope", type: "loot", system: { quantity: 2 } }
] } } };
const tree = contentsTree(packedBackpack);
assert.deepEqual(tree.map(entry => [entry.name, entry.slots]), [["Chainmail", { used: 1, max: 4 }], ["Rope", null]]);
console.log("armor test passed");
