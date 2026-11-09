// Mysterious items: until the GM identifies them they go by another name and picture, for everyone, without description,
// features or tags, and their effects do not work. Players cannot open, equip, put on or use them; the GM reads the real
// item in the Mystery block.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { html } from "./dom.mjs";
const S = new URL("../scripts", import.meta.url).href;
const getProperty = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const setProperty = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); let t = o; for (const k of ks) { t = t[k] ??= {}; } t[last] = v; };
const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8")).MIST_EQUIP;
const hooks = {};
const onceHooks = {};
const notes = [];
globalThis.foundry = { utils: { getProperty, setProperty, escapeHTML: s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;") } };
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: (name, fn) => { (onceHooks[name] ??= []).push(fn); } };
globalThis.ui = { notifications: { warn: m => notes.push(["warn", m]), info: m => notes.push(["info", m]) } };
globalThis.game = {
	user: { id: "player", isGM: false },
	i18n: {
		localize: key => en[key.replace("MIST_EQUIP.", "")] ?? key,
		format: (key, data) => (en[key.replace("MIST_EQUIP.", "")] ?? key).replace(/{(\w+)}/g, (m, k) => data[k])
	}
};
const asGM = gm => { game.user.isGM = gm; };
const P = "flags.mist-age-equipment.mystery";
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// The system's classes, as far as the module touches them. Like Foundry, an item keeps what is stored in _source and
// prepares its shown name and picture from it.
const calls = [];
class Item {
	constructor(data) { Object.assign(this, structuredClone(data)); this.documentName = "Item"; this.prepare(); }
	prepare() { this.name = this._source.name; this.img = this._source.img; this.prepareDerivedData(); }
	prepareDerivedData() {}
	_getTags() { return ["Melee", "Reliable"]; }
	_getLabels() { return ["d8+2"]; }
	async use() { calls.push(`use ${this._source.name}`); return "used"; }
	async toChat() { calls.push(`chat ${this._source.name}`); return "sent"; }
	async update(changes, options) { this.lastOptions = options;
		for (const [key, value] of Object.entries(changes)) { setProperty(this, key, value); }
		this.prepare();
	}
}
class BaseData {
	async getEnrichedDescription() { return "<p>A ring that grants flight.</p>"; }
}
class WeaponData extends BaseData {}
class LootData extends BaseData {}
class ActiveEffect {
	constructor(parent, suppressed = false) { this.parent = parent; this.suppressed = suppressed; }
	get isSuppressed() { return this.suppressed; }
}
// Each type has its own data class over a shared base, as in Daggerheart; the weapon comes first.
globalThis.CONFIG = { Item: { documentClass: Item, dataModels: { weapon: WeaponData, loot: LootData } }, ActiveEffect: { documentClass: ActiveEffect } };

const M = await import(`${S}/mystery.js`);
M.registerMystery();
for (const fn of onceHooks.setup) { fn(); }

const item = (name, type = "loot", mystery = null, extra = {}) => {
	const doc = new Item({ _source: { name, img: "ring.webp" }, type, flags: mystery ? { "mist-age-equipment": { mystery } } : {}, system: { equipped: false }, id: name.replace(/\s+/g, "-"), ...extra });
	doc.system.parent = doc;
	Object.setPrototypeOf(doc.system, (CONFIG.Item.dataModels[type] ?? BaseData).prototype);
	return doc;
};
const describe = doc => doc.system.getEnrichedDescription();
const HINT = `<p class="mist-mystery-hint">${en.UnidentifiedDescription}</p>`;

// The rules.
assert.equal(M.isUnidentified(item("Rope")), false, "identified unless marked");
assert.equal(M.isUnidentified(item("Ring", "loot", { unidentified: true })), true);
assert.equal(M.isUnidentified(item("Ring", "feature", { unidentified: true })), false, "only inventory items");
assert.equal(M.mysteryName(item("Ring", "loot", { unidentified: true, name: " Strange ring " })), "Strange ring");
assert.equal(M.mysteryName(item("Ring", "loot", { unidentified: true, name: "" })), "Unidentified item", "no name given: a general one");
assert.deepEqual(M.identifyChanges(), { [`${P}.unidentified`]: false });

// Everyone, the GM too, sees the name and picture it goes by, no description and no tags.
for (const gm of [false, true]) {
	asGM(gm);
	const who = gm ? "the GM" : "a player";
	const ring = item("Ring of Flight", "loot", { unidentified: true, name: "Strange ring" });
	assert.equal(ring.name, "Strange ring", `${who} sees the name it goes by`);
	assert.equal(ring.img, M.MYSTERY_IMG, `${who} sees a question mark for its picture`);
	assert.equal(await describe(ring), HINT, `${who} sees no description`);
	assert.deepEqual(ring._getTags(), [], `${who} sees no tags naming features or stats`);
	assert.deepEqual(ring._getLabels(), []);
	assert.equal(M.shownName({ type: "loot", name: "Ring of Flight", flags: ring.flags }), "Strange ring", "packed data too");
	assert.equal(M.shownImg({ type: "loot", img: "ring.webp", flags: ring.flags }), M.MYSTERY_IMG);
	assert.equal(M.realName(ring), "Ring of Flight", "the real name is kept");
	assert.equal(await M.realDescription(ring), "<p>A ring that grants flight.</p>", "and the real description");
}
assert.equal(item("Amulet", "loot", { unidentified: true, img: "worlds/x/odd-amulet.webp" }).img, "worlds/x/odd-amulet.webp", "or the GM's picture");

// A player cannot use it or send it to chat; the GM can.
asGM(false);
const ring = item("Ring of Flight", "loot", { unidentified: true, name: "Strange ring" });
assert.equal(await ring.use(), null, "a player cannot use it");
assert.equal(await ring.toChat(), null, "nor send it to chat");
assert.deepEqual(calls, []);
assert.equal(notes.at(-1)[1], "Strange ring is not identified yet: it cannot be used until the GM identifies it.");
asGM(true);
assert.equal(await item("Ring of Flight", "loot", { unidentified: true }).use(), "used", "the GM can use it");

// One the GM let be used unidentified (a potion brewed by chance): a player uses it, and that identifies it first, so its
// actions run and its effects work.
asGM(false);
calls.length = 0;
const potion = item("Potion of Sleep", "consumable", { unidentified: true, usable: true, name: "Murky potion" });
assert.equal(M.isUsableUnidentified(potion), true);
assert.equal(new ActiveEffect(potion).isSuppressed, true, "its effects wait until it is used");
assert.equal(await potion.use(), "used", "a player can use it");
assert.deepEqual(calls, ["use Potion of Sleep"]);
assert.equal(M.isUnidentified(potion), false, "using it identified it");
assert.deepEqual(potion.lastOptions, { "mist-age-equipment": { identifiedBy: "use" } }, "and says so to other modules");
assert.equal(potion.name, "Potion of Sleep");
assert.equal(new ActiveEffect(potion).isSuppressed, false, "its effects work");
assert.deepEqual(notes.at(-1), ["info", "Murky potion turns out to be Potion of Sleep."]);
const sealed = item("Potion of Sleep", "consumable", { unidentified: true, usable: true });
assert.equal(M.isUsableUnidentified(item("Potion", "consumable", { unidentified: true })), true, "a consumable is usable by default");
assert.equal(M.isUsableUnidentified(item("Potion", "consumable", { unidentified: true, usable: false })), false, "unless the GM unticked it");
assert.equal(M.isUsableUnidentified(item("Ring", "loot", { unidentified: true })), false, "other items only when ticked");
assert.equal(await sealed.toChat(), null, "it still cannot be sent to chat, which would name its actions");
assert.equal(M.isUnidentified(sealed), true);
calls.length = 0;

// An identified item is as it is.
asGM(false);
const rope = item("Rope");
assert.equal(rope.name, "Rope");
assert.equal(rope.img, "ring.webp");
assert.equal(await describe(rope), "<p>A ring that grants flight.</p>");
assert.deepEqual(rope._getTags(), ["Melee", "Reliable"]);
assert.equal(await rope.use(), "used");

// Its effects do not work, for anyone, until it is identified.
assert.equal(new ActiveEffect(ring).isSuppressed, true, "an unidentified item's effect is suppressed");
assert.equal(new ActiveEffect(rope).isSuppressed, false);
assert.equal(new ActiveEffect(rope, true).isSuppressed, true, "other reasons still suppress");
assert.equal(new ActiveEffect({ documentName: "Actor" }).isSuppressed, false);

// A player cannot equip or put it on; the GM can.
const preUpdate = (doc, changes, userId = game.user.id) => hooks.preUpdateItem.every(fn => fn(doc, changes, {}, userId) !== false);
asGM(false);
const blade = item("Vorpal Blade", "weapon", { unidentified: true, name: "Rusty sword" });
notes.length = 0;
assert.equal(preUpdate(blade, { system: { equipped: true } }), false, "no equipping");
assert.equal(notes.at(-1)[1], "Rusty sword is not identified yet: the GM must identify it before it can be equipped.");
assert.equal(preUpdate(ring, { flags: { "mist-age-weight": { worn: true } } }), false, "no putting on");
assert.equal(preUpdate(ring, { "flags.mist-age-weight.worn": true }), false, "flat changes too");
assert.equal(preUpdate(blade, { system: { equipped: false } }), true, "taking off is fine");
assert.equal(preUpdate(blade, { system: { equipped: true } }, "someone-else"), true, "only this client's own changes are judged");
assert.equal(preUpdate(item("Sword", "weapon"), { system: { equipped: true } }), true, "identified items equip");
asGM(true);
assert.equal(preUpdate(item("Vorpal Blade", "weapon", { unidentified: true }), { system: { equipped: true } }), true, "the GM can");

// Saving never writes the name and picture it goes by over the real ones, as a sheet form sends back what it shows.
const gmBlade = item("Vorpal Blade", "weapon", { unidentified: true, name: "Rusty sword" });
let changes = { name: "Rusty sword", img: M.MYSTERY_IMG, system: { tier: 2 } };
assert.equal(preUpdate(gmBlade, changes), true);
assert.deepEqual(changes, { system: { tier: 2 } }, "the shown name and picture are dropped, the rest is saved");
changes = { name: "Vorpal Blade of Doom", img: "blade.webp" };
preUpdate(gmBlade, changes);
assert.deepEqual(changes, { name: "Vorpal Blade of Doom", img: "blade.webp" }, "a real rename is kept");
changes = { name: "Rope" };
preUpdate(rope, changes);
assert.deepEqual(changes, { name: "Rope" }, "identified items are untouched");

// Brought in equipped or worn by a player: taken off.
asGM(false);
const arriving = item("Vorpal Blade", "weapon", { unidentified: true }, { system: { equipped: true }, flags: { "mist-age-equipment": { mystery: { unidentified: true } }, "mist-age-weight": { worn: true } } });
arriving.updateSource = update => { for (const [key, value] of Object.entries(update)) { setProperty(arriving, key, value); } };
for (const fn of hooks.preCreateItem) { fn(arriving, {}, {}, game.user.id); }
assert.equal(arriving.system.equipped, false);
assert.equal(getProperty(arriving, "flags.mist-age-weight.worn"), false);

// Its actions do not run for a player.
const preUse = action => hooks["daggerheart.preUseAction"].every(fn => fn(action) !== false);
assert.equal(preUse({ item: blade }), false);
assert.equal(preUse({ parent: { parent: blade } }), false, "the item found through the action's parent");
assert.equal(preUse({ item: item("Sword", "weapon") }), true);
assert.equal(preUse({ item: null }), true, "actions without an item run");

// The item sheet: a player sees only the picture, the name and that it is unknown. The GM keeps the sheet, masked like
// everywhere else, and reads the real item in the Mystery block.
const sheetHTML = () => html(`<div class="window-content"><header class="item-sheet-header"><div class="item-description"><h3>Secret stuff</h3></div></header><section class="tab settings" data-tab="settings"><fieldset></fieldset></section></div>`);
const renderItem = (document, element, isEditable = true) => { for (const fn of hooks.renderItemSheetV2) { fn({ document, isEditable }, element); } return element; };
asGM(false);
let element = renderItem(ring, sheetHTML());
assert.equal(element.querySelector(".item-sheet-header"), null, "nothing of the real sheet is left for a player");
assert.equal(element.querySelector(".mist-mystery-sheet h2").textContent, "Strange ring");
assert.equal(element.querySelector(".mist-mystery-settings"), null);
element = renderItem(rope, sheetHTML());
assert.ok(element.querySelector(".item-sheet-header"), "an identified item's sheet is untouched");
asGM(true);
const gmRing = item("Ring of Flight", "loot", { unidentified: true, name: "Strange ring" });
element = renderItem(gmRing, sheetHTML());
await settle();
assert.ok(element.querySelector(".item-sheet-header"), "the GM keeps the sheet");
assert.ok(element.classList.contains("mist-unidentified"), "the sheet is marked, so its price is hidden");
const settings = element.querySelector(".mist-mystery-settings");
assert.ok(settings.querySelector("input[type='checkbox']").checked);
assert.equal(settings.querySelector("input[type='text']").value, "Strange ring");
assert.equal(settings.querySelector("file-picker").value, "", "no picture of its own yet");
assert.equal(settings.querySelector(".mist-mystery-preview").getAttribute("src"), M.MYSTERY_IMG, "the preview shows the picture it goes by");
const real = settings.querySelector(".mist-mystery-real");
assert.equal(real.querySelector(".mist-mystery-real-name").textContent, "Ring of Flight", "the real name");
assert.equal(real.querySelector(".mist-mystery-preview").getAttribute("src"), "ring.webp", "the real picture");
assert.equal(real.querySelector(".mist-mystery-real-description").textContent, "A ring that grants flight.", "the real description");
renderItem(gmRing, element);
await settle();
assert.equal(element.querySelectorAll(".mist-mystery-settings").length, 1, "rendered again: one block");
notes.length = 0;
await element.querySelector(".mist-mystery-identify").fire("click");
assert.equal(M.isUnidentified(gmRing), false, "identified by the button");
assert.deepEqual(notes.at(-1), ["info", "Strange ring is identified: Ring of Flight."]);
assert.equal(gmRing.name, "Ring of Flight", "identified: the real name again");
assert.equal(gmRing.img, "ring.webp", "and the real picture");
renderItem(gmRing, element);
assert.ok(!element.classList.contains("mist-unidentified"), "identified: the same sheet is unmarked, its price shows");
element = renderItem(gmRing, sheetHTML());
assert.equal(element.querySelector(".mist-mystery-identify"), null, "identified: no button");
assert.equal(element.querySelector(".mist-mystery-real"), null, "and no real item block");
assert.ok(!element.querySelector(".mist-mystery-settings input[type='checkbox']").checked);
assert.equal(renderItem(item("Feat", "feature"), sheetHTML()).querySelector(".mist-mystery-settings"), null, "not for features");

// Inventory rows.
const rows = ids => html(`<ul>${ids.map(id => `<li class="inventory-item" data-item-id="${id}"><div class="img-portait"><img class="roll-img" src="x"></div><div class="item-tags"></div><div class="controls"><a data-action="toggleEquipItem"></a><a class="mist-wear"></a></div><div class="item-buttons"><button>Fly</button></div></li>`).join("")}</ul>`);
const renderActor = (items, element) => { for (const fn of hooks.renderActorSheetV2) { fn({ document: { items: new Map(items.map(i => [i.id, i])), system: { metadata: { hasInventory: true } } } }, element); } return element; };
asGM(false);
const hidden = item("Ring of Flight", "loot", { unidentified: true, name: "Strange ring" });
let list = renderActor([hidden, rope], rows([hidden.id, rope.id]));
const row = id => list.querySelector(`li[data-item-id='${id}']`);
assert.equal(row(hidden.id).querySelector(".mist-mystery-tag").textContent, "Unidentified");
assert.equal(row(hidden.id).querySelector(".mist-mystery-tag").getAttribute("data-tooltip"), en.UnidentifiedHint);
for (const selector of [".item-buttons", "[data-action='toggleEquipItem']", ".mist-wear", ".roll-img"]) {
	assert.equal(row(hidden.id).querySelector(selector), null, `a player's row has no ${selector}`);
	assert.ok(row(rope.id).querySelector(selector), `an identified row keeps ${selector}`);
}
assert.equal(row(rope.id).querySelector(".mist-mystery-tag"), null);
assert.ok(row(hidden.id).classList.contains("mist-unidentified"), "an unidentified row is marked, so its price is hidden");
assert.ok(!row(rope.id).classList.contains("mist-unidentified"), "an identified row shows its price");
renderActor([hidden, rope], list);
assert.equal(row(hidden.id).querySelectorAll(".mist-mystery-tag").length, 1, "rendered again: one tag");
const drink = item("Potion of Sleep", "consumable", { unidentified: true, usable: true, name: "Murky potion" });
list = renderActor([drink], rows([drink.id]));
assert.ok(row(drink.id).querySelector(".roll-img"), "a usable one keeps its dice, to be used");
assert.equal(row(drink.id).querySelector(".item-buttons"), null, "but not its action buttons, which name what it does");
assert.equal(row(drink.id).querySelector(".mist-mystery-tag").getAttribute("data-tooltip"), en.UsableUnidentifiedHint);
list = renderActor([hidden, rope], rows([hidden.id, rope.id]));
asGM(true);
const gmHidden = item("Ring of Flight", "loot", { unidentified: true, name: "Strange ring" });
list = renderActor([gmHidden], rows([gmHidden.id]));
const tag = row(gmHidden.id).querySelector(".mist-mystery-tag");
assert.equal(tag.getAttribute("data-tooltip"), "Unidentified: it is really Ring of Flight. Players cannot open, equip or use it. Click to identify.", "the GM's tag names the real item");
assert.ok(row(gmHidden.id).querySelector(".item-buttons"), "the GM keeps the buttons");
await tag.fire("click");
assert.equal(M.isUnidentified(gmHidden), false, "the GM identifies it from the row");
renderActor([gmHidden], list);
assert.ok(!row(gmHidden.id).classList.contains("mist-unidentified"), "identified: the row is unmarked, its price shows");

// The stylesheet hides the Toolkit's price, in rows and sheet headers, on what is marked unidentified.
const css = readFileSync(new URL("../styles/equipment.css", import.meta.url), "utf8");
assert.match(css, /\.mist-unidentified \.mist-price-tag,\s*\.mist-unidentified \.item-sheet-header \.mist-price \{\s*display: none !important;/);

console.log("mystery test passed");
