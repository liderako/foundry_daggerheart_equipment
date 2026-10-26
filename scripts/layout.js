import { CATEGORY_ICONS, CONTAINER_PATH, CONTAINER_TYPES, INSIDE_PATH, INVENTORY_TYPES, WEARABLE_PATH, WEARABLE_TYPES, WORN_PATH } from "./constants.js";

// Pure rules of the layout, working on item documents or plain item data, so they run the same in the sheet and tests.

function prop(object, path) {
	return path.split(".").reduce((value, key) => value?.[key], object);
}

export function isWearable(item) {
	return WEARABLE_TYPES.has(item.type) && prop(item, WEARABLE_PATH) === true;
}

export function isContainer(item) {
	return CONTAINER_TYPES.has(item.type) && prop(item, CONTAINER_PATH) === true;
}

/** Equipped weapons and armor, and worn loot, are on the body. */
export function isWorn(item) {
	if (item.type === "weapon" || item.type === "armor") {
		return item.system?.equipped === true;
	}
	return WEARABLE_TYPES.has(item.type) && prop(item, WORN_PATH) === true;
}

const byType = (a, b) => INVENTORY_TYPES.indexOf(a.type) - INVENTORY_TYPES.indexOf(b.type) || (a.sort ?? 0) - (b.sort ?? 0);

/** Items grouped by type, in the order weapons, armor, consumables, loot; empty groups are left out. */
export function categorize(items) {
	return INVENTORY_TYPES
		.map(type => ({ type, icon: CATEGORY_ICONS[type], items: items.filter(item => item.type === type).sort(byType) }))
		.filter(category => category.items.length);
}

/**
 * Where each inventory item is: worn on the body, at hand, or in a container of the same actor. An item points at its
 * container by id; a container that is gone, or a loop of containers inside each other, leaves the item at hand. Worn
 * items are on the body wherever they were put before.
 * @returns {Map<string, string|null>} item id → container id, or null for at hand; worn items are left out.
 */
export function locate(items, { wearing = true } = {}) {
	const inventory = items.filter(item => INVENTORY_TYPES.includes(item.type));
	const containers = new Map(inventory.filter(isContainer).map(item => [item.id, item]));
	const parentOf = item => {
		const id = prop(item, INSIDE_PATH);
		const parent = id && id !== item.id ? containers.get(id) : null;
		return parent && !(wearing && isWorn(item)) ? parent : null;
	};
	const places = new Map();
	for (const item of inventory) {
		if (wearing && isWorn(item)) {
			continue;
		}
		// Walk up to the top: a loop means the item is not really inside anything.
		const seen = new Set([item.id]);
		let parent = parentOf(item);
		let looped = false;
		for (let up = parent; up; up = parentOf(up)) {
			if (seen.has(up.id)) {
				looped = true;
				break;
			}
			seen.add(up.id);
		}
		places.set(item.id, looped ? null : parent?.id ?? null);
	}
	return places;
}

/**
 * The inventory as it is carried: worn items, items at hand by category, and a section for every container that is
 * worn or at hand, holding its items by category and the containers inside it. A container is listed where it is,
 * like any item, and also gets its own section. The load of a section is the slots of everything inside it.
 * @param {object[]} items          The actor's items.
 * @param {object} [options]
 * @param {Function} [options.load] The slots an item takes, as the toolkit counts them; 0 without the toolkit.
 * @param {boolean} [options.wearing] False for storage (a party, a chest): nothing is worn, all is at hand or inside.
 */
export function buildLayout(items, { load = () => 0, wearing = true } = {}) {
	const inventory = items.filter(item => INVENTORY_TYPES.includes(item.type));
	const places = locate(inventory, { wearing });
	const inside = id => inventory.filter(item => places.get(item.id) === id);
	const round = value => Math.round(value * 100) / 100;
	const section = container => {
		const contents = inside(container.id);
		const nested = contents.filter(isContainer).map(section);
		const slots = contents.reduce((sum, item) => sum + load(item), 0) + nested.reduce((sum, child) => sum + child.load, 0);
		return {
			id: container.id,
			item: container,
			name: container.name,
			img: container.img,
			worn: wearing && isWorn(container),
			load: round(slots),
			count: contents.length,
			categories: categorize(contents),
			containers: nested
		};
	};
	const worn = wearing ? inventory.filter(isWorn).sort(byType) : [];
	const loose = inside(null);
	return {
		worn,
		loose: categorize(loose),
		looseCount: loose.length,
		containers: [...worn, ...loose].filter(isContainer).map(section)
	};
}

/** The containers an item can be put in: not itself and, for a container, none of those inside it. */
export function canHold(items, container, item) {
	if (!isContainer(container) || container.id === item.id) {
		return false;
	}
	const places = locate(items);
	for (let id = places.get(container.id); id; id = places.get(id)) {
		if (id === item.id) {
			return false;
		}
	}
	return true;
}
