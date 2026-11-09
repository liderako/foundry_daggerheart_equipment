import { INVENTORY_TYPES, MODULE_ID, MYSTERY_PATH, WORN_PATH } from "./constants.js";

// Mysterious items. The GM marks an item unidentified and gives it a name and picture to go by instead of its own. Until
// the GM identifies it, everyone, the GM too, sees it by that name and picture, without its description, features or
// tags, and its effects do not work. Players cannot open its sheet, equip, put on or use it, unless the GM let them use
// it unidentified (a potion of unknown effect): using it identifies it. The GM reads the real item
// in the Mystery block on its settings tab, and identifies it.
const UNIDENTIFIED_PATH = `${MYSTERY_PATH}.unidentified`;
const NAME_PATH = `${MYSTERY_PATH}.name`;
const IMG_PATH = `${MYSTERY_PATH}.img`;
// An unidentified item a player may still use without knowing what it is, such as a potion brewed by chance: using it
// identifies it.
const USABLE_PATH = `${MYSTERY_PATH}.usable`;
// The picture players see for an unidentified item the GM gave no picture of its own: a stone with a question mark.
export const MYSTERY_IMG = "icons/magic/symbols/question-stone-yellow.webp";

const localize = key => game.i18n.localize(`MIST_EQUIP.${key}`);
const format = (key, data) => game.i18n.format(`MIST_EQUIP.${key}`, data);

/**
 * Whether this client's user is a GM. Items are prepared while the world loads, before game.user is ready, so the
 * user's role is then read from the world data.
 */
function isGM() {
	if (game.user) {
		return game.user.isGM;
	}
	const role = game.data?.users?.find(user => user._id === game.userId)?.role ?? 0;
	return role >= (CONST?.USER_ROLES?.ASSISTANT ?? 3);
}

/** An inventory item, document or plain data, that the GM has not identified yet. */
export function isUnidentified(item) {
	return INVENTORY_TYPES.includes(item?.type) && foundry.utils.getProperty(item, UNIDENTIFIED_PATH) === true;
}

/** An unidentified item is locked for players: they cannot open, equip or use it. The GM still can. */
export function isLocked(item) {
	return isUnidentified(item) && !isGM();
}

/**
 * An unidentified item a player may use anyway: using it identifies it. Consumables (potions) are usable unless the GM
 * unticked it; anything else only when the GM ticked it.
 */
export function isUsableUnidentified(item) {
	return isUnidentified(item) && usableFlag(item);
}

function usableFlag(item) {
	const flag = foundry.utils.getProperty(item, USABLE_PATH);
	return typeof flag === "boolean" ? flag : item?.type === "consumable";
}

/** The name players see for an unidentified item: the one the GM gave it, or a general one. */
export function mysteryName(item) {
	const name = String(foundry.utils.getProperty(item, NAME_PATH) ?? "").trim();
	return name || localize("UnidentifiedName");
}

/** The picture players see for an unidentified item: the one the GM gave it, or a question mark. */
export function mysteryImg(item) {
	const img = String(foundry.utils.getProperty(item, IMG_PATH) ?? "").trim();
	return img || MYSTERY_IMG;
}

/** The name to show for item data that is not a prepared document, such as a container's packed contents. */
export function shownName(item) {
	return isUnidentified(item) ? mysteryName(item) : item.name;
}

/** The picture to show for item data that is not a prepared document. */
export function shownImg(item) {
	return isUnidentified(item) ? mysteryImg(item) : item.img;
}

/** An item's real name and picture, as stored, whatever it goes by now. */
export function realName(item) {
	return item._source?.name ?? item.name;
}

function realImg(item) {
	return item._source?.img ?? item.img;
}

// Daggerheart's own enriched description, kept to show the GM the real item.
let enrichedDescription = null;

/** The real description of an item, features included, for the GM. */
export function realDescription(item) {
	return enrichedDescription && item.system ? enrichedDescription.call(item.system, { gmNotes: false }) : Promise.resolve("");
}

/** The changes that identify an item. */
export function identifyChanges() {
	return { [UNIDENTIFIED_PATH]: false };
}

/**
 * Wraps a method found on a prototype or one of its ancestors, defining the wrapper on that prototype.
 * @returns {Function|null} The original method.
 */
function wrapMethod(prototype, name, wrapper) {
	let owner = prototype;
	while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) {
		owner = Object.getPrototypeOf(owner);
	}
	const original = owner?.[name];
	if (typeof original !== "function") {
		return null;
	}
	prototype[name] = function(...args) {
		return wrapper.call(this, original, ...args);
	};
	return original;
}

/** An unidentified item goes by the GM's name and picture everywhere: sheets, inventories, tooltips, chat. */
function patchName() {
	wrapMethod(CONFIG.Item.documentClass.prototype, "prepareDerivedData", function(original, ...args) {
		const result = original.apply(this, args);
		if (isUnidentified(this)) {
			this.name = mysteryName(this);
			this.img = mysteryImg(this);
		}
		return result;
	});
}

/**
 * An unidentified item shows no description or features: every place Daggerheart shows an item's text (its sheet,
 * inventory rows, tooltips, the item browser, chat) asks the item data for its enriched description. Tags name its
 * features and stats.
 */
function patchText() {
	const models = Object.values(CONFIG.Item.dataModels ?? {});
	let base = models.map(model => model.prototype).find(prototype => typeof prototype?.getEnrichedDescription === "function");
	// Wrapped where it is defined, the shared base of every item type, not on the first type that inherits it.
	while (base && !Object.prototype.hasOwnProperty.call(base, "getEnrichedDescription")) {
		base = Object.getPrototypeOf(base);
	}
	if (base) {
		enrichedDescription = wrapMethod(base, "getEnrichedDescription", function(original, ...args) {
			return isUnidentified(this.parent) ? Promise.resolve(`<p class="mist-mystery-hint">${localize("UnidentifiedDescription")}</p>`) : original.apply(this, args);
		});
	}
	for (const name of ["_getTags", "_getLabels"]) {
		wrapMethod(CONFIG.Item.documentClass.prototype, name, function(original, ...args) {
			return isUnidentified(this) ? [] : original.apply(this, args);
		});
	}
}

/**
 * A player can neither use an unidentified item nor send it to chat: using it would first offer a choice of its actions
 * by name, and its chat card lists them. An item marked usable is the exception: using it identifies it first, so its
 * actions run and its effects work, and the player learns what it was.
 */
function patchUse() {
	for (const [name, key] of [["use", "CannotUseUnidentified"], ["toChat", "CannotUseUnidentified"]]) {
		wrapMethod(CONFIG.Item.documentClass.prototype, name, async function(original, ...args) {
			if (name === "use" && isLocked(this) && isUsableUnidentified(this)) {
				const shown = mysteryName(this);
				// Other modules learn from the options that it was identified by being used, such as Alchemy teaching the
				// character the brew they drank.
				await this.update(identifyChanges(), { [MODULE_ID]: { identifiedBy: "use" } });
				ui.notifications.info(format("UsedUnidentified", { shown, name: this.name }));
				return original.apply(this, args);
			}
			if (isLocked(this)) {
				ui.notifications.warn(format(key, { name: this.name }));
				return Promise.resolve(null);
			}
			return original.apply(this, args);
		});
	}
}

/** The effects of an unidentified item do not work, for players and the GM alike. */
function patchEffects() {
	const cls = CONFIG.ActiveEffect.documentClass;
	let owner = cls.prototype;
	while (owner && !Object.getOwnPropertyDescriptor(owner, "isSuppressed")) {
		owner = Object.getPrototypeOf(owner);
	}
	const original = owner && Object.getOwnPropertyDescriptor(owner, "isSuppressed").get;
	Object.defineProperty(cls.prototype, "isSuppressed", {
		configurable: true,
		get() {
			const item = this.parent;
			if (item?.documentName === "Item" && isUnidentified(item)) {
				return true;
			}
			return original ? original.call(this) : false;
		}
	});
}

/** Whether a change equips an item or puts it on. */
function equips(changes) {
	const get = path => changes?.[path] ?? foundry.utils.getProperty(changes, path);
	return get("system.equipped") === true || get(WORN_PATH) === true;
}

/**
 * Saving an unidentified item never writes the name and picture it goes by over its real ones: a sheet form sends back
 * what it shows. And a player cannot equip or put it on, however they try: the equip button, Worn, the wear button.
 */
function onPreUpdateItem(item, changes, options, userId) {
	if (userId !== game.user?.id || !isUnidentified(item)) {
		return true;
	}
	if ("name" in changes && changes.name === mysteryName(item) && changes.name !== realName(item)) {
		delete changes.name;
	}
	if ("img" in changes && changes.img === mysteryImg(item) && changes.img !== realImg(item)) {
		delete changes.img;
	}
	if (!isLocked(item) || !equips(changes)) {
		return true;
	}
	ui.notifications.warn(format("CannotEquipUnidentified", { name: item.name }));
	return false;
}

/** An unidentified item a player brings in already equipped or worn arrives taken off. */
function onPreCreateItem(item, data, options, userId) {
	if (userId !== game.user?.id || !isLocked(item)) {
		return;
	}
	const changes = {};
	if (item.system?.equipped === true) {
		changes["system.equipped"] = false;
	}
	if (foundry.utils.getProperty(item, WORN_PATH) === true) {
		changes[WORN_PATH] = false;
	}
	if (Object.keys(changes).length) {
		item.updateSource(changes);
	}
}

/** A player cannot use an unidentified item: none of its actions run. */
function onPreUseAction(action) {
	const item = action?.item ?? action?.parent?.parent;
	if (!isLocked(item)) {
		return true;
	}
	ui.notifications.warn(format("CannotUseUnidentified", { name: item.name }));
	return false;
}

/** A player's sheet of an unidentified item shows only what they know: its picture, its name, that it is unknown. */
function closeSheet(sheet, element) {
	const item = sheet.document;
	if (!isLocked(item)) {
		return;
	}
	const content = element.querySelector(".window-content") ?? element;
	const escape = foundry.utils.escapeHTML;
	content.innerHTML = `
		<section class="mist-mystery-sheet">
			<img src="${escape(item.img)}" alt="">
			<h2>${escape(item.name)}</h2>
			<p class="mist-mystery-hint"><i class="fa-solid fa-circle-question" inert></i> ${localize("UnidentifiedDescription")}</p>
		</section>`;
}

/**
 * The GM's block on the item's settings tab: unidentified or not, the name and picture it goes by, the real item to
 * read (its name, picture and description with features), and a button to identify it.
 */
function injectSettings(sheet, element) {
	const item = sheet.document;
	const tab = element.querySelector("section.tab[data-tab='settings']");
	if (!game.user.isGM || !INVENTORY_TYPES.includes(item.type) || !tab) {
		return;
	}
	tab.querySelector(".mist-mystery-settings")?.remove();
	const escape = foundry.utils.escapeHTML;
	const disabled = sheet.isEditable ? "" : "disabled";
	const unidentified = isUnidentified(item);
	const name = foundry.utils.getProperty(item, NAME_PATH) ?? "";
	const img = foundry.utils.getProperty(item, IMG_PATH) ?? "";
	tab.insertAdjacentHTML("beforeend", `
		<fieldset class="mist-mystery-settings">
			<legend><i class="fa-solid fa-circle-question" inert></i> ${localize("Mystery")}</legend>
			<label class="mist-mystery-row" data-tooltip="${escape(localize("UnidentifiedEnableHint"))}">
				<input type="checkbox" name="${UNIDENTIFIED_PATH}" ${unidentified ? "checked" : ""} ${disabled}> ${localize("UnidentifiedEnable")}
			</label>
			<label class="mist-mystery-row" data-tooltip="${escape(localize("UsableUnidentifiedEnableHint"))}">
				<input type="checkbox" name="${USABLE_PATH}" ${usableFlag(item) ? "checked" : ""} ${disabled}> ${localize("UsableUnidentifiedEnable")}
			</label>
			<label class="mist-mystery-row" data-tooltip="${escape(localize("MysteryNameHint"))}">${localize("MysteryName")}
				<input type="text" name="${NAME_PATH}" value="${escape(name)}" placeholder="${escape(localize("UnidentifiedName"))}" ${disabled}>
			</label>
			<div class="mist-mystery-row" data-tooltip="${escape(localize("MysteryImgHint"))}">
				<img class="mist-mystery-preview" src="${escape(img || MYSTERY_IMG)}" alt="">
				<span>${localize("MysteryImg")}</span>
				<file-picker name="${IMG_PATH}" type="image" value="${escape(img)}" placeholder="${escape(MYSTERY_IMG)}" ${disabled}></file-picker>
			</div>
			${unidentified ? `
			<div class="mist-mystery-real">
				<h4>${localize("RealItem")}</h4>
				<div class="mist-mystery-row">
					<img class="mist-mystery-preview" src="${escape(realImg(item))}" alt="">
					<strong class="mist-mystery-real-name">${escape(realName(item))}</strong>
				</div>
				<div class="mist-mystery-real-description"></div>
			</div>
			<button type="button" class="mist-mystery-identify" ${disabled}><i class="fa-solid fa-magnifying-glass" inert></i> ${localize("Identify")}</button>` : ""}
		</fieldset>`);
	tab.querySelector(".mist-mystery-identify")?.addEventListener("click", event => {
		event.preventDefault();
		identify(item);
	});
	const description = tab.querySelector(".mist-mystery-real-description");
	if (description) {
		return realDescription(item).then(html => {
			description.innerHTML = html;
		});
	}
}

async function identify(item) {
	const shown = mysteryName(item);
	await item.update(identifyChanges());
	ui.notifications.info(format("Identified", { shown, name: item.name }));
}

/**
 * Marks what shows an unidentified item, so the stylesheet hides what other modules draw on it, such as the Toolkit's
 * price, whichever of the modules draws last.
 */
function markUnidentified(element, unidentified) {
	if (unidentified) {
		element.classList.add("mist-unidentified");
	} else {
		element.classList.remove("mist-unidentified");
	}
}

/**
 * Inventory rows of unidentified items, which show no price. Players see an Unidentified tag and no action buttons,
 * equip or wear buttons; the GM sees a tag naming the real item, and identifies it by clicking the tag.
 */
function injectRows(sheet, element) {
	for (const row of element.querySelectorAll("li.inventory-item[data-item-id]")) {
		row.querySelector(".mist-mystery-tag")?.remove();
		const item = sheet.document.items?.get(row.dataset.itemId);
		markUnidentified(row, isUnidentified(item));
		if (!isUnidentified(item)) {
			continue;
		}
		const tags = row.querySelector(".item-tags");
		const gm = game.user.isGM;
		const usable = isUsableUnidentified(item);
		const tooltip = gm ? format("UnidentifiedGMHint", { name: realName(item) }) : localize(usable ? "UsableUnidentifiedHint" : "UnidentifiedHint");
		tags?.insertAdjacentHTML("afterbegin", `<div class="tag mist-mystery-tag${gm ? " mist-mystery-identify" : ""}" data-tooltip="${foundry.utils.escapeHTML(tooltip)}"><i class="fa-solid fa-circle-question" inert></i> ${localize("Unidentified")}</div>`);
		if (gm) {
			tags?.querySelector(".mist-mystery-tag")?.addEventListener("click", event => {
				event.preventDefault();
				event.stopPropagation();
				identify(item);
			});
			continue;
		}
		// A usable one keeps its dice: clicking its picture uses it, and that identifies it. Its action buttons would name
		// what it does.
		const hide = [".item-buttons", "[data-action='toggleEquipItem']", ".mist-wear"];
		if (!usable) {
			hide.push(".roll-img");
		}
		for (const selector of hide) {
			row.querySelectorAll(selector).forEach(control => control.remove());
		}
	}
}

/** Called during init. The patches wait for setup, when the system has set its document and data classes. */
export function registerMystery() {
	Hooks.once("setup", () => {
		patchName();
		patchText();
		patchUse();
		patchEffects();
	});
	Hooks.on("preUpdateItem", onPreUpdateItem);
	Hooks.on("preCreateItem", onPreCreateItem);
	Hooks.on("daggerheart.preUseAction", onPreUseAction);
	Hooks.on("renderItemSheetV2", (sheet, element) => {
		markUnidentified(element, isUnidentified(sheet.document));
		injectSettings(sheet, element);
		closeSheet(sheet, element);
	});
	Hooks.on("renderActorSheetV2", (sheet, element) => {
		if (sheet.document.system?.metadata?.hasInventory) {
			injectRows(sheet, element);
		}
	});
}
