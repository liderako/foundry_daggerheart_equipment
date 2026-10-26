// Containers carry their contents: packed copies, moves between actors, Item Piles piles, deletion, the contents view.
import assert from "node:assert/strict";
const F = new URL("../scripts", import.meta.url).href;
const getProperty = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const setProperty = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); let t = o; for (const k of ks) { t = t[k] ??= {}; } t[last] = v; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hooks = {};
const call = (name, ...args) => { for (const fn of hooks[name] ?? []) { fn(...args); } };
class Collection extends Map { [Symbol.iterator]() { return this.values(); } filter(fn) { return [...this.values()].filter(fn); } some(fn) { return [...this.values()].some(fn); } }
let nextId = 0;
const ME = "me";
const notes = [];

class Item {
	constructor(data, parent) {
		Object.assign(this, structuredClone(data));
		this.id = this._id = `i${nextId++}`;
		this.parent = parent;
		this.documentName = "Item";
		this.flags ??= {};
		this.system ??= {};
		this.effects = [];
	}
	get uuid() { return `${this.parent?.uuid}.Item.${this.id}`; }
	get actor() { return this.parent; }
	updateSource(changes) { for (const [key, value] of Object.entries(changes)) { setProperty(this, key, value); } }
	toObject() {
		const { parent, documentName, effects, id, ...data } = this;
		return structuredClone({ ...data, effects: [] });
	}
	update(changes) { return this.parent.updateEmbeddedDocuments("Item", [{ _id: this.id, ...changes }]); }
}
class Actor {
	constructor(name, { pile = false } = {}) {
		this.name = name;
		this.uuid = `Actor.${name}`;
		this.documentName = "Actor";
		this.items = new Collection();
		this.system = { metadata: { hasInventory: true } };
		this.pile = pile;
		this.isOwner = true;
	}
	testUserPermission() { return true; }
	async createEmbeddedDocuments(type, list, options = {}) {
		const created = [];
		for (const data of list) {
			const item = new Item(data, this);
			call("preCreateItem", item, data, options, ME);
			this.items.set(item.id, item);
			created.push(item);
		}
		for (const item of created) { call("createItem", item, options, ME); }
		return created;
	}
	async updateEmbeddedDocuments(type, updates, options = {}) {
		for (const { _id, ...changes } of updates) {
			const item = this.items.get(_id);
			for (const [key, value] of Object.entries(changes)) { setProperty(item, key, structuredClone(value)); }
			call("updateItem", item, changes, options, ME);
		}
	}
	async deleteEmbeddedDocuments(type, ids, options = {}) {
		for (const id of ids) {
			const item = this.items.get(id);
			if (!item) { continue; }
			this.items.delete(id);
			call("deleteItem", item, options, ME);
		}
	}
}
globalThis.foundry = {
	utils: { getProperty, setProperty, deepClone: o => structuredClone(o), escapeHTML: s => String(s).replace(/</g, "&lt;") },
	documents: { modifyBatch: async batch => {
		for (const step of batch) {
			if (step.action === "create") { await step.parent.createEmbeddedDocuments(step.documentName, step.data); }
			if (step.action === "delete") { await step.parent.deleteEmbeddedDocuments(step.documentName, step.ids); }
		}
	} },
	applications: { handlebars: { loadTemplates: () => {} } }
};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: (name, fn) => { (hooks[name] ??= []).push(fn); } };
globalThis.ui = { notifications: { info: text => notes.push(text), warn: text => notes.push(text), error: text => notes.push(text) } };
const hero = new Actor("Hero");
const friend = new Actor("Friend");
const pile = new Actor("Pile", { pile: true });
globalThis.game = {
	user: { id: ME, name: "Player", isGM: true },
	users: { activeGM: { isSelf: true } },
	actors: [hero, friend, pile],
	itempiles: { API: { isValidItemPile: actor => actor.pile === true } },
	i18n: { localize: key => key, format: (key, data) => `${key} ${JSON.stringify(data)}` },
	modules: new Map()
};

const { registerPacking, contentsTree } = await import(`${F}/packing.js`);
const { registerInventory } = await import(`${F}/inventory.js`);
registerInventory();
registerPacking();
const C = "mist-age-equipment";
const flagsOf = item => item.flags[C] ?? {};
const names = actor => [...actor.items].map(item => item.name).sort();

// The hero wears a backpack with a rope and a pouch holding a ring; a potion is at hand.
const [backpack, potion] = await hero.createEmbeddedDocuments("Item", [
	{ name: "Backpack", type: "loot", flags: { [C]: { wearable: true, container: true }, "mist-age-weight": { worn: true } } },
	{ name: "Potion", type: "consumable", system: { quantity: 2 } }
]);
const [rope, pouch] = await hero.createEmbeddedDocuments("Item", [
	{ name: "Rope", type: "loot", system: { quantity: 1 }, flags: { [C]: { inside: backpack.id } } },
	{ name: "Pouch", type: "loot", flags: { [C]: { container: true, inside: backpack.id } } }
]);
await hero.createEmbeddedDocuments("Item", [{ name: "Ring", type: "loot", flags: { [C]: { inside: pouch.id } } }]);
await sleep(120);
const packed = flagsOf(backpack).contents;
assert.deepEqual(packed.map(entry => entry.name), ["Rope", "Pouch"], "the backpack packs what is directly inside it");
assert.deepEqual(packed[1].flags[C].contents.map(entry => entry.name), ["Ring"], "with the pouch's own contents");
assert.equal(packed[0].flags[C].inside, undefined, "packed items keep no id of this actor");
assert.deepEqual([backpack.flags["item-piles"].item.canStack, pouch.flags["item-piles"].item.canStack], ["no", "no"], "containers never stack");
assert.deepEqual(JSON.parse(JSON.stringify(contentsTree(backpack))), [{ name: "Rope", quantity: 1, slots: null, durability: null, children: [] }, { name: "Pouch", quantity: 1, slots: null, durability: null, children: [{ name: "Ring", quantity: 1, slots: null, durability: null, children: [] }] }]);

// Dragged to the friend's sheet: the whole backpack moves, contents and all, at hand there; the potion stays.
class Sheet { async _onDropItem() { notes.push("daggerheart transfer"); } async _preparePartContext(id, context) { return context; } }
Sheet.PARTS = { inventory: { template: "x" } };
game.system = { api: { applications: { sheets: { actors: { Character: Sheet } } } } };
for (const fn of hooks.setup) { fn(); }
const friendSheet = Object.assign(new Sheet(), { document: friend });
await friendSheet._onDropItem({ target: { closest: () => ({ dataset: { mistSection: "loose" } }) } }, backpack);
await sleep(120);
assert.deepEqual(names(hero), ["Potion"]);
assert.deepEqual(names(friend), ["Backpack", "Pouch", "Ring", "Rope"]);
assert.ok(!notes.includes("daggerheart transfer"), "the system's stacking transfer is not used");
const theirPack = [...friend.items].find(item => item.name === "Backpack");
const theirPouch = [...friend.items].find(item => item.name === "Pouch");
assert.equal(getProperty(theirPack, "flags.mist-age-weight.worn"), false, "it arrives in hand, not on the back");
assert.equal(flagsOf([...friend.items].find(item => item.name === "Rope")).inside, theirPack.id);
assert.equal(flagsOf([...friend.items].find(item => item.name === "Ring")).inside, theirPouch.id);
assert.equal(flagsOf(theirPouch).inside, theirPack.id);

// A change inside refreshes the packed copy.
await [...friend.items].find(item => item.name === "Rope").update({ "system.quantity": 3 });
await sleep(120);
assert.equal(flagsOf(theirPack).contents[0].system.quantity, 3);

// Item Piles drops the backpack on the ground: the pile gets it packed, the friend loses the contents with it.
await pile.createEmbeddedDocuments("Item", [theirPack.toObject()]);
await friend.deleteEmbeddedDocuments("Item", [theirPack.id]);
await sleep(120);
assert.deepEqual(names(friend), []);
assert.deepEqual(names(pile), ["Backpack"], "a pile keeps the backpack packed");
const pileBackpack = [...pile.items][0];
assert.deepEqual(contentsTree(pileBackpack).map(entry => [entry.name, entry.quantity, entry.children.map(child => child.name)]), [["Rope", 3, []], ["Pouch", 1, ["Ring"]]], "what it holds is seen from its packed copy");

// The hero drags it from the pile onto Worn on his sheet (the case that lost Ле'Фір's things): unpacked, worn.
const heroSheet = Object.assign(new Sheet(), { document: hero });
await heroSheet._onDropItem({ target: { closest: () => ({ dataset: { mistSection: "worn" } }) } }, pileBackpack);
await sleep(120);
assert.deepEqual(names(hero), ["Backpack", "Potion", "Pouch", "Ring", "Rope"], "the contents come out of the pile with the backpack");
assert.deepEqual(names(pile), []);
let heroPack = [...hero.items].find(item => item.name === "Backpack");
assert.equal(getProperty(heroPack, "flags.mist-age-weight.worn"), true);
assert.equal(flagsOf(heroPack).contents.length, 2, "the packed copy is the same after unpacking");
assert.equal(flagsOf(heroPack).contents[0].system.quantity, 3);

// Item Piles hands it over its own way, and the hero loots it back: unpacked again, not worn.
await pile.createEmbeddedDocuments("Item", [heroPack.toObject()]);
await hero.deleteEmbeddedDocuments("Item", [heroPack.id]);
await sleep(120);
assert.deepEqual(names(hero), ["Potion"]);
const pileBackpack2 = [...pile.items][0];
await hero.createEmbeddedDocuments("Item", [pileBackpack2.toObject()]);
await pile.deleteEmbeddedDocuments("Item", [pileBackpack2.id]);
await sleep(120);
assert.deepEqual(names(hero), ["Backpack", "Potion", "Pouch", "Ring", "Rope"]);
heroPack = [...hero.items].find(item => item.name === "Backpack");
assert.equal(getProperty(heroPack, "flags.mist-age-weight.worn"), false);

// Deleting the backpack takes everything inside with it.
await hero.deleteEmbeddedDocuments("Item", [heroPack.id]);
await sleep(120);
assert.deepEqual(names(hero), ["Potion"]);
console.log("packing test passed");
