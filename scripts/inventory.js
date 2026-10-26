import { INSIDE_PATH, INVENTORY_TYPES, MODULE_ID, SHEETS, STORAGE_TYPES, WORN_PATH } from "./constants.js";
import { buildLayout, canHold, isContainer, isWearable, isWorn } from "./layout.js";
import { holdsInventory, transferContainer } from "./packing.js";

const TEMPLATES = `modules/${MODULE_ID}/templates`;
const PARTIALS = {
	"mist-equipment.list": `${TEMPLATES}/list.hbs`,
	"mist-equipment.categories": `${TEMPLATES}/categories.hbs`,
	"mist-equipment.container": `${TEMPLATES}/container.hbs`
};
// Where an item from another actor or a compendium was dropped, until it is created on this sheet's actor.
let pending = null;

/** The slots an item takes, from the Mist Age toolkit when it is active. */
function itemLoad(item) {
	return game.modules.get("mist-age-toolkit")?.active ? game.modules.get("mist-age-toolkit").api?.getItemLoad?.(item) ?? 0 : 0;
}

/** The section an item was dropped on: worn, at hand, or a container. */
function dropTarget(event) {
	const section = event.target?.closest?.("[data-mist-section]");
	if (!section) {
		return null;
	}
	return { section: section.dataset.mistSection, container: section.dataset.containerId ?? null };
}

/**
 * The changes that put an item where it was dropped. Into a container or at hand: out of its place on the body and
 * into that container. Onto the body: wearable loot is put on; weapons and armor keep their equip button. Null when
 * the item cannot go there.
 */
export function placeChanges(actor, item, target) {
	const changes = {};
	if (target.section === "worn") {
		if (!isWearable(item)) {
			return null;
		}
		changes[WORN_PATH] = true;
		changes[INSIDE_PATH] = null;
		return changes;
	}
	if (target.section === "container") {
		const container = actor.items.get(target.container);
		if (!container || !canHold([...actor.items], container, item)) {
			ui.notifications.warn(game.i18n.localize("MIST_EQUIP.CannotHold"));
			return null;
		}
	}
	changes[INSIDE_PATH] = target.section === "container" ? target.container : null;
	if (isWorn(item)) {
		if (item.type === "weapon" || item.type === "armor") {
			changes["system.equipped"] = false;
		} else {
			changes[WORN_PATH] = false;
		}
	}
	return changes;
}

/**
 * The sheet's own drops of inventory items: moved within the actor, or created in the section they were dropped on.
 * A container from another actor moves whole, with what is inside it.
 */
function wrapDrop(sheetClass) {
	const original = sheetClass.prototype._onDropItem;
	sheetClass.prototype._onDropItem = async function(event, item) {
		const target = dropTarget(event);
		const origin = item?.parent;
		if (origin?.documentName === "Actor" && origin.uuid !== this.document.uuid && isContainer(item) && holdsInventory(this.document)) {
			pending = { actor: this.document, target: target ?? { section: "loose", container: null } };
			try {
				return await transferContainer(this.document, item);
			} finally {
				pending = null;
			}
		}
		if (!target || !INVENTORY_TYPES.includes(item?.type)) {
			return original.call(this, event, item);
		}
		if (item.parent?.uuid === this.document.uuid) {
			const changes = placeChanges(this.document, item, target);
			if (changes) {
				await item.update(changes);
			}
			return original.call(this, event, item);
		}
		pending = { actor: this.document, target };
		try {
			return await original.call(this, event, item);
		} finally {
			pending = null;
		}
	};
}

/** Adds the layout to the context of the inventory part. */
function wrapContext(sheetClass) {
	const original = sheetClass.prototype._preparePartContext;
	sheetClass.prototype._preparePartContext = async function(partId, context, options) {
		context = await original.call(this, partId, context, options);
		if (partId === "inventory" && context.inventory) {
			const storage = STORAGE_TYPES.has(this.document.type);
			context.equipment = {
				...buildLayout([...this.document.items], { load: itemLoad, wearing: !storage }),
				canWear: !storage,
				searchable: this.document.type === "character" || storage,
				// The party sheet's own rows: quantities on everything, no row menu, and its compendium browser.
				storage,
				createTypes: INVENTORY_TYPES
			};
		}
		return context;
	};
}

/**
 * An item created on an actor goes where it was dropped; items unpacked from a container go into it. Otherwise it does
 * not keep a container it was in elsewhere (ids of another actor's containers mean nothing here) and is not worn.
 */
function onPreCreateItem(item, data, options) {
	if (!INVENTORY_TYPES.includes(item.type) || !item.parent || options?.mistEquipmentUnpack) {
		return;
	}
	if (pending?.actor === item.parent) {
		const target = pending.target;
		if (target.section === "worn") {
			if (isWearable(item)) {
				item.updateSource({ [WORN_PATH]: true, [INSIDE_PATH]: null });
			}
		} else {
			const changes = { [INSIDE_PATH]: target.section === "container" ? target.container : null };
			if (isWorn(item)) {
				changes[item.type === "loot" ? WORN_PATH : "system.equipped"] = false;
			}
			item.updateSource(changes);
		}
	} else {
		// Brought in some other way (Item Piles, a duplicate): at hand, unless its container is here, and not worn.
		const changes = {};
		const inside = foundry.utils.getProperty(item, INSIDE_PATH);
		if (inside && !item.parent.items?.has(inside)) {
			changes[INSIDE_PATH] = null;
		}
		if (item.type === "loot" && isWorn(item)) {
			changes[WORN_PATH] = false;
		}
		if (Object.keys(changes).length) {
			item.updateSource(changes);
		}
	}
}

/** Outlines the innermost section under a dragged item: where it would go. */
function highlightDrops(sheet, element) {
	const root = element.querySelector(".mist-equipment");
	if (!root || root.dataset.mistDrops) {
		return;
	}
	root.dataset.mistDrops = "true";
	const clear = () => root.querySelectorAll(".mist-equip-over").forEach(section => section.classList.remove("mist-equip-over"));
	root.addEventListener("dragover", event => {
		const section = event.target.closest?.("[data-mist-section]");
		if (section && !section.classList.contains("mist-equip-over")) {
			clear();
			section.classList.add("mist-equip-over");
		}
	});
	root.addEventListener("dragleave", event => {
		if (!root.contains(event.relatedTarget)) {
			clear();
		}
	});
	root.addEventListener("drop", clear);
}

/** Called during init: the templates. The sheets are changed at setup, after the system and the toolkit added theirs. */
export function registerInventory() {
	foundry.applications.handlebars.loadTemplates(PARTIALS);
	Hooks.on("preCreateItem", onPreCreateItem);
	Hooks.on("renderActorSheetV2", highlightDrops);
	Hooks.once("setup", () => {
		const sheets = game.system.api?.applications?.sheets?.actors ?? {};
		for (const name of SHEETS) {
			const sheetClass = sheets[name];
			if (!sheetClass?.PARTS?.inventory) {
				continue;
			}
			sheetClass.PARTS = { ...sheetClass.PARTS, inventory: { ...sheetClass.PARTS.inventory, template: `${TEMPLATES}/inventory.hbs` } };
			wrapContext(sheetClass);
			wrapDrop(sheetClass);
		}
	});
}
