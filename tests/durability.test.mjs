// Durability: switched on per item by the GM, stepped down and up by the GM and the owner, broken at 0.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { html } from "./dom.mjs";
const S = new URL("../scripts", import.meta.url).href;
const getProperty = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const setProperty = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); let t = o; for (const k of ks) { t = t[k] ??= {}; } t[last] = v; };
const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8")).MIST_EQUIP;
const hooks = {};
globalThis.foundry = { utils: { getProperty, setProperty, escapeHTML: s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;") } };
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: () => {} };
globalThis.game = {
	user: { isGM: true },
	i18n: {
		localize: key => en[key.replace("MIST_EQUIP.", "")] ?? key,
		format: (key, data) => (en[key.replace("MIST_EQUIP.", "")] ?? key).replace(/{(\w+)}/g, (m, k) => data[k])
	},
	itempiles: { API: { isValidItemPile: () => false } },
	// Foundry's settings: registered with a default, read and written by module and key.
	settings: {
		settings: new Map(),
		values: new Map(),
		register(module, key, config) { this.settings.set(`${module}.${key}`, config); this.values.set(`${module}.${key}`, config.default); },
		get(module, key) { return this.values.get(`${module}.${key}`); },
		set(module, key, value) { this.values.set(`${module}.${key}`, value); this.settings.get(`${module}.${key}`).onChange?.(value); }
	}
};

const D = await import(`${S}/durability.js`);
const { contentsTree } = await import(`${S}/packing.js`);
D.registerDurability();
const P = "flags.mist-age-equipment.durability";

/** An item whose update applies the changes, as Foundry would, and remembers them. */
const updates = [];
let nextId = 0;
const item = (type, durability) => {
	const doc = { id: `${type}${nextId++}`, type, name: `A ${type}`, flags: durability ? { "mist-age-equipment": { durability } } : {}, system: {} };
	doc.update = async changes => {
		updates.push(changes);
		for (const [key, value] of Object.entries(changes)) { setProperty(doc, key, value); }
	};
	return doc;
};

// The rules.
assert.equal(D.getDurability(item("weapon")), null, "off unless switched on");
assert.equal(D.getDurability(item("weapon", { enabled: false, value: 3, max: 6 })), null);
assert.equal(D.getDurability(item("consumable", { enabled: true, value: 3, max: 6 })), null, "only weapons, armor and loot");
for (const type of ["weapon", "armor", "loot"]) {
	assert.deepEqual(D.getDurability(item(type, { enabled: true, value: 3, max: 6 })), { value: 3, max: 6, broken: false });
}
assert.deepEqual(D.getDurability(item("weapon", { enabled: true, value: 0, max: 4 })), { value: 0, max: 4, broken: true });
assert.deepEqual(D.getDurability(item("weapon", { enabled: true, value: 9, max: 4 })), { value: 4, max: 4, broken: false }, "never above the maximum");
assert.deepEqual(D.getDurability(item("weapon", { enabled: true, value: -2, max: 4 })), { value: 0, max: 4, broken: true });
assert.deepEqual(D.getDurability(item("weapon", { enabled: true })), { value: D.DEFAULT_MAX, max: D.DEFAULT_MAX, broken: false }, "no numbers yet: full, at the default");
assert.deepEqual(D.getDurability(item("weapon", { enabled: true, value: null, max: 0 })), { value: 1, max: 1, broken: false }, "a maximum of at least 1");
assert.deepEqual(D.enableChanges(item("weapon"), true), { [`${P}.enabled`]: true, [`${P}.max`]: 6, [`${P}.value`]: 6 }, "switched on: full");
assert.deepEqual(D.enableChanges(item("weapon", { enabled: false, value: 2, max: 5 }), true), { [`${P}.enabled`]: true, [`${P}.max`]: 5, [`${P}.value`]: 2 }, "switched back on: where it was");
assert.deepEqual(D.enableChanges(item("weapon", { enabled: true, value: 2, max: 5 }), false), { [`${P}.enabled`]: false }, "off keeps the numbers");
assert.deepEqual(D.maxChanges(item("weapon", { enabled: true, value: 5, max: 6 }), 3), { [`${P}.max`]: 3, [`${P}.value`]: 3 }, "a lower maximum cuts what is left");
assert.deepEqual(D.maxChanges(item("weapon", { enabled: true, value: 2, max: 6 }), 10), { [`${P}.max`]: 10, [`${P}.value`]: 2 }, "a higher one does not repair");
assert.deepEqual(D.maxChanges(item("weapon", { enabled: true, value: 2, max: 6 }), 0), { [`${P}.max`]: 1, [`${P}.value`]: 1 });
assert.deepEqual(D.stepChanges(item("weapon", { enabled: true, value: 2, max: 6 }), -1), { [`${P}.value`]: 1 });
assert.deepEqual(D.stepChanges(item("weapon", { enabled: true, value: 1, max: 6 }), -1), { [`${P}.value`]: 0 }, "down to broken");
assert.equal(D.stepChanges(item("weapon", { enabled: true, value: 0, max: 6 }), -1), null, "not below 0");
assert.equal(D.stepChanges(item("weapon", { enabled: true, value: 6, max: 6 }), 1), null, "not above the maximum");
assert.deepEqual(D.stepChanges(item("weapon", { enabled: true, value: 0, max: 6 }), 1), { [`${P}.value`]: 1 }, "raised back from broken");
assert.equal(D.stepChanges(item("weapon"), -1), null);

// The settings tab.
const settingsSheet = () => html(`<header class="item-sheet-header"><div class="item-description"><h3>Weapon</h3></div></header><section class="tab settings" data-tab="settings"><fieldset class="two-columns"></fieldset></section>`);
const renderItem = (document, element, isEditable = true) => { for (const fn of hooks.renderItemSheetV2) { fn({ document, isEditable }, element); } return element; };
const block = element => element.querySelector(".mist-durability-settings");
const control = (element, name) => element.querySelector(`[data-durability='${name}']`);

// The GM: switch it on, and it starts full.
let sword = item("weapon");
let element = renderItem(sword, settingsSheet());
assert.ok(block(element), "the GM sees the block on an item without durability");
assert.equal(control(element, "enabled").checked, false);
assert.equal(control(element, "max"), null);
await control(element, "enabled").fire("change", { checked: true });
assert.deepEqual(D.getDurability(sword), { value: 6, max: 6, broken: false });
element = renderItem(sword, element);
assert.equal(element.querySelectorAll(".mist-durability-settings").length, 1, "rendered again: one block");
assert.equal(control(element, "enabled").checked, true);
assert.equal(control(element, "max").value, "6");
assert.equal(block(element).querySelector(".value").textContent, "6 / 6");
assert.ok(control(element, "increase").disabled, "full: nothing to raise");
// The GM sets the maximum to 4: what is left is cut to 4.
await control(element, "max").fire("change", { value: 4 });
assert.deepEqual(D.getDurability(sword), { value: 4, max: 4, broken: false });
// Stepped down to broken.
for (let step = 0; step < 4; step++) {
	element = renderItem(sword, element);
	await control(element, "decrease").fire("click");
}
assert.deepEqual(D.getDurability(sword), { value: 0, max: 4, broken: true });
element = renderItem(sword, element);
assert.ok(control(element, "decrease").disabled, "broken: nothing to lower");
assert.equal(block(element).querySelector(".mist-durability.broken").textContent, "Broken");
assert.ok(element.querySelector(".mist-durability-line .mist-durability.broken"), "the header says broken");
// Raised back by one.
await control(element, "increase").fire("click");
assert.deepEqual(D.getDurability(sword), { value: 1, max: 4, broken: false });
// Switched off: the block stays for the GM, the numbers are kept.
element = renderItem(sword, element);
await control(element, "enabled").fire("change", { checked: false });
assert.equal(D.getDurability(sword), null);
assert.equal(getProperty(sword, `${P}.value`), 1);
element = renderItem(sword, element);
assert.equal(control(element, "decrease"), null);
assert.equal(element.querySelector(".mist-durability-line"), null, "no durability: nothing in the header");

// The owner (a player): no switch, no maximum; lowers and raises.
game.user.isGM = false;
const axe = item("weapon", { enabled: true, value: 3, max: 5 });
element = renderItem(axe, settingsSheet());
assert.equal(control(element, "enabled"), null);
assert.equal(control(element, "max"), null);
await control(element, "decrease").fire("click");
assert.equal(D.getDurability(axe).value, 2);
element = renderItem(axe, element);
await control(element, "increase").fire("click");
assert.equal(D.getDurability(axe).value, 3);
// A player who cannot edit the item sees it, with the buttons off.
element = renderItem(axe, settingsSheet(), false);
assert.ok(control(element, "decrease").disabled && control(element, "increase").disabled);
// No durability: players see nothing.
assert.equal(block(renderItem(item("weapon"), settingsSheet())), null);
// Items without durability types get nothing even for the GM.
game.user.isGM = true;
assert.equal(block(renderItem(item("consumable"), settingsSheet())), null);
assert.equal(block(renderItem(item("feature"), settingsSheet())), null);

// Inventory rows in any inventory: a hammer with value/max, or broken in red.
const rows = ids => html(`<ul>${ids.map(id => `<li class="inventory-item" data-item-id="${id}"><span class="item-name">${id}</span><div class="item-tags"></div></li>`).join("")}</ul>`);
const bow = item("weapon", { enabled: true, value: 2, max: 3 });
const shield = item("armor", { enabled: true, value: 0, max: 2 });
const rope = item("loot", { enabled: true, value: 1, max: 1 });
const plain = item("weapon");
const items = new Map([bow, shield, rope, plain].map(entry => [entry.id, entry]));
const render = (type, element) => { for (const fn of hooks.renderActorSheetV2) { fn({ document: { type, items, system: { metadata: { hasInventory: true } } } }, element); } return element; };
for (const type of ["character", "party", "adversary"]) {
	const list = render(type, rows([...items.keys()]));
	const tag = id => list.querySelector(`li[data-item-id='${id}'] .mist-durability`);
	assert.equal(tag(bow.id).textContent, "2/3");
	assert.equal(tag(bow.id).getAttribute("data-tooltip"), "Durability 2 of 3");
	assert.equal(tag(shield.id).textContent, "Broken");
	assert.ok(tag(shield.id).classList.contains("broken"));
	assert.ok(list.querySelector(`li[data-item-id='${shield.id}']`).classList.contains("mist-broken"));
	assert.equal(tag(rope.id).textContent, "1/1");
	assert.equal(tag(plain.id), null);
	// Repaired, rendered again: one tag, and no longer broken.
	shield.flags["mist-age-equipment"].durability.value = 1;
	render(type, list);
	assert.equal(list.querySelectorAll(`li[data-item-id='${shield.id}'] .mist-durability`).length, 1);
	assert.ok(!list.querySelector(`li[data-item-id='${shield.id}']`).classList.contains("mist-broken"));
	shield.flags["mist-age-equipment"].durability.value = 0;
}

// The GM and the owner step durability straight from the tag: a click lowers it, a right click raises it.
const dagger = item("weapon", { enabled: true, value: 2, max: 3 });
dagger.isOwner = true;
const owned = { type: "character", items: new Map([[dagger.id, dagger]]), system: { metadata: { hasInventory: true } } };
const list = rows([dagger.id]);
const renderOwned = isEditable => { for (const fn of hooks.renderActorSheetV2) { fn({ document: owned, isEditable }, list); } return list.querySelector(".mist-durability"); };
let stepTag = renderOwned(true);
assert.ok(stepTag.classList.contains("mist-durability-step"));
assert.equal(stepTag.getAttribute("data-tooltip"), "Durability 2 of 3<br>Click: −1, right click: +1", "the tooltip says how");
await stepTag.fire("click");
assert.equal(D.getDurability(dagger).value, 1, "a click lowers it");
await renderOwned(true).fire("click");
await renderOwned(true).fire("click");
assert.deepEqual(D.getDurability(dagger), { value: 0, max: 3, broken: true }, "down to broken, and no lower");
await renderOwned(true).fire("contextmenu");
assert.equal(D.getDurability(dagger).value, 1, "a right click raises it");
for (let step = 0; step < 4; step++) {
	await renderOwned(true).fire("contextmenu");
}
assert.equal(D.getDurability(dagger).value, 3, "no higher than the maximum");
// Not the owner, or a sheet that cannot be edited: a plain tag, and clicks do nothing.
stepTag = renderOwned(false);
assert.ok(!stepTag.classList.contains("mist-durability-step"));
await stepTag.fire("click");
assert.equal(D.getDurability(dagger).value, 3);
dagger.isOwner = false;
stepTag = renderOwned(true);
assert.ok(!stepTag.classList.contains("mist-durability-step"));
await stepTag.fire("click");
assert.equal(D.getDurability(dagger).value, 3);
// The header of the item's own sheet steps it too.
dagger.isOwner = true;
element = renderItem(dagger, settingsSheet());
await element.querySelector(".mist-durability-line .mist-durability").fire("click");
assert.equal(D.getDurability(dagger).value, 2);

// The world setting: on by default, in the module settings; off hides durability everywhere and keeps the numbers.
const setting = game.settings.settings.get(`mist-age-equipment.${D.DURABILITY_SETTING}`);
assert.equal(setting.scope, "world");
assert.equal(setting.config, true);
assert.equal(setting.default, true);
assert.equal(D.durabilityOn(), true);
const rendered = [];
globalThis.foundry.applications = { instances: new Map([
	["actor", { rendered: true, document: { documentName: "Actor" }, render() { rendered.push("actor"); } }],
	["item", { rendered: true, document: { documentName: "Item" }, render() { rendered.push("item"); } }],
	["closed", { rendered: false, document: { documentName: "Item" }, render() { rendered.push("closed"); } }],
	["journal", { rendered: true, document: { documentName: "JournalEntry" }, render() { rendered.push("journal"); } }]
]) };
await game.settings.set("mist-age-equipment", D.DURABILITY_SETTING, false);
assert.deepEqual(rendered, ["actor", "item"], "open actor and item sheets are drawn again");
assert.equal(D.durabilityOn(), false);
const hammer = item("weapon", { enabled: true, value: 2, max: 3 });
hammer.isOwner = true;
assert.equal(D.getDurability(hammer), null, "off: no durability");
assert.equal(D.stepChanges(hammer, -1), null, "off: nothing to step");
const offRows = rows([hammer.id]);
for (const fn of hooks.renderActorSheetV2) { fn({ document: { type: "character", items: new Map([[hammer.id, hammer]]), system: { metadata: { hasInventory: true } } }, isEditable: true }, offRows); }
assert.equal(offRows.querySelector(".mist-durability"), null, "off: no tag in the inventory");
element = renderItem(hammer, settingsSheet());
assert.equal(block(element), null, "off: no block on the settings tab, even for the GM");
assert.equal(element.querySelector(".mist-durability-line"), null, "off: nothing in the header");
await game.settings.set("mist-age-equipment", D.DURABILITY_SETTING, true);
assert.deepEqual(D.getDurability(hammer), { value: 2, max: 3, broken: false }, "on again: as it was");
delete globalThis.foundry.applications;

// Durability travels in item data: a packed backpack shows it in its contents.
const packed = { type: "loot", parent: null, flags: { "mist-age-equipment": { container: true, contents: [
	{ name: "Sword", type: "weapon", flags: { "mist-age-equipment": { durability: { enabled: true, value: 0, max: 3 } } } },
	{ name: "Rope", type: "loot" }
] } } };
assert.deepEqual(contentsTree(packed).map(entry => [entry.name, entry.durability]), [["Sword", { value: 0, max: 3, broken: true }], ["Rope", null]]);
console.log("durability test passed");
