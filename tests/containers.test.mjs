// Every way a container can leave an inventory and come back: its contents must never be lost or doubled.
import assert from "node:assert/strict";
const F = new URL("../scripts", import.meta.url).href;
const getProperty = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const setProperty = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); let t = o; for (const k of ks) { t = t[k] ??= {}; } t[last] = v; };
const settle = () => new Promise(resolve => setTimeout(resolve, 120));
const hooks = {};
const call = (name, ...args) => { for (const fn of hooks[name] ?? []) { fn(...args); } };
class Collection extends Map {
	[Symbol.iterator]() { return this.values(); }
	filter(fn) { return [...this.values()].filter(fn); }
	find(fn) { return [...this.values()].find(fn); }
	some(fn) { return [...this.values()].some(fn); }
}
let nextId = 0;
const ME = "gm";
const C = "mist-age-equipment";

class Item {
	constructor(data, parent) {
		Object.assign(this, structuredClone(data));
		this.id = this._id = data._id && parent && !parent.items.has(data._id) ? data._id : `i${nextId++}`;
		this.parent = parent;
		this.documentName = "Item";
		this.flags ??= {};
		this.system ??= {};
		this.system.quantity ??= 1;
		this.effects = [];
		this._stats ??= { compendiumSource: null };
	}
	get uuid() { return `${this.parent?.uuid ?? "Item"}.Item.${this.id}`; }
	get actor() { return this.parent; }
	updateSource(changes) { for (const [key, value] of Object.entries(changes)) { setProperty(this, key, value); } }
	toObject() {
		const { parent, documentName, effects, id, ...data } = this;
		return structuredClone({ ...data, effects: [] });
	}
	update(changes) { return this.parent.updateEmbeddedDocuments("Item", [{ _id: this.id, ...changes }]); }
}
class Actor {
	constructor(name, type = "character", { pile = false } = {}) {
		this.name = name;
		this.id = name;
		this.uuid = `Actor.${name}`;
		this.type = type;
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
		const gone = ids.map(id => this.items.get(id)).filter(Boolean);
		for (const item of gone) { this.items.delete(item.id); }
		for (const item of gone) { call("deleteItem", item, options, ME); }
	}
}
const actors = new Collection();
const addActor = (...args) => { const actor = new Actor(...args); actors.set(actor.id, actor); return actor; };
globalThis.foundry = {
	utils: { getProperty, setProperty, deepClone: o => structuredClone(o), escapeHTML: s => String(s) },
	documents: { modifyBatch: async batch => {
		for (const step of batch) {
			if (step.action === "create") { await step.parent.createEmbeddedDocuments(step.documentName, step.data); }
			if (step.action === "delete") { await step.parent.deleteEmbeddedDocuments(step.documentName, step.ids); }
			if (step.action === "update") { await step.parent.updateEmbeddedDocuments(step.documentName, step.updates); }
		}
	} },
	applications: { handlebars: { loadTemplates: () => {} } }
};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: (name, fn) => { (hooks[name] ??= []).push(fn); } };
// Errors are collected; the test checks at the end that none came that it did not expect.
const errors = [];
globalThis.ui = { notifications: { info() {}, warn() {}, error: text => errors.push(text) } };
globalThis.game = {
	user: { id: ME, name: "GM", isGM: true },
	users: { activeGM: { isSelf: true } },
	actors,
	scenes: new Map(),
	itempiles: { API: { isValidItemPile: actor => actor?.pile === true } },
	i18n: { localize: key => key, format: key => key },
	modules: new Map()
};

// Daggerheart's own drop, as the system does it: an inventory item from another actor is transferred, stacking into an
// "identical" item (same source, name and description) when the target stacks that type; anything else is created.
const daggerheartDrops = [];
class BaseSheet {
	async _preparePartContext(id, context) { return context; }
	async _onDropItem(event, item) {
		daggerheartDrops.push(item.name);
		const target = this.document;
		const origin = item.parent;
		if (!origin || origin === target) {
			return origin ? null : target.createEmbeddedDocuments("Item", [item.toObject()]);
		}
		const identical = target.items.find(other => other.name === item.name && other.system.description === item.system.description && other._stats.compendiumSource === item._stats.compendiumSource);
		const batch = identical && target.type === "party"
			? [{ action: "update", documentName: "Item", parent: target, updates: [{ _id: identical.id, "system.quantity": identical.system.quantity + item.system.quantity }] }]
			: [{ action: "create", documentName: "Item", parent: target, data: [item.toObject()] }];
		batch.push({ action: "delete", documentName: "Item", parent: origin, ids: [item.id] });
		return foundry.documents.modifyBatch(batch);
	}
}
class CharacterSheet extends BaseSheet {}
CharacterSheet.PARTS = { inventory: { template: "x" } };
class PartySheet extends BaseSheet {}
PartySheet.PARTS = { inventory: { template: "y" } };
game.system = { api: { applications: { sheets: { actors: { Character: CharacterSheet, Party: PartySheet } } } } };

const { registerInventory } = await import(`${F}/inventory.js`);
const { registerPacking, contentsTree } = await import(`${F}/packing.js`);
const { buildLayout } = await import(`${F}/layout.js`);
registerInventory();
registerPacking();
for (const fn of hooks.setup) { fn(); }

// Item Piles moves items its own way: the item's data is made on the target, then removed from where it was.
const itemPiles = async (item, target) => {
	const [made] = await target.createEmbeddedDocuments("Item", [item.toObject()]);
	await item.parent.deleteEmbeddedDocuments("Item", [item.id]);
	return made;
};
const dropOn = async (actor, item, section = "loose", container = null) => {
	const Sheet = actor.type === "party" ? PartySheet : CharacterSheet;
	const sheet = Object.assign(new Sheet(), { document: actor });
	const dataset = { mistSection: section, ...(container ? { containerId: container } : {}) };
	return sheet._onDropItem({ target: { closest: () => (section ? { dataset } : null) } }, item);
};
const bagOf = actor => actor.items.find(item => item.name === "Backpack");
const inventory = actor => [...actor.items].map(item => `${item.name}×${item.system.quantity}`).sort();
// What a backpack holds, wherever it is: rope ×3 and a pouch with a ring.
const tree = item => JSON.stringify(contentsTree(item).map(entry => [entry.name, entry.quantity, entry.children.map(child => child.name)]));
const FULL = JSON.stringify([["Rope", 3, []], ["Pouch", 1, ["Ring"]]]);
const FULL_ITEMS = ["Backpack×1", "Pouch×1", "Ring×1", "Rope×3"];
/** The backpack's items are on the actor, inside it, and its packed copy says the same. */
const assertCarries = (actor, extra = []) => {
	assert.deepEqual(inventory(actor), [...FULL_ITEMS, ...extra].sort(), `${actor.name} carries the backpack with all of it`);
	const bag = bagOf(actor);
	const pouch = actor.items.find(item => item.name === "Pouch");
	assert.equal(getProperty(actor.items.find(item => item.name === "Rope"), `flags.${C}.inside`), bag.id);
	assert.equal(getProperty(pouch, `flags.${C}.inside`), bag.id);
	assert.equal(getProperty(actor.items.find(item => item.name === "Ring"), `flags.${C}.inside`), pouch.id);
	assert.equal(tree(bag), FULL);
	assert.equal(getProperty(bag, `flags.${C}.contents`).length, 2);
};
/** A pile holds only the backpack, packed. */
const assertPacked = pile => {
	assert.deepEqual(inventory(pile), ["Backpack×1"], `${pile.name} holds only the backpack`);
	assert.equal(tree(bagOf(pile)), FULL, "its contents are packed inside it");
};

// The hero fills a backpack: rope, and a pouch with a ring.
const hero = addActor("Hero");
const friend = addActor("Friend");
const party = addActor("Party", "party");
const [backpack] = await hero.createEmbeddedDocuments("Item", [{ name: "Backpack", type: "loot", system: { description: "A pack." }, flags: { [C]: { wearable: true, container: true }, "mist-age-weight": { worn: true } } }, { name: "Torch", type: "loot" }]);
await dropOn(hero, (await hero.createEmbeddedDocuments("Item", [{ name: "Rope", type: "loot", system: { quantity: 3 } }]))[0], "container", backpack.id);
const [pouch] = await hero.createEmbeddedDocuments("Item", [{ name: "Pouch", type: "loot", flags: { [C]: { container: true } } }]);
await dropOn(hero, pouch, "container", backpack.id);
await dropOn(hero, (await hero.createEmbeddedDocuments("Item", [{ name: "Ring", type: "loot" }]))[0], "container", pouch.id);
await settle();
assertCarries(hero, ["Torch×1"]);
assert.equal(getProperty(backpack, "flags.item-piles.item.canStack"), "no", "Item Piles never stacks a container");

// 1. Thrown on the ground (an Item Piles pile) and picked up again through Item Piles.
const ground = addActor("Ground", "character", { pile: true });
await itemPiles(bagOf(hero), ground);
await settle();
assert.deepEqual(inventory(hero), ["Torch×1"], "the contents leave with the backpack");
assertPacked(ground);
await itemPiles(bagOf(ground), hero);
await settle();
assertCarries(hero, ["Torch×1"]);
assert.equal(getProperty(bagOf(hero), "flags.mist-age-weight.worn"), false, "picked up, it is in hand, not on the back");

// 2. Thrown on the ground and dragged from the pile onto the sheet, onto Worn (what lost Ле'Фір's things).
await itemPiles(bagOf(hero), ground);
await settle();
await dropOn(hero, bagOf(ground), "worn");
await settle();
assertCarries(hero, ["Torch×1"]);
assert.deepEqual(inventory(ground), []);
assert.equal(getProperty(bagOf(hero), "flags.mist-age-weight.worn"), true);

// 3. Dragged onto another character's sheet, and back; dropped outside any section it lands at hand.
await dropOn(friend, bagOf(hero), null);
await settle();
assert.deepEqual(inventory(hero), ["Torch×1"]);
assertCarries(friend);
await dropOn(hero, bagOf(friend), "loose");
await settle();
assertCarries(hero, ["Torch×1"]);
assert.deepEqual(inventory(friend), []);

// 4. Given to another character through Item Piles (a drop on their token), and back.
await itemPiles(bagOf(hero), friend);
await settle();
assertCarries(friend);
await itemPiles(bagOf(friend), hero);
await settle();
assertCarries(hero, ["Torch×1"]);

// 5. Put into the party inventory with everything inside, even where the party already has the same backpack.
const [spare] = await party.createEmbeddedDocuments("Item", [{ name: "Backpack", type: "loot", system: { description: "A pack." }, flags: { [C]: { wearable: true, container: true } } }]);
await settle();
daggerheartDrops.length = 0;
await dropOn(party, bagOf(hero), "loose");
await settle();
assert.deepEqual(daggerheartDrops, [], "Daggerheart's stacking transfer is not used for a container");
assert.deepEqual(inventory(hero), ["Torch×1"]);
const bags = party.items.filter(item => item.name === "Backpack");
assert.equal(bags.length, 2, "it does not merge into the party's backpack");
const partyBag = bags.find(item => item.id !== spare.id);
assert.equal(tree(partyBag), FULL);
assert.equal(tree(spare), "[]", "the party's own backpack stays empty");
assert.equal(getProperty(partyBag, "flags.mist-age-weight.worn"), false, "a party wears nothing");
const partyView = buildLayout([...party.items], { wearing: false });
assert.deepEqual([partyView.worn.length, partyView.containers.map(section => section.count)], [0, [0, 2]], "the party shows both backpacks as containers");
// ...and taken back from the party onto the hero's sheet.
await dropOn(hero, partyBag, "worn");
await settle();
assertCarries(hero, ["Torch×1"]);
assert.deepEqual(inventory(party), ["Backpack×1"]);

// 6. Put into the party through Item Piles, and back.
await itemPiles(bagOf(hero), party);
await settle();
const viaPiles = party.items.find(item => item.id !== spare.id && item.name === "Backpack");
assert.equal(tree(viaPiles), FULL);
assert.deepEqual(inventory(party), ["Backpack×1", ...FULL_ITEMS].sort());
await itemPiles(viaPiles, hero);
await settle();
assertCarries(hero, ["Torch×1"]);
assert.deepEqual(inventory(party), ["Backpack×1"]);

// 7. Moved to the sidebar (a world item, with no actor), then dragged back onto a sheet.
const worldItem = new Item(bagOf(hero).toObject(), null);
await hero.deleteEmbeddedDocuments("Item", [bagOf(hero).id]);
await settle();
assert.deepEqual(inventory(hero), ["Torch×1"]);
assert.equal(tree(worldItem), FULL, "the sidebar copy shows what is inside");
await dropOn(hero, worldItem, "loose");
await settle();
assertCarries(hero, ["Torch×1"]);

// 8. A fallen enemy carrying the backpack becomes a body pile: it shows the backpack once, contents packed inside.
const enemy = addActor("Enemy", "adversary");
await dropOn(enemy, bagOf(hero), "loose");
await settle();
assertCarries(enemy);
enemy.pile = true;
call("item-piles-turnIntoItemPiles", {}, { Enemy: { _id: "Enemy" } });
await settle();
assert.deepEqual(inventory(enemy), ["Backpack×1"], "nothing is found twice in the body");
assert.equal(tree(bagOf(enemy)), FULL);
await itemPiles(bagOf(enemy), hero);
await settle();
assertCarries(hero, ["Torch×1"]);
// A body turned back into an enemy unpacks what it still carries.
const [loot] = await hero.createEmbeddedDocuments("Item", [{ name: "Sack", type: "loot", flags: { [C]: { container: true } } }]);
await dropOn(hero, hero.items.find(item => item.name === "Torch"), "container", loot.id);
await settle();
await itemPiles(loot, enemy);
await settle();
assert.deepEqual(inventory(enemy), ["Sack×1"]);
enemy.pile = false;
call("item-piles-revertFromItemPiles", {}, { Enemy: { _id: "Enemy" } });
await settle();
assert.deepEqual(inventory(enemy), ["Sack×1", "Torch×1"]);
assert.equal(getProperty(enemy.items.find(item => item.name === "Torch"), `flags.${C}.inside`), enemy.items.find(item => item.name === "Sack").id);

// 9. A change inside right before the backpack leaves is carried along.
await hero.items.find(item => item.name === "Rope").update({ "system.quantity": 5 });
await settle();
await itemPiles(bagOf(hero), ground);
await settle();
assert.equal(JSON.parse(tree(bagOf(ground)))[0][1], 5);
await itemPiles(bagOf(ground), hero);
await settle();
assert.equal(hero.items.find(item => item.name === "Rope").system.quantity, 5);

// 10. Deleted: everything inside goes with it, nested pouch and ring too; nothing else is touched.
await hero.deleteEmbeddedDocuments("Item", [bagOf(hero).id]);
await settle();
assert.deepEqual(inventory(hero), []);
// ---- More paths: parts of a container, empty ones, failures, permissions, loading, unlinked tokens. ----

/** A backpack with rope ×3 and a pouch holding a ring, made on an actor the way a player fills it. */
async function fill(actor, name = "Backpack") {
	const [bag] = await actor.createEmbeddedDocuments("Item", [{ name, type: "loot", system: { description: "A pack." }, flags: { [C]: { wearable: true, container: true } } }]);
	const [rope] = await actor.createEmbeddedDocuments("Item", [{ name: "Rope", type: "loot", system: { quantity: 3 } }]);
	await dropOn(actor, rope, "container", bag.id);
	const [pouch] = await actor.createEmbeddedDocuments("Item", [{ name: "Pouch", type: "loot", flags: { [C]: { container: true } } }]);
	await dropOn(actor, pouch, "container", bag.id);
	const [ring] = await actor.createEmbeddedDocuments("Item", [{ name: "Ring", type: "loot" }]);
	await dropOn(actor, ring, "container", pouch.id);
	await settle();
	return { bag, rope, pouch, ring };
}
const named = (actor, name) => actor.items.find(item => item.name === name);
const insideOf = item => getProperty(item, `flags.${C}.inside`) ?? null;
const packedNames = item => (getProperty(item, `flags.${C}.contents`) ?? []).map(entry => entry.name);
const clear = async actor => { await actor.deleteEmbeddedDocuments("Item", [...actor.items].map(item => item.id)); await settle(); };
await clear(hero);
await clear(friend);

// 11. A pouch taken out of the backpack and dragged to another character: it brings its ring, the backpack forgets it.
let kit = await fill(hero);
await dropOn(friend, kit.pouch, "loose");
await settle();
assert.deepEqual(inventory(hero), ["Backpack×1", "Rope×3"]);
assert.deepEqual(packedNames(kit.bag), ["Rope"], "the backpack's packed copy no longer has the pouch");
assert.deepEqual(inventory(friend), ["Pouch×1", "Ring×1"]);
assert.equal(insideOf(named(friend, "Ring")), named(friend, "Pouch").id);
assert.equal(insideOf(named(friend, "Pouch")), null, "it lands at hand");
await clear(hero);
await clear(friend);

// 12. A backpack from another actor dropped straight into a sack on this sheet: it goes inside, with its contents.
kit = await fill(friend);
const [sack] = await hero.createEmbeddedDocuments("Item", [{ name: "Sack", type: "loot", flags: { [C]: { container: true } } }]);
await settle();
await dropOn(hero, kit.bag, "container", sack.id);
await settle();
assert.deepEqual(inventory(friend), []);
assert.deepEqual(inventory(hero), [...FULL_ITEMS, "Sack×1"].sort());
assert.equal(insideOf(bagOf(hero)), sack.id);
assert.equal(tree(bagOf(hero)), FULL);
assert.deepEqual(packedNames(sack), ["Backpack"]);
assert.deepEqual(getProperty(sack, `flags.${C}.contents`)[0].flags[C].contents.map(entry => entry.name), ["Rope", "Pouch"], "the sack's packed copy holds the backpack with its own contents");

// 13. On one sheet, the pouch moved from the backpack into the sack: both packed copies follow.
await dropOn(hero, named(hero, "Pouch"), "container", sack.id);
await settle();
assert.deepEqual(packedNames(bagOf(hero)), ["Rope"]);
assert.deepEqual(packedNames(sack).sort(), ["Backpack", "Pouch"]);
assert.equal(insideOf(named(hero, "Ring")), named(hero, "Pouch").id, "the ring stays in the pouch");

// 14. The rope taken out of the backpack to at hand: no longer packed, still on the actor.
await dropOn(hero, named(hero, "Rope"), "loose");
await settle();
assert.equal(insideOf(named(hero, "Rope")), null);
assert.deepEqual(packedNames(bagOf(hero)), []);
assert.deepEqual(inventory(hero), [...FULL_ITEMS, "Sack×1"].sort());
await clear(hero);

// 15. An empty container moves like any other, and arrives empty.
const [emptyBag] = await hero.createEmbeddedDocuments("Item", [{ name: "Backpack", type: "loot", flags: { [C]: { container: true } } }]);
await settle();
await dropOn(friend, emptyBag, "loose");
await settle();
assert.deepEqual([inventory(hero), inventory(friend)], [[], ["Backpack×1"]]);
assert.deepEqual(packedNames(bagOf(friend)), []);
await clear(friend);

// 16. The ring deleted from the pouch: the pouch's copy and the backpack's copy of the pouch both forget it.
kit = await fill(hero);
await hero.deleteEmbeddedDocuments("Item", [kit.ring.id]);
await settle();
assert.deepEqual(packedNames(kit.pouch), []);
assert.deepEqual(getProperty(kit.bag, `flags.${C}.contents`)[1].flags[C].contents, []);
assert.deepEqual(inventory(hero), ["Backpack×1", "Pouch×1", "Rope×3"]);
await clear(hero);

// 17. The rope alone thrown from the backpack onto the ground and dragged back into the backpack; then the rope
// dragged from the backpack to another character (Daggerheart's own transfer of a plain item).
kit = await fill(hero);
const ropeOnGround = await itemPiles(kit.rope, ground);
await settle();
assert.deepEqual(packedNames(kit.bag), ["Pouch"]);
assert.deepEqual(inventory(ground), ["Rope×3"]);
await dropOn(hero, ropeOnGround, "container", kit.bag.id);
await settle();
assert.equal(insideOf(named(hero, "Rope")), kit.bag.id, "picked up into the backpack");
assert.deepEqual(packedNames(kit.bag).sort(), ["Pouch", "Rope"]);
assert.deepEqual(inventory(ground), []);
await dropOn(friend, named(hero, "Rope"), "loose");
await settle();
assert.deepEqual(inventory(friend), ["Rope×3"]);
assert.equal(insideOf(named(friend, "Rope")), null, "a backpack id of another actor is not kept");
assert.deepEqual(packedNames(kit.bag), ["Pouch"]);
// The pouch given out of the backpack through Item Piles: at hand there, with no id of this backpack.
await itemPiles(kit.pouch, friend);
await settle();
assert.equal(insideOf(named(friend, "Pouch")), null);
assert.deepEqual(packedNames(kit.bag), []);
assert.deepEqual(inventory(friend).sort(), ["Pouch×1", "Ring×1", "Rope×3"]);
assert.equal(insideOf(named(friend, "Ring")), named(friend, "Pouch").id);
await clear(hero);
await clear(friend);

// 18. Without permission on the target nothing moves: an error, the backpack and its contents stay.
kit = await fill(hero);
friend.testUserPermission = () => false;
await dropOn(friend, kit.bag, "loose");
await settle();
friend.testUserPermission = () => true;
assert.equal(errors.pop(), "DAGGERHEART.UI.Notifications.lackingItemTransferPermission");
assert.deepEqual(inventory(friend), []);
assertCarries(hero);
await clear(hero);

// 19. Backpacks filled before packing existed get their packed copy when the GM loads the world.
const [oldBag] = await hero.createEmbeddedDocuments("Item", [{ name: "Backpack", type: "loot", flags: { [C]: { container: true } } }]);
await settle();
const [oldRope] = await hero.createEmbeddedDocuments("Item", [{ name: "Rope", type: "loot", system: { quantity: 3 } }]);
await settle();
// Written straight into the data, as an older version left it: inside the backpack, with no packed copy.
oldRope.flags[C] = { inside: oldBag.id };
delete oldBag.flags[C].contents;
for (const fn of hooks.ready ?? []) { fn(); }
await settle();
assert.deepEqual(packedNames(oldBag), ["Rope"]);
await clear(hero);

// 20. An unlinked enemy token (the usual adversary) becomes a body pile: packed through its token.
const tokenEnemy = new Actor("Goblin token", "adversary");
game.scenes = new Map([["scene", { tokens: new Map([["token", { actor: tokenEnemy }]]) }]]);
kit = await fill(tokenEnemy);
tokenEnemy.pile = true;
call("item-piles-turnIntoItemPiles", { scene: [{ _id: "token" }] }, {});
await settle();
assert.deepEqual(inventory(tokenEnemy), ["Backpack×1"]);
assert.equal(tree(bagOf(tokenEnemy)), FULL);
await itemPiles(bagOf(tokenEnemy), hero);
await settle();
assertCarries(hero);
await clear(hero);

// 21. A copy of the backpack made on the same actor gets its own copy of the contents; the original keeps its own.
kit = await fill(hero);
const [copy] = await hero.createEmbeddedDocuments("Item", [kit.bag.toObject()]);
await settle();
assert.equal(tree(copy), FULL);
assert.equal(tree(kit.bag), FULL);
assert.equal(hero.items.filter(item => item.name === "Ring").length, 2);
await clear(hero);

// 22. Unpacking fails (an item's data is refused): the items stay packed in the backpack and are not lost; moved on to
// someone who can take them, they come out there.
kit = await fill(friend);
const refusing = addActor("Refusing");
const create = refusing.createEmbeddedDocuments.bind(refusing);
refusing.createEmbeddedDocuments = async (type, list, options = {}) => {
	if (options.mistEquipmentUnpack) {
		throw new Error("invalid item data");
	}
	return create(type, list, options);
};
const quiet = console.error;
console.error = () => {};
await itemPiles(kit.bag, refusing);
await settle();
await refusing.items.find(item => item.name === "Backpack").update({ "system.description": "Torn." });
await settle();
console.error = quiet;
assert.equal(errors.pop(), "MIST_EQUIP.UnpackFailed");
assert.deepEqual(inventory(refusing), ["Backpack×1"]);
assert.deepEqual(packedNames(bagOf(refusing)), ["Rope", "Pouch"], "a change to the backpack does not wipe what is packed in it");
assert.equal(tree(bagOf(refusing)), FULL, "its sheet shows what is packed in it");
await dropOn(hero, bagOf(refusing), "loose");
await settle();
assertCarries(hero);
assert.deepEqual(inventory(refusing), []);
await clear(hero);

// 23. A stack of two backpacks moves whole: both, with the contents, nothing left behind.
kit = await fill(hero);
await kit.bag.update({ "system.quantity": 2 });
await settle();
await dropOn(friend, kit.bag, "loose");
await settle();
assert.deepEqual(inventory(hero), []);
assert.deepEqual(inventory(friend), ["Backpack×2", "Pouch×1", "Ring×1", "Rope×3"]);

assert.deepEqual(errors, [], "no other errors");
console.log("containers test passed: 23 cases");
