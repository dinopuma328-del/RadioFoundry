// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// One key operation slots and quick texts (docs/spec/codeplug-settings.md 3.4 and 3.5): two key families of the
// settings area. Slot n (the digit held on Home) at ONE_KEY_KEY + n is null (empty) or
// {action: "call" | "text", type: "group" | "private" | "all", id, name, text}, text being the quick text's number for
// a text. Quick text n at QUICK_TEXT_KEY + n is null (none) or a string of ISO 8859-1 characters. The radio only reads
// them; the editor writes a slot's record from the front and keeps a later version's bytes.

import { decodeArea, getValue, setValue, deleteValue, dedupe, putArea, ID_MAX } from "./kv.js";
import { getName, putName, nameBytes } from "./fields.js";

export const ONE_KEY_KEY = 0x1E00;
export const ONE_KEY_SLOTS = 10;	// digits 0-9
export const ONE_KEY_REC_LEN = 21;	// flags, ID (3), name (16), quick text
export const ONE_KEY_NAME_LEN = 16;
export const ONE_KEY_TYPES = ["private", "group", "all"];	// flags bits 0-1: 0 individual, 1 group, 2 all call
export const ONE_KEY_ACTIONS = ["call", "text"];	// flags bits 2-3
export const QUICK_TEXT_KEY = 0x1F00;
export const QUICK_TEXTS = 16;
export const QUICK_TEXT_MAX = 64;	// characters, one byte each
const ALL_CALL_ID = 0xFFFFFF;

// A slot's record as the radio reads it, or null when the radio reads it as empty (too short, call type 3, action 2
// or 3, an ID of 0 or past ID_MAX, a text to all call or to a quick text past the last): nothing is clamped
export function decodeSlot(v) {
	if (!v || v.length < ONE_KEY_REC_LEN) return null;
	const type = ONE_KEY_TYPES[v[0] & 0x03];
	const action = ONE_KEY_ACTIONS[(v[0] >> 2) & 0x03];
	const id = v[1] | (v[2] << 8) | (v[3] << 16);
	if (!type || !action || (type !== "all" && (id === 0 || id > ID_MAX))) return null;
	if (action === "text" && (type === "all" || v[20] >= QUICK_TEXTS)) return null;
	return { action, type, id: type === "all" ? ALL_CALL_ID : id, name: getName(v, 4, ONE_KEY_NAME_LEN), text: action === "text" ? v[20] : 0 };
}

// The record for slot s, written over old (the stored value, kept past the fields this version knows): a record is
// written from the front (codeplug-settings.md 4)
export function encodeSlot(s, old = null) {
	const b = new Uint8Array(Math.max(ONE_KEY_REC_LEN, old ? old.length : 0));
	if (old) b.set(old);
	const id = s.type === "all" ? ALL_CALL_ID : s.id;
	b[0] = ONE_KEY_TYPES.indexOf(s.type) | (ONE_KEY_ACTIONS.indexOf(s.action) << 2);	// the reserved bits written 0
	b[1] = id & 0xFF;
	b[2] = (id >> 8) & 0xFF;
	b[3] = (id >> 16) & 0xFF;
	putName(b, 4, ONE_KEY_NAME_LEN, s.name);
	b[20] = s.action === "text" ? s.text : 0;
	return b;
}

// Whether s is a slot the radio reads as written: null (empty), or a known action and type with an ID in range, a
// name of at most 16 bytes as a channel's (fields.js nameBytes) and, for a text, a quick text number for a person or a talkgroup
export function slotValid(s) {
	if (s == null) return true;
	if (!ONE_KEY_ACTIONS.includes(s.action) || !ONE_KEY_TYPES.includes(s.type)) return false;
	if (typeof s.name !== "string" || nameBytes(s.name) > ONE_KEY_NAME_LEN) return false;	// bytes: Chinese takes three
	if (s.action === "text" && (s.type === "all" || !Number.isInteger(s.text) || s.text < 0 || s.text >= QUICK_TEXTS)) return false;
	return s.type === "all" || (Number.isInteger(s.id) && s.id >= 1 && s.id <= ID_MAX);
}

// A quick text's text from its value as the radio reads it: ISO 8859-1, one byte a character, up to the first 0x00 or
// 0xFF, at most QUICK_TEXT_MAX bytes, without the C0 and C1 controls and DEL; null for none. Not getName: a name also
// holds the radio's glyph bytes and UTF-8, a quick text doesn't
export function decodeQuickText(v) {
	if (!v) return null;
	let s = "";
	for (let i = 0; i < Math.min(v.length, QUICK_TEXT_MAX); i++) {
		const c = v[i];
		if (c === 0x00 || c === 0xFF) break;
		if (c < 0x20 || (c >= 0x7F && c <= 0x9F)) continue;
		s += String.fromCharCode(c);
	}
	return s.length ? s : null;
}

// Whether t is a quick text the radio reads as written: null (none), or 1 to QUICK_TEXT_MAX ISO 8859-1 characters
// with no C0 or C1 control or DEL (the radio drops them, as from a received text) and no U+00FF (it ends a text)
export function quickTextValid(t) {
	if (t == null) return true;
	if (typeof t !== "string" || t.length < 1 || t.length > QUICK_TEXT_MAX) return false;
	for (let i = 0; i < t.length; i++) {
		const c = t.charCodeAt(i);
		if (c < 0x20 || (c >= 0x7F && c <= 0x9F) || c >= 0xFF) return false;
	}
	return true;
}

// The bytes of a valid quick text (quickTextValid): each character's ISO 8859-1 byte
export function encodeQuickText(t) {
	return Uint8Array.from(t, (c) => c.charCodeAt(0));
}

const sameSlot = (a, b) => a === b || (a != null && b != null && a.action === b.action && a.type === b.type &&
	a.name === b.name && (a.type === "all" || a.id === b.id) && (a.action !== "text" || a.text === b.text));

// The ten slots and sixteen quick texts of an area's entries
export function decodeOneKey(entries) {
	return Array.from({ length: ONE_KEY_SLOTS }, (_, n) => decodeSlot(getValue(entries, ONE_KEY_KEY + n)));
}

export function decodeQuickTexts(entries) {
	return Array.from({ length: QUICK_TEXTS }, (_, n) => decodeQuickText(getValue(entries, QUICK_TEXT_KEY + n)));
}

// The entries with the slots and the quick texts written: only those that read differently, so an unedited codeplug
// keeps its bytes; an invalid one is never written (model.js validate() reports it). The same entries when nothing
// changed
export function oneKeyEntries(entries, slots, texts) {
	let out = entries;
	for (let n = 0; n < ONE_KEY_SLOTS; n++) {
		const s = slots?.[n] ?? null, key = ONE_KEY_KEY + n;
		if (!slotValid(s) || sameSlot(decodeSlot(getValue(out, key)), s)) continue;
		out = s == null ? deleteValue(out, key) : setValue(out, key, encodeSlot(s, getValue(out, key)));
	}
	for (let n = 0; n < QUICK_TEXTS; n++) {
		const t = texts?.[n] ?? null, key = QUICK_TEXT_KEY + n;
		if (!quickTextValid(t) || decodeQuickText(getValue(out, key)) === t) continue;
		out = t == null ? deleteValue(out, key) : setValue(out, key, encodeQuickText(t));
	}
	return out;
}

// The slots and the quick texts written onto an image's settings area. False when the area is of a newer version and
// was left alone, or when they don't fit (validate() reports both)
export function putOneKey(bytes, slots, texts) {
	const area = decodeArea(bytes);
	const base = area.state === "valid" ? dedupe(area.entries) : [];
	const out = oneKeyEntries(base, slots, texts);
	if (out === base) return true;
	if (area.state === "newer") return false;
	try {
		return putArea(bytes, out);
	} catch (e) {
		if (e instanceof RangeError) return false;
		throw e;
	}
}
