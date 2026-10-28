# The Mist Age - Equipment

A Foundry VTT module for the Daggerheart system: the inventory laid out the way things are carried. Instead of four lists (weapons, armor, consumables, loot) it shows what is worn, what is at hand, and containers (a backpack, a bag) with their contents by category, nested inside one another.

## Requirements

- Foundry VTT 13–14, the Daggerheart system.
- **The Mist Age - Toolkit** is recommended: weight in slots and carrying capacity. Without it the layout works, but slots are not counted.

## Installation

In Foundry, install the module from its manifest URL:

```
https://github.com/liderako/foundry_daggerheart_equipment/releases/latest/download/module.json
```

Or put the module folder at `Data/modules/mist-age-equipment`. Then enable **The Mist Age - Equipment** in your world.

## Inventory

On the inventory tab of characters, adversaries and companions, from top to bottom:

- **Worn**: equipped weapons and armor, worn clothing and backpacks.
- **At hand**: everything that is not worn and not in a container, by category. The buttons that create items are here too.
- **Containers**: a section for every worn container and every container at hand, with its contents by category and how many slots they take. A container inside a container (a pouch in a backpack) is drawn inside its container's section.

**Moving things is drag and drop.** Drag an item onto a section:

- onto a container: the item goes inside (if it was worn or equipped, it is taken off);
- onto At hand: it is taken out of its container;
- onto Worn: clothing and backpacks are put on; weapons and armor are equipped with their own buttons, as usual.

An item dragged from another sheet or a compendium lands where it was dropped. The section an item would land in is highlighted. A container cannot go inside itself or into anything it holds.

Search and filter on the character inventory work as before.

## A container takes its contents along

A backpack behaves like a real container:

- **Give the backpack** to another character (drag it onto their sheet): it moves whole, with everything inside, nested pouches included. The items disappear from the old owner and appear inside the backpack on the new one (at hand and not worn, unless it is dropped straight onto Worn or into a container). A backpack does not stack with an identical one.
- **Drop the backpack** into an Item Piles pile: the pile holds one backpack with the contents packed inside it. Whoever picks it up gets it with everything in it.
- **Drag the backpack** into the world's item list or a compendium: its contents are kept inside it.
- **Delete the backpack**: everything inside is deleted with it.

**The backpack's sheet shows what is in it:** Contents at the top of the description tab, with the items, their quantities and nested containers. On a character this is what is in the backpack now; in a pile, the world or a compendium it is what is packed.

How it works: on a character, the items in a backpack are ordinary items (they can be used, and they count toward slots), and the backpack keeps a packed copy of them (`flags.mist-age-equipment.contents`) that is refreshed on every change. When a backpack arrives in an inventory, the items from the copy are created inside it; when it leaves, the items inside are deleted. Item Piles piles keep backpacks packed and never stack containers (`flags.item-piles.item.canStack = "no"`).

## Durability

Weapons, armor and loot can have durability, switched on per item in the Durability block on the item's **Settings** tab:

- **The GM** ticks Has durability (it starts full, 6 of 6 by default) and sets the **Maximum**. Lowering the maximum below the durability left cuts it down; raising the maximum does not repair it.
- **The GM and the item's owner** lower and raise durability with the − and + buttons, from 0 to the maximum. Other players see it, but their buttons are off.
- **0 is Broken:** a red tag on the item, and its name is red in the inventory. The item works as before; the GM decides what broken means. The + button raises it back.
- Unticking the box hides durability but keeps the numbers: tick it again and it is as it was.

**Quick, without the settings:** the GM and the item's owner change durability right on the hammer tag, in an inventory row or in the item sheet header. Click: −1, right click: +1.

Durability shows in the item's row in any inventory (a hammer and 4/6, or Broken), in the item sheet header and in a container's contents. It is stored on the item (`flags.mist-age-equipment.durability`: `enabled`, `value`, `max`), so it travels with it: to another character, into a pile, into a backpack.

## Armor slots on every armor

Daggerheart shows marked armor slots only on worn armor, although it keeps them on the armor itself (`system.armor.current` out of `system.armor.max`). The module shows them on every armor:

- in the armor's row in any inventory (character, adversary, companion, party): a tag of shields, filled for each marked slot and outlined for each free one, with a 2/4 count; the tooltip explains it;
- in the header of the armor's own sheet: Marked slots: 2/4;
- in a backpack's contents when the armor is inside it (in a pile and in the world too).

## Clothing, backpacks, containers

On the **Settings** tab of loot, the GM sees two checkboxes:

- **Wearable**: put on like armor. The item's row gets a shirt button to put it on and take it off. Worn items take no slots.
- **Container**: holds other items and gets its own section.

A backpack is usually both.

**Capacity bonuses count only while worn.** An effect on an item that adds capacity (`flags.mist-age-weight.bonusSlots`, Add) works on Wearable loot only while the item is worn: a backpack carried in hand or at the bottom of a bag adds no slots.

## Capacity

Capacity is one shared pool, as in the Toolkit: Strength plus the bonuses of what is worn (a backpack, clothing). Containers only sort items and show how many slots each one holds.

## Data

- Wearable: `flags.mist-age-equipment.wearable`;
- Container: `flags.mist-age-equipment.container`;
- the container an item is in: `flags.mist-age-equipment.inside` (the container's id on the same actor);
- Worn: `flags.mist-age-weight.worn`, shared with the Toolkit's weight.

## For developers

- `scripts/layout.js`: the layout rules, without Foundry.
- `scripts/inventory.js`: the tab template, its context, drag and drop.
- `scripts/wear.js`: the item checkboxes, the wear button, capacity bonuses only while worn.
- `scripts/durability.js`: durability rules, the block in the item settings, the tags in inventories, sheet headers and container contents, stepping by clicks.
- `scripts/armor.js`: marked armor slots in rows, on the armor sheet and in container contents.
- `scripts/packing.js`: the packed contents of containers: moving, unpacking, deleting, the list on the sheet.

## Releases

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`: it sets that version and the manifest and download URLs in `module.json`, builds `module.zip`, and attaches both to the GitHub release.

## Tests

The tests run on Node 20+ without starting Foundry. Templates are rendered with Handlebars and the DOM is built with htmlparser2 from the installed Foundry; its path is the FOUNDRY_APP variable (by default `C:/Program Files/Foundry Virtual Tabletop/resources/app/`).

```
node tests/equipment.test.mjs
node tests/packing.test.mjs
node tests/containers.test.mjs
node tests/armor.test.mjs
node tests/durability.test.mjs
```

`tests/dom.mjs` is a small DOM for the tests, on htmlparser2 from the installed Foundry.

`containers.test.mjs` runs 23 cases with a backpack holding rope and a pouch with a ring, and checks that nothing is lost or doubled:

- to an Item Piles pile and back: through Item Piles, and by dragging from the pile onto a sheet (onto Worn);
- to another character's sheet and back, and handed over through Item Piles;
- to the party inventory, also next to an identical backpack, and back; through Item Piles too;
- to the world's item list and back;
- the body of a fallen adversary, for both a linked actor and an unlinked token; the body turned back into an adversary;
- parts of a container: the pouch from the backpack to another character, an item from the backpack into a pile and back into the backpack, an item from the backpack through Item Piles, moving between containers of one character, taking out to At hand, deleting an item in the nested pouch;
- a backpack from another sheet straight into a sack on this sheet;
- an empty container, a stack of two backpacks, a copy of the backpack on the same character;
- a change made right before it leaves, deleting the backpack;
- no permission on the target: nothing moves;
- backpacks filled before packing existed get their packed copy when the GM loads;
- unpacking fails: the items stay packed in the backpack, show on its sheet, and come out for whoever can take them.
