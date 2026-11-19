// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// One key operation slots and quick texts (docs/spec/codeplug-settings.md, "One key operation slots" and "Quick
// texts"). A digit held on Home calls a stored target or sends it a stored text. Both are key families of the codeplug
// settings area, written by the Codeplug Editor; the radio only reads them
#ifndef RFOUNDRY_ONE_KEY_H
#define RFOUNDRY_ONE_KEY_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "codeplug/codeplug.h"

#define ONE_KEY_SLOTS		10u	// digits 0-9, slot n at CODEPLUG_KEY_ONE_KEY + n
#define ONE_KEY_REC_LEN		21u	// the record this version reads: flags, ID (3), name (16), quick text
#define QUICK_TEXTS		16u	// quick text n at CODEPLUG_KEY_QUICK_TEXT + n
#define QUICK_TEXT_MAX		64u	// characters (ISO 8859-1, one byte each); the 4 KB area is shared

// Call types (flags bits 0-1), as a target record's (channel-modes.md 5.2); 3 is not a slot
enum { ONE_KEY_INDIVIDUAL, ONE_KEY_GROUP, ONE_KEY_ALL };

// Actions (flags bits 2-3); 2 and 3 are not a slot yet
enum { ONE_KEY_CALL, ONE_KEY_TEXT };

typedef struct {
	uint8_t type;		// ONE_KEY_INDIVIDUAL, _GROUP, _ALL
	uint8_t action;		// ONE_KEY_CALL, ONE_KEY_TEXT
	uint8_t text;		// ONE_KEY_TEXT: the quick text's number, below QUICK_TEXTS
	uint32_t id;		// 0xFFFFFF for all call
	char name[CODEPLUG_NAME_LEN + 1];	// "" when the slot has none
} one_key_t;

// A slot's record from its value (v, n bytes as stored). False when the record is absent for the reader: too short,
// call type 3, action 2 or 3, an ID of 0 or above CODEPLUG_DMR_ID_MAX, or a text action to all call or to a quick text
// number of QUICK_TEXTS or more
bool one_key_decode(const uint8_t *v, int n, one_key_t *out);

// Slot n (0-9) from the codeplug settings area (CONFIG_ONE_KEY). False when the slot is empty or n is out of range
bool one_key_get(uint8_t n, one_key_t *out);

// Quick text n's text from its value (v, n bytes as stored) into out (cap bytes, NUL terminated): the bytes up to the
// first 0x00 or 0xFF, at most QUICK_TEXT_MAX. False when that leaves no text
bool quick_text_decode(const uint8_t *v, int len, char *out, size_t cap);

// Quick text n from the codeplug settings area (CONFIG_ONE_KEY and CONFIG_DMR_SMS). False when it is absent or empty
bool quick_text_get(uint8_t n, char *out, size_t cap);

#endif
