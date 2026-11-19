// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Speed dial slots in the Codeplug Editor (docs/spec/codeplug-settings.md, "Speed dial slots"): static/js/codeplug/
// speeddial.js, the general settings' speedDial (records.js, model.js) and a write to a radio (kv.js areaForWrite).
// Run with node --test site/tests/ (site/tests/run.sh).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CodeplugImage } from "../static/js/codeplug/image.js";
import { KV_ADDR, KV_SIZE, ID_MAX, decodeArea, encodeArea, getValue, areaForWrite } from "../static/js/codeplug/kv.js";
import {
	SPEED_KEY, SPEED_SLOTS, SPEED_REC_LEN, decodeSlot, encodeSlot, slotValid, decodeSpeedDial, putSpeedDial,
} from "../static/js/codeplug/speeddial.js";
import { decode, encode, empty, validate } from "../static/js/codeplug/model.js";

const area = (img) => img.bytes.subarray(KV_ADDR, KV_ADDR + KV_SIZE);
const e = (key, ...bytes) => ({ key, value: Uint8Array.from(bytes) });
const pad = (s) => [...s].map((c) => c.charCodeAt(0)).concat(Array(16 - s.length).fill(0xFF));

function withArea(entries) {
	const img = CodeplugImage.blank();
	area(img).set(encodeArea(entries));
	return img;
}

test("speed dial: the record's bytes", () => {
	assert.deepEqual([...encodeSlot({ type: "group", id: 4000, name: "Unlink" })],
		[1, 0xA0, 0x0F, 0x00, ...pad("Unlink")]);
	assert.deepEqual([...encodeSlot({ type: "private", id: 9991234, name: "" })],
		[0, 0x42, 0x74, 0x98, ...Array(16).fill(0xFF)]);
	// all call: the ID is 0xFFFFFF whatever the model holds
	assert.deepEqual([...encodeSlot({ type: "all", id: 5, name: "All" })].slice(0, 4), [2, 0xFF, 0xFF, 0xFF]);
	assert.equal(encodeSlot({ type: "group", id: 1, name: "" }).length, SPEED_REC_LEN);
});

test("speed dial: a record round-trips; a value the radio reads as empty is null", () => {
	for (const s of [{ type: "group", id: 91, name: "World" }, { type: "private", id: ID_MAX, name: "ABCDEFGHIJKLMNOP" },
		{ type: "all", id: 0xFFFFFF, name: "" }]) assert.deepEqual(decodeSlot(encodeSlot(s)), s);
	const ok = encodeSlot({ type: "group", id: 91, name: "" });
	assert.equal(decodeSlot(null), null);
	assert.equal(decodeSlot(ok.subarray(0, SPEED_REC_LEN - 1)), null);	// too short
	assert.equal(decodeSlot(Uint8Array.from([3, ...ok.subarray(1)])), null);	// call type 3
	assert.equal(decodeSlot(Uint8Array.from([1, 0, 0, 0, ...ok.subarray(4)])), null);	// ID 0
	const over = ID_MAX + 1;
	assert.equal(decodeSlot(Uint8Array.from([1, over & 0xFF, (over >> 8) & 0xFF, over >> 16, ...ok.subarray(4)])), null);
	// the reserved bits and a later version's bytes are ignored
	assert.deepEqual(decodeSlot(Uint8Array.from([0xFD, ...ok.subarray(1), 7, 7])), { type: "group", id: 91, name: "" });
});

test("speed dial: which slots are valid", () => {
	assert.ok(slotValid(null));
	assert.ok(slotValid({ type: "group", id: 4000, name: "Unlink" }));
	assert.ok(slotValid({ type: "all", id: 0, name: "" }));
	assert.ok(!slotValid({ type: "group", id: 0, name: "" }));
	assert.ok(!slotValid({ type: "private", id: ID_MAX + 1, name: "" }));
	assert.ok(!slotValid({ type: "group", id: 91, name: "x".repeat(17) }));
	assert.ok(!slotValid({ type: "other", id: 91, name: "" }));
});

test("speed dial: decoded from the area, ten slots, the rest of the family ignored", () => {
	const img = withArea([e(0x7001, 1), { key: SPEED_KEY + 4, value: encodeSlot({ type: "group", id: 4000, name: "Unlink" }) },
		{ key: SPEED_KEY + 12, value: encodeSlot({ type: "group", id: 1, name: "" }) }]);
	const slots = decodeSpeedDial(decodeArea(img.bytes).entries);
	assert.equal(slots.length, SPEED_SLOTS);
	assert.deepEqual(slots[4], { type: "group", id: 4000, name: "Unlink" });
	assert.ok(slots.every((s, n) => n === 4 || s === null));
	assert.deepEqual(decode(img).general.speedDial, slots);
	assert.deepEqual(empty().general.speedDial, Array(SPEED_SLOTS).fill(null));
});

test("speed dial: an unedited codeplug keeps its bytes", () => {
	const img = withArea([e(0x7001, 1, 2), { key: SPEED_KEY + 1, value: Uint8Array.from([...encodeSlot({ type: "group", id: 9, name: "" }), 0xAA]) }]);
	const before = img.bytes.slice();
	const out = encode(decode(img));
	assert.deepEqual(out.bytes, before);
});

test("speed dial: an edit writes only the slots it changed, from the front, and keeps other keys", () => {
	const later = Uint8Array.from([...encodeSlot({ type: "group", id: 9, name: "Local" }), 0xAA, 0xBB]);
	const img = withArea([e(0x7001, 1, 2), { key: SPEED_KEY + 1, value: later }]);
	const m = decode(img);
	const slots = [...m.general.speedDial];
	slots[1] = { type: "group", id: 3100, name: "USA" };
	slots[4] = { type: "group", id: 4000, name: "Unlink" };
	m.general = { ...m.general, speedDial: slots };
	const entries = decodeArea(encode(m).bytes).entries;
	assert.deepEqual([...getValue(entries, 0x7001)], [1, 2]);
	const one = getValue(entries, SPEED_KEY + 1);
	assert.equal(one.length, SPEED_REC_LEN + 2);	// a later version's bytes kept after the fields set
	assert.deepEqual([...one.subarray(SPEED_REC_LEN)], [0xAA, 0xBB]);
	assert.deepEqual(decodeSlot(one), { type: "group", id: 3100, name: "USA" });
	assert.deepEqual(decodeSlot(getValue(entries, SPEED_KEY + 4)), { type: "group", id: 4000, name: "Unlink" });
	// cleared: the key goes
	const m2 = decode(encode(m));
	const s2 = [...m2.general.speedDial];
	s2[1] = null;
	m2.general = { ...m2.general, speedDial: s2 };
	assert.equal(getValue(decodeArea(encode(m2).bytes).entries, SPEED_KEY + 1), null);
});

test("speed dial: an invalid slot is reported and never written", () => {
	const m = empty();
	const slots = [...m.general.speedDial];
	slots[3] = { type: "group", id: 0, name: "" };
	slots[5] = { type: "group", id: 91, name: "x".repeat(17) };
	m.general = { ...m.general, speedDial: slots };
	const p = validate(m).filter((x) => x.field === "speedDial");
	assert.deepEqual(p.map((x) => [x.level, x.code, x.params.n]), [["error", "speed_dial_id", 3], ["error", "speed_dial_name", 5]]);
	const entries = decodeArea(encode(m).bytes).entries;
	assert.equal(getValue(entries, SPEED_KEY + 3), null);
	assert.equal(getValue(entries, SPEED_KEY + 5), null);
});

test("speed dial: a newer area is left alone and the editor warns", () => {
	const img = CodeplugImage.blank();
	area(img).set(encodeArea([]));
	area(img)[4] = 2;	// a later version
	const before = area(img).slice();
	assert.equal(putSpeedDial(img.bytes, [{ type: "group", id: 91, name: "" }]), false);
	assert.deepEqual(area(img), before);
	const m = decode(img);
	m.general = { ...m.general, speedDial: [{ type: "group", id: 91, name: "" }, ...Array(SPEED_SLOTS - 1).fill(null)] };
	assert.ok(validate(m).some((x) => x.code === "speed_dial_area_newer" && x.level === "warning"));
});

test("speed dial: a write to the radio sends only the slots the edit changed", () => {
	// the radio's area has a key its menu set since the file was read, and slot 2
	const radio = withArea([e(0x0003, 0), { key: SPEED_KEY + 2, value: encodeSlot({ type: "group", id: 2, name: "" }) }]);
	const base = withArea([{ key: SPEED_KEY + 2, value: encodeSlot({ type: "group", id: 2, name: "" }) }]);
	const m = decode(base);
	const slots = [...m.general.speedDial];
	slots[4] = { type: "group", id: 4000, name: "Unlink" };
	m.general = { ...m.general, speedDial: slots };
	const file = encode(m);
	areaForWrite(file.bytes, radio.bytes, base.bytes);
	const sent = decodeArea(file.bytes).entries;
	assert.deepEqual([...getValue(sent, 0x0003)], [0]);
	assert.deepEqual(decodeSpeedDial(sent).slice(0, 5), [null, null, { type: "group", id: 2, name: "" }, null,
		{ type: "group", id: 4000, name: "Unlink" }]);
});
