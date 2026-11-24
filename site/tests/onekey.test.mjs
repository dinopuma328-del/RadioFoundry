// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// One key operation slots and quick texts in the Codeplug Editor (docs/spec/codeplug-settings.md 3.4 and 3.5):
// static/js/codeplug/onekey.js, the general settings' oneKey and quickTexts (records.js, model.js), the area's room
// (channelmodes.js) and a write to a radio (kv.js areaForWrite). Run with node --test site/tests/ (site/tests/run.sh).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CodeplugImage } from "../static/js/codeplug/image.js";
import { KV_ADDR, KV_SIZE, ID_MAX, decodeArea, encodeArea, getValue, areaForWrite } from "../static/js/codeplug/kv.js";
import {
	ONE_KEY_KEY, ONE_KEY_SLOTS, ONE_KEY_REC_LEN, QUICK_TEXT_KEY, QUICK_TEXTS, QUICK_TEXT_MAX, decodeSlot, encodeSlot,
	slotValid, decodeOneKey, decodeQuickTexts, decodeQuickText, quickTextValid, putOneKey,
} from "../static/js/codeplug/onekey.js";
import { decode, encode, empty, validate } from "../static/js/codeplug/model.js";

const area = (img) => img.bytes.subarray(KV_ADDR, KV_ADDR + KV_SIZE);
const e = (key, ...bytes) => ({ key, value: Uint8Array.from(bytes) });
const pad = (s) => [...s].map((c) => c.charCodeAt(0)).concat(Array(16 - s.length).fill(0xFF));
const latin = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const call = (type, id, name = "") => ({ action: "call", type, id, name, text: 0 });
const text = (type, id, n, name = "") => ({ action: "text", type, id, name, text: n });
const none = (n) => Array(n).fill(null);

function withArea(entries) {
	const img = CodeplugImage.blank();
	area(img).set(encodeArea(entries));
	return img;
}

function edited(img, oneKey, quickTexts) {
	const m = decode(img);
	m.general = { ...m.general, ...(oneKey ? { oneKey } : {}), ...(quickTexts ? { quickTexts } : {}) };
	return m;
}

test("one key: the record's bytes", () => {
	assert.deepEqual([...encodeSlot(call("group", 4000, "Unlink"))], [1, 0xA0, 0x0F, 0x00, ...pad("Unlink"), 0]);
	assert.deepEqual([...encodeSlot(call("private", 9991234))], [0, 0x42, 0x74, 0x98, ...Array(16).fill(0xFF), 0]);
	// a text: action 1 in bits 2-3, the quick text's number at 20
	assert.deepEqual([...encodeSlot(text("group", 91, 3, "World"))], [5, 91, 0, 0, ...pad("World"), 3]);
	assert.deepEqual([...encodeSlot(text("private", 9991234, 15))].slice(0, 4), [4, 0x42, 0x74, 0x98]);
	// all call: the ID is 0xFFFFFF whatever the model holds
	assert.deepEqual([...encodeSlot(call("all", 5, "All"))].slice(0, 4), [2, 0xFF, 0xFF, 0xFF]);
	assert.equal(encodeSlot(call("group", 1)).length, ONE_KEY_REC_LEN);
});

test("one key: a record round-trips; a value the radio reads as empty is null", () => {
	for (const s of [call("group", 91, "World"), call("private", ID_MAX, "ABCDEFGHIJKLMNOP"), call("all", 0xFFFFFF),
		text("group", 91, 0), text("private", 9991234, QUICK_TEXTS - 1, "Bob")]) assert.deepEqual(decodeSlot(encodeSlot(s)), s);
	const ok = encodeSlot(call("group", 91));
	const with0 = (b0, b20 = 0) => Uint8Array.from([b0, ...ok.subarray(1, 20), b20]);
	assert.equal(decodeSlot(null), null);
	assert.equal(decodeSlot(ok.subarray(0, ONE_KEY_REC_LEN - 1)), null);	// too short: the 20 bytes of the first draft too
	assert.equal(decodeSlot(with0(3)), null);	// call type 3
	assert.equal(decodeSlot(with0(1 | (2 << 2))), null);	// actions 2 and 3
	assert.equal(decodeSlot(with0(1 | (3 << 2))), null);
	assert.equal(decodeSlot(with0(2 | (1 << 2))), null);	// a text to all call
	assert.equal(decodeSlot(with0(1 | (1 << 2), QUICK_TEXTS)), null);	// no such quick text
	assert.equal(decodeSlot(Uint8Array.from([1, 0, 0, 0, ...ok.subarray(4)])), null);	// ID 0
	const over = ID_MAX + 1;
	assert.equal(decodeSlot(Uint8Array.from([1, over & 0xFF, (over >> 8) & 0xFF, over >> 16, ...ok.subarray(4)])), null);
	// the reserved bits and a later version's bytes are ignored; a call's quick text byte too
	assert.deepEqual(decodeSlot(Uint8Array.from([0xF1, ...ok.subarray(1, 20), 9, 7, 7])), call("group", 91));
});

test("one key: which slots are valid", () => {
	assert.ok(slotValid(null));
	assert.ok(slotValid(call("group", 4000, "Unlink")));
	assert.ok(slotValid(call("all", 0)));
	assert.ok(slotValid(text("private", 1, 0)));
	assert.ok(!slotValid(call("group", 0)));
	assert.ok(!slotValid(call("private", ID_MAX + 1)));
	assert.ok(!slotValid(call("group", 91, "x".repeat(17))));
	assert.ok(slotValid(call("group", 91, "中文名字")));	// 12 bytes as UTF-8, as a channel name
	assert.ok(!slotValid(call("group", 91, "中文名字中文")));	// 18 bytes
	assert.ok(!slotValid({ ...call("group", 91), type: "other" }));
	assert.ok(!slotValid({ ...call("group", 91), action: "dtmf" }));
	assert.ok(!slotValid(text("all", 0, 0)));
	assert.ok(!slotValid(text("group", 91, QUICK_TEXTS)));
	assert.ok(!slotValid(text("group", 91, -1)));
});

test("quick texts: the bytes, what reads as none, what is valid", () => {
	assert.equal(decodeQuickText(latin("Going QRT now")), "Going QRT now");
	assert.equal(decodeQuickText(Uint8Array.from([0x4F, 0x4B, 0xFF, 0xFF])), "OK");
	assert.equal(decodeQuickText(Uint8Array.from([0x43, 0x69, 0x61, 0x6F, 0x20, 0xE0, 0x00, 0x78])), "Ciao à");
	assert.equal(decodeQuickText(Uint8Array.from([0x00, 0x41])), null);
	assert.equal(decodeQuickText(new Uint8Array(0)), null);
	assert.equal(decodeQuickText(null), null);
	assert.equal(decodeQuickText(latin("a".repeat(QUICK_TEXT_MAX + 5))).length, QUICK_TEXT_MAX);	// read from the front
	assert.ok(quickTextValid(null));
	assert.ok(quickTextValid("Ciao à tutti"));
	assert.ok(quickTextValid("a".repeat(QUICK_TEXT_MAX)));
	assert.ok(!quickTextValid(""));
	assert.ok(!quickTextValid("a".repeat(QUICK_TEXT_MAX + 1)));
	assert.ok(!quickTextValid("€ 5"));	// outside ISO 8859-1
	assert.ok(!quickTextValid("ÿ"));	// U+00FF ends a text
	assert.ok(!quickTextValid("a\u0000b"));
	assert.ok(!quickTextValid("line\none"));	// C0 control
	assert.ok(!quickTextValid("a\u0082b"));	// C1 control: the radio draws its own glyphs there
	assert.ok(!quickTextValid("a\u007Fb"));	// DEL
	// read as the radio reads it: the controls dropped
	assert.equal(decodeQuickText(Uint8Array.from([0x41, 0x07, 0x42, 0x7F, 0x82, 0x43, 0xA0])), "ABC\u00A0");
	assert.equal(decodeQuickText(Uint8Array.from([0x01, 0x85])), null);
	// one byte a character: no UTF-8 as in a name (0xE4 0xB8 0xAD would be one Chinese character there)
	assert.equal(decodeQuickText(Uint8Array.from([0xE4, 0xB8, 0xAD])), "\u00E4\u00B8\u00AD");
});

test("one key: decoded from the area, ten slots and sixteen texts, the rest of the families ignored", () => {
	const img = withArea([e(0x0001, 1, 0, 0, 0), { key: ONE_KEY_KEY + 4, value: encodeSlot(call("group", 4000, "Unlink")) },
		{ key: ONE_KEY_KEY + 12, value: encodeSlot(call("group", 1)) }, { key: QUICK_TEXT_KEY + 1, value: latin("QRV") },
		{ key: QUICK_TEXT_KEY + 20, value: latin("not read") }]);
	const entries = decodeArea(img.bytes).entries;
	const slots = decodeOneKey(entries), texts = decodeQuickTexts(entries);
	assert.equal(slots.length, ONE_KEY_SLOTS);
	assert.equal(texts.length, QUICK_TEXTS);
	assert.deepEqual(slots[4], call("group", 4000, "Unlink"));
	assert.ok(slots.every((s, n) => n === 4 || s === null));
	assert.deepEqual(texts, [null, "QRV", ...none(QUICK_TEXTS - 2)]);
	const g = decode(img).general;
	assert.deepEqual(g.oneKey, slots);
	assert.deepEqual(g.quickTexts, texts);
	assert.deepEqual(empty().general.oneKey, none(ONE_KEY_SLOTS));
	assert.deepEqual(empty().general.quickTexts, none(QUICK_TEXTS));
});

test("one key: an unedited codeplug keeps its bytes", () => {
	const img = withArea([e(0x0001, 1, 2, 0, 0), { key: ONE_KEY_KEY + 1, value: Uint8Array.from([...encodeSlot(text("group", 9, 2)), 0xAA]) },
		{ key: QUICK_TEXT_KEY + 2, value: Uint8Array.from([0x51, 0x52, 0x56, 0xFF]) }]);
	const before = img.bytes.slice();
	assert.deepEqual(encode(decode(img)).bytes, before);
});

test("one key: an edit writes only what it changed, slots from the front, and keeps other keys", () => {
	const later = Uint8Array.from([...encodeSlot(call("group", 9, "Local")), 0xAA, 0xBB]);
	const img = withArea([e(0x0001, 1, 2, 0, 0), { key: ONE_KEY_KEY + 1, value: later }, { key: QUICK_TEXT_KEY + 0, value: latin("Old") }]);
	const m = decode(img);
	const slots = [...m.general.oneKey], texts = [...m.general.quickTexts];
	slots[1] = text("group", 3100, 5, "USA");
	slots[4] = call("group", 4000, "Unlink");
	texts[5] = "Net starts in 5 minutes";
	const entries = decodeArea(encode(edited(img, slots, texts)).bytes).entries;
	assert.deepEqual([...getValue(entries, 0x0001)], [1, 2, 0, 0]);
	const one = getValue(entries, ONE_KEY_KEY + 1);
	assert.equal(one.length, ONE_KEY_REC_LEN + 2);	// a later version's bytes kept after the fields set
	assert.deepEqual([...one.subarray(ONE_KEY_REC_LEN)], [0xAA, 0xBB]);
	assert.deepEqual(decodeSlot(one), text("group", 3100, 5, "USA"));
	assert.deepEqual(decodeSlot(getValue(entries, ONE_KEY_KEY + 4)), call("group", 4000, "Unlink"));
	assert.deepEqual([...getValue(entries, QUICK_TEXT_KEY + 5)], [...latin("Net starts in 5 minutes")]);	// no terminator
	assert.deepEqual([...getValue(entries, QUICK_TEXT_KEY + 0)], [...latin("Old")]);
	// cleared: the key goes
	const m2 = decode(encode(edited(img, slots, texts)));
	const s2 = [...m2.general.oneKey], t2 = [...m2.general.quickTexts];
	s2[1] = null;
	t2[0] = null;
	const e2 = decodeArea(encode(edited(encode(m2), s2, t2)).bytes).entries;
	assert.equal(getValue(e2, ONE_KEY_KEY + 1), null);
	assert.equal(getValue(e2, QUICK_TEXT_KEY + 0), null);
	assert.ok(getValue(e2, QUICK_TEXT_KEY + 5));
});

test("one key: an invalid slot or text is reported and never written; a text slot's empty quick text is a warning", () => {
	const m = empty();
	const slots = none(ONE_KEY_SLOTS), texts = none(QUICK_TEXTS);
	slots[3] = call("group", 0);
	slots[5] = call("group", 91, "x".repeat(17));
	slots[6] = text("all", 0, 0);
	slots[7] = { ...text("group", 91, 0), text: 99 };
	slots[8] = text("group", 91, 2);	// quick text 3 is empty
	texts[4] = "€ 5";
	m.general = { ...m.general, oneKey: slots, quickTexts: texts };
	const p = validate(m).filter((x) => x.field === "oneKey" || x.field === "quickTexts");
	assert.deepEqual(p.map((x) => [x.level, x.code, x.params.n]), [["error", "one_key_id", 3], ["error", "one_key_name", 5],
		["error", "one_key_text_all", 6], ["error", "one_key_no_text", 7], ["warning", "one_key_text_empty", 8],
		["error", "quick_text_chars", 5]]);
	assert.equal(p.find((x) => x.code === "one_key_text_empty").params.text, 3);
	const entries = decodeArea(encode(m).bytes).entries;
	for (const n of [3, 5, 6, 7]) assert.equal(getValue(entries, ONE_KEY_KEY + n), null);
	assert.ok(getValue(entries, ONE_KEY_KEY + 8));
	assert.equal(getValue(entries, QUICK_TEXT_KEY + 4), null);
});

test("one key: a newer area is left alone and the editor warns", () => {
	const img = CodeplugImage.blank();
	area(img).set(encodeArea([]));
	area(img)[4] = 2;	// a later version
	const before = area(img).slice();
	assert.equal(putOneKey(img.bytes, [call("group", 91)], null), false);
	assert.equal(putOneKey(img.bytes, null, ["QRV"]), false);
	assert.deepEqual(area(img), before);
	const m = edited(img, [call("group", 91), ...none(ONE_KEY_SLOTS - 1)]);
	assert.ok(validate(m).some((x) => x.code === "one_key_area_newer" && x.level === "warning"));
});

test("one key: texts that don't fit the area are an error and the area isn't broken", () => {
	// fill the area with an unknown key, then ask for every quick text at full length
	const big = { key: 0x7F00, value: new Uint8Array(KV_SIZE - 16 - 4 - 600) };
	const img = withArea([big]);
	const before = area(img).slice();
	const texts = Array.from({ length: QUICK_TEXTS }, (_, i) => String(i).padEnd(QUICK_TEXT_MAX, "x"));
	const m = edited(img, null, texts);
	assert.ok(validate(m).some((x) => x.code === "settings_area_full" && x.level === "error"));
	assert.equal(putOneKey(img.bytes, null, texts), false);
	assert.deepEqual(area(img), before);
	assert.doesNotThrow(() => encode(m));
});

test("one key: a write to the radio sends only the slots and texts the edit changed", () => {
	// the radio's area has a key its menu set since the file was read, slot 2 and quick text 1
	const radio = withArea([e(0x0003, 0), { key: ONE_KEY_KEY + 2, value: encodeSlot(call("group", 2)) },
		{ key: QUICK_TEXT_KEY + 1, value: latin("QRV") }]);
	const base = withArea([{ key: ONE_KEY_KEY + 2, value: encodeSlot(call("group", 2)) }, { key: QUICK_TEXT_KEY + 1, value: latin("QRV") }]);
	const m = decode(base);
	const slots = [...m.general.oneKey], texts = [...m.general.quickTexts];
	slots[4] = text("group", 91, 1, "World");
	texts[0] = "On my way";
	const file = encode(edited(base, slots, texts));
	areaForWrite(file.bytes, radio.bytes, base.bytes);
	const sent = decodeArea(file.bytes).entries;
	assert.deepEqual([...getValue(sent, 0x0003)], [0]);
	assert.deepEqual(decodeOneKey(sent).slice(0, 5), [null, null, call("group", 2), null, text("group", 91, 1, "World")]);
	assert.deepEqual(decodeQuickTexts(sent).slice(0, 2), ["On my way", "QRV"]);
});
