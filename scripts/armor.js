// Armor keeps the slots marked on it (system.armor.current, out of system.armor.max) when it is taken off, given away
// or put in a pack, but Daggerheart shows them only for the armor a character wears. This shows them on every armor.

const format = (key, data) => game.i18n.format(`MIST_EQUIP.${key}`, data);

/** The marked and total slots of an armor, the total after its effects; null for anything else. */
export function armorSlots(item) {
	if (item?.type !== "armor") {
		return null;
	}
	const max = Math.max(0, Number(item.system?.armor?.max) || 0);
	const used = Math.min(max, Math.max(0, Number(item.system?.armor?.current) || 0));
	return { used, max };
}

/** Shields as Daggerheart draws armor slots: a filled one for each marked slot, an outline for each free one. */
export function slotsHTML({ used, max }) {
	const icons = Array.from({ length: max }, (_, index) => `<i class="${index < used ? "fa-solid" : "fa-regular"} fa-shield" inert></i>`).join("");
	return `<span class="mist-armor-pips">${icons}</span><span class="mist-armor-count">${used}/${max}</span>`;
}

/** A tag with the used slots on every armor row of an inventory. */
function injectRows(sheet, element) {
	for (const row of element.querySelectorAll("li.inventory-item[data-item-id]")) {
		row.querySelector(".mist-armor-slots")?.remove();
		const slots = armorSlots(sheet.document.items?.get(row.dataset.itemId));
		const tags = row.querySelector(".item-tags");
		if (!slots?.max || !tags) {
			continue;
		}
		const tooltip = foundry.utils.escapeHTML(format("ArmorSlotsHint", slots));
		tags.insertAdjacentHTML("beforeend", `<div class="tag mist-armor-slots${slots.used ? " marked" : ""}" data-tooltip="${tooltip}">${slotsHTML(slots)}</div>`);
	}
}

/** The used slots under the base score in the header of the armor's own sheet. */
function injectHeader(sheet, element) {
	const slots = armorSlots(sheet.document);
	const header = element.querySelector(".item-sheet-header .item-description");
	if (!slots?.max || !header) {
		return;
	}
	header.querySelector(".mist-armor-slots")?.remove();
	header.insertAdjacentHTML("beforeend", `<h3 class="mist-armor-slots">${format("ArmorSlotsUsed", slots)} ${slotsHTML(slots)}</h3>`);
}

/** Called during init. */
export function registerArmor() {
	Hooks.on("renderActorSheetV2", (sheet, element) => {
		if (sheet.document.system?.metadata?.hasInventory) {
			injectRows(sheet, element);
		}
	});
	Hooks.on("renderItemSheetV2", injectHeader);
}
