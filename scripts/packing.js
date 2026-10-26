import { CONTENTS_PATH, INSIDE_PATH, INVENTORY_TYPES, MODULE_ID, STACK_PATH } from "./constants.js";
import { armorSlots, slotsHTML } from "./armor.js";
import { durabilityTag, getDurability } from "./durability.js";
import { isContainer, locate } from "./layout.js";

/**
 * Containers carry what is inside them. In an inventory the contents are real items of the actor, put inside the
 * container; the container keeps a packed copy of their data, refreshed as they change. When the container leaves
 * (given away, dropped into an Item Piles pile, moved to the sidebar or deleted) the contents go with it: the items
 * inside are removed from the actor, and the packed copy travels in the container's data. When it arrives in an
 * inventory, the packed items are made again inside it. Piles keep containers packed.
 */

const SYNC_DELAY = 50;
const timers = new Map();
// Actors whose arriving containers are being unpacked, counted, as containers inside them unpack too: their packed
// copies must not be refreshed from half the items.
const unpacking = new Map();
// Containers whose packed items could not be made again: their packed copy is all that is left of them, so it is kept
// as it is, and never rewritten from the (missing) items on the actor.
const unpackFailed = new Set();

function isPile(actor) {
	return game.itempiles?.API?.isValidItemPile?.(actor) ?? false;
}

/** Actors whose containers hold real items: those with an inventory, except Item Piles piles. */
export function holdsInventory(actor) {
	return actor?.documentName === "Actor" && actor.system?.metadata?.hasInventory === true && !isPile(actor);
}

/** The items directly inside a container of an actor, in their sheet order. */
export function itemsInside(items, container) {
	const places = locate(items);
	return items.filter(item => places.get(item.id) === container.id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

/**
 * An item as it is packed: its data without what belongs to the actor it was on. A container in an inventory packs
 * the items inside it now; anywhere else (a pile, the sidebar) its packed copy is all there is, and it is kept, unless
 * the items are packed live on purpose (an actor turning into a pile).
 */
export function packItem(items, item, { live = holdsInventory(item.parent) } = {}) {
	const data = item.toObject();
	for (const key of ["_id", "_stats", "folder", "ownership", "sort"]) {
		delete data[key];
	}
	delete data.flags?.[MODULE_ID]?.inside;
	if (data.flags?.["mist-age-weight"]?.worn) {
		data.flags["mist-age-weight"].worn = false;
	}
	if (isContainer(item)) {
		if (live && !unpackFailed.has(item.uuid)) {
			foundry.utils.setProperty(data, CONTENTS_PATH, packContents(items, item));
		}
		foundry.utils.setProperty(data, STACK_PATH, "no");
	}
	return data;
}

export function packContents(items, container) {
	return itemsInside(items, container).map(item => packItem(items, item, { live: true }));
}

/** Refreshes the packed copies of an actor's containers, and keeps them from stacking. */
export async function syncActor(actor) {
	if (!holdsInventory(actor) || !actor.isOwner) {
		return;
	}
	if (unpacking.get(actor.uuid)) {
		scheduleSync(actor);
		return;
	}
	const items = [...actor.items];
	const updates = [];
	for (const container of items.filter(isContainer)) {
		const contents = packContents(items, container);
		const update = {};
		if (!unpackFailed.has(container.uuid) && JSON.stringify(foundry.utils.getProperty(container, CONTENTS_PATH) ?? []) !== JSON.stringify(contents)) {
			update[CONTENTS_PATH] = contents;
		}
		if (foundry.utils.getProperty(container, STACK_PATH) !== "no") {
			update[STACK_PATH] = "no";
		}
		if (Object.keys(update).length) {
			updates.push({ _id: container.id, ...update });
		}
	}
	if (updates.length) {
		await actor.updateEmbeddedDocuments("Item", updates, { mistEquipmentSync: true });
	}
}

function scheduleSync(actor) {
	clearTimeout(timers.get(actor.uuid));
	timers.set(actor.uuid, setTimeout(() => {
		timers.delete(actor.uuid);
		syncActor(actor).catch(error => console.error(`${MODULE_ID} | packing`, error));
	}, SYNC_DELAY));
}

/** A change made here to an inventory item of an actor refreshes that actor's containers. */
function onItemChange(item, options, userId) {
	const actor = item.parent;
	if (userId !== game.user.id || options?.mistEquipmentSync || !INVENTORY_TYPES.includes(item.type) || !holdsInventory(actor)) {
		return;
	}
	scheduleSync(actor);
}

/** A container arriving in an inventory is unpacked: its packed items are made again inside it. */
async function unpack(container) {
	const actor = container.parent;
	const contents = foundry.utils.getProperty(container, CONTENTS_PATH) ?? [];
	if (!contents.length || !holdsInventory(actor)) {
		return;
	}
	unpacking.set(actor.uuid, (unpacking.get(actor.uuid) ?? 0) + 1);
	try {
		const data = contents.map(entry => {
			const copy = foundry.utils.deepClone(entry);
			foundry.utils.setProperty(copy, INSIDE_PATH, container.id);
			return copy;
		});
		await actor.createEmbeddedDocuments("Item", data, { mistEquipmentUnpack: true });
	} catch (error) {
		unpackFailed.add(container.uuid);
		ui.notifications.error(game.i18n.format("MIST_EQUIP.UnpackFailed", { name: container.name, actor: actor.name }), { permanent: true });
		throw error;
	} finally {
		unpacking.set(actor.uuid, unpacking.get(actor.uuid) - 1);
	}
}

/** A container leaving an inventory takes the items inside it along. */
async function removeContents(container, options) {
	const actor = container.parent;
	if (actor?.documentName !== "Actor" || options?.mistEquipmentPacked) {
		return;
	}
	const ids = actor.items.filter(item => foundry.utils.getProperty(item, INSIDE_PATH) === container.id).map(item => item.id);
	if (ids.length) {
		await actor.deleteEmbeddedDocuments("Item", ids, { mistEquipmentContents: true });
	}
}

/**
 * A container dragged from another actor moves whole, with its contents: Daggerheart's transfer would stack it into
 * a container already there, and the contents would be lost. The move is one batch, made where the item was dropped.
 */
export async function transferContainer(targetActor, item) {
	const originActor = item.parent;
	if (!targetActor.testUserPermission(game.user, "OWNER", { exact: true })) {
		ui.notifications.error(game.i18n.format("DAGGERHEART.UI.Notifications.lackingItemTransferPermission", { user: game.user.name, target: targetActor.name }));
		return null;
	}
	const data = packItem([...originActor.items], item);
	return foundry.documents.modifyBatch([
		{ action: "create", documentName: "Item", parent: targetActor, data: [data] },
		{ action: "delete", documentName: "Item", parent: originActor, ids: [item.id] }
	]);
}

/**
 * What a container holds, as a tree: in an inventory the real items inside it, elsewhere (a pile, the sidebar, a
 * compendium), or when they could not be taken out, its packed copy.
 */
export function contentsTree(container) {
	const actor = container.parent;
	if (holdsInventory(actor) && !unpackFailed.has(container.uuid)) {
		const items = [...actor.items];
		const live = parent => itemsInside(items, parent).map(item => ({
			name: item.name,
			img: item.img,
			quantity: item.system?.quantity ?? 1,
			slots: armorSlots(item),
			durability: getDurability(item),
			children: isContainer(item) ? live(item) : []
		}));
		return live(container);
	}
	const packed = entries => entries.map(entry => ({
		name: entry.name,
		img: entry.img,
		quantity: entry.system?.quantity ?? 1,
		slots: armorSlots(entry),
		durability: getDurability(entry),
		children: isContainer(entry) ? packed(foundry.utils.getProperty(entry, CONTENTS_PATH) ?? []) : []
	}));
	return packed(foundry.utils.getProperty(container, CONTENTS_PATH) ?? []);
}

function countTree(tree) {
	return tree.reduce((sum, entry) => sum + 1 + countTree(entry.children), 0);
}

function treeHTML(tree) {
	const escape = foundry.utils.escapeHTML;
	const rows = tree.map(entry => `
		<li>
			<div class="mist-equip-entry">
				<img src="${escape(entry.img)}" alt="">
				<span class="name">${escape(entry.name)}</span>
				${entry.slots?.max ? `<span class="mist-armor-slots">${slotsHTML(entry.slots)}</span>` : ""}
				${entry.durability ? durabilityTag(entry.durability) : ""}
				${entry.quantity > 1 ? `<span class="quantity">×${entry.quantity}</span>` : ""}
			</div>
			${entry.children.length ? treeHTML(entry.children) : ""}
		</li>`).join("");
	return `<ul class="mist-equip-tree">${rows}</ul>`;
}

/** The contents of a container at the top of its description tab. */
function injectContents(sheet, element) {
	const item = sheet.document;
	const tab = element.querySelector("section.tab[data-tab='description']");
	if (!isContainer(item) || !tab) {
		return;
	}
	tab.querySelector(".mist-equip-contents")?.remove();
	const tree = contentsTree(item);
	const legend = game.i18n.format("MIST_EQUIP.Contents", { count: countTree(tree) });
	const body = tree.length ? treeHTML(tree) : `<p class="hint">${game.i18n.localize("MIST_EQUIP.ContentsEmpty")}</p>`;
	tab.insertAdjacentHTML("afterbegin", `<fieldset class="mist-equip-contents"><legend><i class="fa-solid fa-box-open" inert></i> ${legend}</legend>${body}</fieldset>`);
}

/**
 * An actor turned into an Item Piles pile (a fallen enemy's body) packs its containers: what is inside them goes into
 * their packed copies and leaves the pile's list, so it is found inside the container and not twice.
 */
export async function packActor(actor) {
	const items = [...actor.items];
	const containers = items.filter(isContainer);
	if (!containers.length) {
		return;
	}
	const updates = containers.map(container => ({ _id: container.id, [CONTENTS_PATH]: packContents(items, container), [STACK_PATH]: "no" }));
	await actor.updateEmbeddedDocuments("Item", updates, { mistEquipmentSync: true });
	const places = locate(items);
	const inside = items.filter(item => places.get(item.id)).map(item => item.id);
	if (inside.length) {
		await actor.deleteEmbeddedDocuments("Item", inside, { mistEquipmentPacked: true });
	}
}

/** A pile turned back into an actor unpacks its containers, as an arriving container is unpacked. */
export async function unpackActor(actor) {
	for (const container of [...actor.items].filter(isContainer)) {
		if (!actor.items.some(item => foundry.utils.getProperty(item, INSIDE_PATH) === container.id)) {
			await unpack(container);
		}
	}
}

/** The actors of the tokens and actors Item Piles changed, each once. */
function pileActors(tokenUpdateGroups, actorUpdateGroups) {
	const actors = new Map();
	for (const [sceneId, updates] of Object.entries(tokenUpdateGroups ?? {})) {
		for (const update of updates) {
			const actor = game.scenes.get(sceneId)?.tokens.get(update._id)?.actor;
			if (actor) {
				actors.set(actor.uuid, actor);
			}
		}
	}
	for (const id of Object.keys(actorUpdateGroups ?? {})) {
		const actor = game.actors.get(id);
		if (actor) {
			actors.set(actor.uuid, actor);
		}
	}
	return [...actors.values()];
}

/** Called during init. */
export function registerPacking() {
	const onPiles = action => (tokenUpdateGroups, actorUpdateGroups) => {
		if (!game.users.activeGM?.isSelf) {
			return;
		}
		for (const actor of pileActors(tokenUpdateGroups, actorUpdateGroups)) {
			action(actor).catch(error => console.error(`${MODULE_ID} | piles`, error));
		}
	};
	Hooks.on("item-piles-turnIntoItemPiles", onPiles(packActor));
	Hooks.on("item-piles-revertFromItemPiles", onPiles(unpackActor));
	Hooks.on("renderItemSheetV2", injectContents);
	Hooks.on("createItem", (item, options, userId) => {
		onItemChange(item, options, userId);
		if (userId === game.user.id && isContainer(item)) {
			unpack(item).catch(error => console.error(`${MODULE_ID} | unpacking`, error));
		}
	});
	Hooks.on("updateItem", (item, changes, options, userId) => onItemChange(item, options, userId));
	Hooks.on("deleteItem", (item, options, userId) => {
		onItemChange(item, options, userId);
		if (userId === game.user.id && isContainer(item)) {
			removeContents(item, options).catch(error => console.error(`${MODULE_ID} | removing contents`, error));
		}
	});
	// Containers that were filled before this module packed them get their packed copy once.
	Hooks.once("ready", () => {
		if (!game.users.activeGM?.isSelf) {
			return;
		}
		for (const actor of game.actors) {
			if (actor.items.some(isContainer)) {
				syncActor(actor).catch(error => console.error(`${MODULE_ID} | packing`, error));
			}
		}
	});
}
