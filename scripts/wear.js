import { BONUS_PATH, CONTAINER_PATH, CONTAINER_TYPES, STORAGE_TYPES, WEARABLE_PATH, WEARABLE_TYPES, WORN_PATH } from "./constants.js";
import { isWearable, isWorn } from "./layout.js";

const localize = key => game.i18n.localize(`MIST_EQUIP.${key}`);

/** A capacity bonus carried over from wearable loot to the actor that holds it, while the loot is not worn. */
function isUnwornCapacityBonus(effect) {
	const item = effect.parent;
	if (!effect.transfer || item?.documentName !== "Item" || !item.actor || !isWearable(item) || isWorn(item)) {
		return false;
	}
	return (effect.system?.changes ?? effect.changes ?? []).some(change => change.key === BONUS_PATH);
}

/** Suppresses capacity bonuses of wearable loot that is carried but not worn: a backpack helps only on the back. */
function suppressUnwornCapacityBonuses() {
	const cls = CONFIG.ActiveEffect.documentClass;
	let owner = cls.prototype;
	while (owner && !Object.getOwnPropertyDescriptor(owner, "isSuppressed")) {
		owner = Object.getPrototypeOf(owner);
	}
	const original = owner && Object.getOwnPropertyDescriptor(owner, "isSuppressed").get;
	Object.defineProperty(cls.prototype, "isSuppressed", {
		configurable: true,
		get() {
			return isUnwornCapacityBonus(this) || (original ? original.call(this) : false);
		}
	});
}

/** The GM's checkboxes on the settings tab of loot: can be worn, holds other items. */
function injectItemSettings(sheet, element) {
	const item = sheet.document;
	const fieldset = element.querySelector("section.tab[data-tab='settings'] fieldset");
	if (!game.user.isGM || !fieldset || fieldset.querySelector(".mist-equip-field")) {
		return;
	}
	const disabled = sheet.isEditable ? "" : "disabled";
	const checkbox = (path, key) => {
		const checked = foundry.utils.getProperty(item, path) === true ? "checked" : "";
		const hint = foundry.utils.escapeHTML(localize(`${key}Hint`));
		return `
			<span class="mist-equip-field" data-tooltip="${hint}">${localize(key)}</span>
			<input type="checkbox" name="${path}" ${checked} ${disabled} />`;
	};
	let html = "";
	if (WEARABLE_TYPES.has(item.type)) {
		html += checkbox(WEARABLE_PATH, "Wearable");
	}
	if (CONTAINER_TYPES.has(item.type)) {
		html += checkbox(CONTAINER_PATH, "Container");
	}
	fieldset.insertAdjacentHTML("beforeend", html);
}

/** A wear button on rows of wearable loot, where the armor's equip button sits; it puts the item on or takes it off. */
function injectWearButtons(sheet, element) {
	for (const row of element.querySelectorAll("li.inventory-item[data-item-id]")) {
		row.querySelector(".mist-wear")?.remove();
		const item = sheet.document.items.get(row.dataset.itemId);
		const controls = row.querySelector(".inventory-item-header .controls") ?? row.querySelector(".controls");
		if (!item || !controls || !isWearable(item)) {
			continue;
		}
		const worn = isWorn(item);
		const tooltip = localize(worn ? "TakeOff" : "PutOn");
		const button = document.createElement("a");
		button.className = `mist-wear${worn ? "" : " unequipped"}`;
		button.dataset.tooltip = tooltip;
		button.setAttribute("aria-label", tooltip);
		button.innerHTML = `<i class="fa-solid fa-fw fa-shirt" inert></i>`;
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			item.update({ [WORN_PATH]: !worn });
		});
		const suppressed = controls.querySelector(":scope > .suppressed");
		if (suppressed) {
			suppressed.after(button);
		} else {
			controls.prepend(button);
		}
	}
}

/** Called during init. */
export function registerWear() {
	// The system sets its ActiveEffect class during its own init.
	Hooks.once("setup", suppressUnwornCapacityBonuses);
	Hooks.on("renderItemSheetV2", injectItemSettings);
	Hooks.on("renderActorSheetV2", (sheet, element) => {
		if (sheet.document.system?.metadata?.hasInventory && !STORAGE_TYPES.has(sheet.document.type) && sheet.isEditable) {
			injectWearButtons(sheet, element);
		}
	});
}
