// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Speed dial slots (docs/spec/codeplug-settings.md, "Speed dial slots"): a key family of the settings area, slot n
// (the digit held on Home) at SPEED_KEY + n. A slot is null (empty) or {type: "group" | "private" | "all", id, name}.
// The radio only reads them; the editor writes a slot's record from the front and keeps a later version's bytes.

import { decodeArea, getValue, setValue, deleteValue, dedupe, putArea, ID_MAX } from "./kv.js";
import { getName, putName } from "./fields.js";

export const SPEED_KEY = 0x1E00;
export const SPEED_SLOTS = 10;	// digits 0-9
export const SPEED_REC_LEN = 20;	// flags, ID (3), name (16)
export const SPEED_NAME_LEN = 16;
export const SPEED_TYPES = ["private", "group", "all"];	// flags bits 0-1: 0 individual, 1 group, 2 all call
const ALL_CALL_ID = 0xFFFFFF;

// A slot's record as the radio reads it, or null when the radio reads it as empty (too short, call type 3, an ID of 0
// or past ID_MAX): nothing is clamped, as for the scalar keys
export function decodeSlot(v) {
	if (!v || v.length < SPEED_REC_LEN) return null;
	const type = SPEED_TYPES[v[0] & 0x03];
	const id = v[1] | (v[2] << 8) | (v[3] << 16);
	if (!type || (type !== "all" && (id === 0 || id > ID_MAX))) return null;
	return { type, id: type === "all" ? ALL_CALL_ID : id, name: getName(v, 4, SPEED_NAME_LEN) };
}

// The record for slot s, written over old (the stored value, kept past the fields this version knows): a record is
// written from the front (codeplug-settings.md 4)
export function encodeSlot(s, old = null) {
	const b = new Uint8Array(Math.max(SPEED_REC_LEN, old ? old.length : 0));
	if (old) b.set(old);
	const id = s.type === "all" ? ALL_CALL_ID : s.id;
	b[0] = SPEED_TYPES.indexOf(s.type);	// the reserved bits written 0
	b[1] = id & 0xFF;
	b[2] = (id >> 8) & 0xFF;
	b[3] = (id >> 16) & 0xFF;
	putName(b, 4, SPEED_NAME_LEN, s.name);
	return b;
}

// Whether s is a slot the radio reads as written: null (empty), or a known type with an ID in range and a short name
export function slotValid(s) {
	if (s == null) return true;
	if (!SPEED_TYPES.includes(s.type) || typeof s.name !== "string" || s.name.length > SPEED_NAME_LEN) return false;
	return s.type === "all" || (Number.isInteger(s.id) && s.id >= 1 && s.id <= ID_MAX);
}

const sameSlot = (a, b) => a === b || (a != null && b != null && a.type === b.type && a.name === b.name &&
	(a.type === "all" || a.id === b.id));

// The ten slots of an area's entries
export function decodeSpeedDial(entries) {
	return Array.from({ length: SPEED_SLOTS }, (_, n) => decodeSlot(getValue(entries, SPEED_KEY + n)));
}

// The slots written onto an image's settings area: only the slots that read differently, so an unedited codeplug
// keeps its bytes; an invalid slot is never written (model.js validate() reports it). False when the area is of a
// newer version and was left alone
export function putSpeedDial(bytes, slots) {
	const area = decodeArea(bytes);
	const todo = [];
	for (let n = 0; n < SPEED_SLOTS; n++) {
		const s = slots[n] ?? null;
		if (slotValid(s) && !sameSlot(decodeSlot(getValue(area.entries, SPEED_KEY + n)), s)) todo.push(n);
	}
	if (!todo.length) return true;
	if (area.state === "newer") return false;
	let entries = dedupe(area.entries);
	for (const n of todo) {
		const s = slots[n] ?? null, key = SPEED_KEY + n;
		entries = s == null ? deleteValue(entries, key) : setValue(entries, key, encodeSlot(s, getValue(entries, key)));
	}
	return putArea(bytes, entries);
}
