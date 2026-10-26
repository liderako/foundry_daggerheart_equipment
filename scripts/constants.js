export const MODULE_ID = "mist-age-equipment";
const FLAGS = `flags.${MODULE_ID}`;
// Loot that can be put on like armor (clothing, a backpack).
export const WEARABLE_PATH = `${FLAGS}.wearable`;
// Loot that holds other items (a backpack, a bag).
export const CONTAINER_PATH = `${FLAGS}.container`;
// The id of the container an item is in, on the same actor.
export const INSIDE_PATH = `${FLAGS}.inside`;
// A container's packed contents: the data of the items inside it, so they leave and arrive with it.
export const CONTENTS_PATH = `${FLAGS}.contents`;
// Item Piles stacks alike items into one; a container never does, or its contents would merge away.
export const STACK_PATH = "flags.item-piles.item.canStack";
// Shared with the Mist Age toolkit's weight: worn loot takes no slots, and capacity bonuses add to this flag.
export const WORN_PATH = "flags.mist-age-weight.worn";
export const BONUS_PATH = "flags.mist-age-weight.bonusSlots";
// Inventory items, in the order their categories are shown.
export const INVENTORY_TYPES = ["weapon", "armor", "consumable", "loot"];
export const CATEGORY_ICONS = {
	weapon: "fa-solid fa-khanda",
	armor: "fa-solid fa-shield-halved",
	consumable: "fa-solid fa-flask",
	loot: "fa-solid fa-gem"
};
export const WEARABLE_TYPES = new Set(["loot"]);
export const CONTAINER_TYPES = new Set(["loot"]);
// Daggerheart sheets that get the layout, keyed by their name in game.system.api.applications.sheets.actors.
export const SHEETS = ["Character", "Adversary", "Companion", "Party"];
// Actors that hold things without wearing them: a party's shared inventory, a chest.
export const STORAGE_TYPES = new Set(["party"]);
