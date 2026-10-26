import { registerArmor } from "./armor.js";
import { registerDurability } from "./durability.js";
import { registerInventory } from "./inventory.js";
import { registerPacking } from "./packing.js";
import { registerWear } from "./wear.js";

Hooks.once("init", () => {
	registerWear();
	registerInventory();
	registerPacking();
	registerArmor();
	registerDurability();
});
