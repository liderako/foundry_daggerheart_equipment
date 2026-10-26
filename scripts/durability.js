import { MODULE_ID } from "./constants.js";

// Durability of weapons, armor and loot, switched on per item by the GM, who sets its maximum. The GM and the item's
// owner lower it (and raise it back) on the item's settings tab; at 0 the item is marked broken and works as before.
export const DURABILITY_PATH = `flags.${MODULE_ID}.durability`;
export const DURABILITY_TYPES = new Set(["weapon", "armor", "loot"]);
export const DEFAULT_MAX = 6;

const localize = key => game.i18n.localize(`MIST_EQUIP.${key}`);
const format = (key, data) => game.i18n.format(`MIST_EQUIP.${key}`, data);
const whole = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.round(Number(value)) : fallback);

/** An item's durability when it has one: value between 0 and the maximum; null when it is off or not for this item. */
export function getDurability(item) {
	if (!DURABILITY_TYPES.has(item?.type)) {
		return null;
	}
	const data = foundry.utils.getProperty(item, DURABILITY_PATH);
	if (!data?.enabled) {
		return null;
	}
	const max = Math.max(1, whole(data.max, DEFAULT_MAX));
	const value = Math.min(max, Math.max(0, whole(data.value, max)));
	return { value, max, broken: value === 0 };
}

/** Switching durability on starts it full, at the maximum it had or the default; off keeps the numbers for later. */
export function enableChanges(item, enabled) {
	if (!enabled) {
		return { [`${DURABILITY_PATH}.enabled`]: false };
	}
	const data = foundry.utils.getProperty(item, DURABILITY_PATH) ?? {};
	const max = Math.max(1, whole(data.max, DEFAULT_MAX));
	return { [`${DURABILITY_PATH}.enabled`]: true, [`${DURABILITY_PATH}.max`]: max, [`${DURABILITY_PATH}.value`]: Math.min(max, Math.max(0, whole(data.value, max))) };
}

/** A new maximum, at least 1; the durability left is cut down to it. */
export function maxChanges(item, max) {
	const current = getDurability(item);
	const next = Math.max(1, whole(max, current?.max ?? DEFAULT_MAX));
	return { [`${DURABILITY_PATH}.max`]: next, [`${DURABILITY_PATH}.value`]: Math.min(next, current?.value ?? next) };
}

/** Durability lowered or raised by a step, between 0 and the maximum; null when nothing would change. */
export function stepChanges(item, delta) {
	const current = getDurability(item);
	if (!current) {
		return null;
	}
	const value = Math.min(current.max, Math.max(0, current.value + delta));
	return value === current.value ? null : { [`${DURABILITY_PATH}.value`]: value };
}

/** The durability tag: a hammer and value/max, or broken. */
export function durabilityTag(durability) {
	const tooltip = foundry.utils.escapeHTML(format(durability.broken ? "BrokenHint" : "DurabilityHint", durability));
	const text = durability.broken
		? `<i class="fa-solid fa-heart-crack" inert></i> ${localize("Broken")}`
		: `<i class="fa-solid fa-hammer" inert></i> ${durability.value}/${durability.max}`;
	return `<div class="tag mist-durability${durability.broken ? " broken" : ""}" data-tooltip="${tooltip}">${text}</div>`;
}

/** The tag on every row of an item with durability, in any inventory. */
function injectRows(sheet, element) {
	for (const row of element.querySelectorAll("li.inventory-item[data-item-id]")) {
		row.querySelector(".mist-durability")?.remove();
		row.classList?.remove("mist-broken");
		const durability = getDurability(sheet.document.items?.get(row.dataset.itemId));
		const tags = row.querySelector(".item-tags");
		if (!durability || !tags) {
			continue;
		}
		tags.insertAdjacentHTML("beforeend", durabilityTag(durability));
		if (durability.broken) {
			row.classList?.add("mist-broken");
		}
	}
}

/**
 * The durability block on the item's settings tab. The GM switches it on and sets the maximum; the GM and the owner
 * step it down and up. The inputs have no names: they update the item themselves, apart from the sheet's form.
 */
function injectSettings(sheet, element) {
	const item = sheet.document;
	const tab = element.querySelector("section.tab[data-tab='settings']");
	if (!DURABILITY_TYPES.has(item.type) || !tab) {
		return;
	}
	tab.querySelector(".mist-durability-settings")?.remove();
	const isGM = game.user.isGM;
	const durability = getDurability(item);
	if (!durability && !isGM) {
		return;
	}
	const editable = sheet.isEditable;
	const disabled = editable ? "" : "disabled";
	let html = `<fieldset class="mist-durability-settings"><legend><i class="fa-solid fa-hammer" inert></i> ${localize("Durability")}</legend>`;
	if (isGM) {
		html += `
			<label class="mist-durability-row" data-tooltip="${foundry.utils.escapeHTML(localize("DurabilityEnableHint"))}">
				<input type="checkbox" data-durability="enabled" ${durability ? "checked" : ""} ${disabled}> ${localize("DurabilityEnable")}
			</label>`;
	}
	if (durability) {
		if (isGM) {
			html += `
				<label class="mist-durability-row">${localize("DurabilityMax")}
					<input type="number" data-durability="max" value="${durability.max}" min="1" step="1" ${disabled}>
				</label>`;
		}
		html += `
			<div class="mist-durability-row mist-durability-value">
				<button type="button" data-durability="decrease" data-tooltip="${localize("DurabilityDecrease")}" ${editable && durability.value > 0 ? "" : "disabled"}><i class="fa-solid fa-minus" inert></i></button>
				<span class="value">${durability.value} / ${durability.max}</span>
				<button type="button" data-durability="increase" data-tooltip="${localize("DurabilityIncrease")}" ${editable && durability.value < durability.max ? "" : "disabled"}><i class="fa-solid fa-plus" inert></i></button>
				${durability.broken ? `<span class="mist-durability broken"><i class="fa-solid fa-heart-crack" inert></i> ${localize("Broken")}</span>` : ""}
			</div>`;
	}
	html += "</fieldset>";
	tab.insertAdjacentHTML("beforeend", html);
	const block = tab.querySelector(".mist-durability-settings");
	block.querySelector("[data-durability='enabled']")?.addEventListener("change", event => item.update(enableChanges(item, event.target.checked)));
	block.querySelector("[data-durability='max']")?.addEventListener("change", event => item.update(maxChanges(item, event.target.value)));
	for (const [action, delta] of [["decrease", -1], ["increase", 1]]) {
		block.querySelector(`[data-durability='${action}']`)?.addEventListener("click", event => {
			event.preventDefault();
			const changes = stepChanges(item, delta);
			if (changes) {
				item.update(changes);
			}
		});
	}
}

/** The durability in the header of the item's own sheet. */
function injectHeader(sheet, element) {
	const header = element.querySelector(".item-sheet-header .item-description");
	header?.querySelector(".mist-durability-line")?.remove();
	const durability = getDurability(sheet.document);
	if (!header || !durability) {
		return;
	}
	header.insertAdjacentHTML("beforeend", `<h3 class="mist-durability-line">${durabilityTag(durability)}</h3>`);
}

/** Called during init. */
export function registerDurability() {
	Hooks.on("renderActorSheetV2", (sheet, element) => {
		if (sheet.document.system?.metadata?.hasInventory) {
			injectRows(sheet, element);
		}
	});
	Hooks.on("renderItemSheetV2", (sheet, element) => {
		injectSettings(sheet, element);
		injectHeader(sheet, element);
	});
}
