// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Speed dial slots: a digit held on Home talks to a stored target (docs/spec/codeplug-settings.md, "Speed dial
// slots"). The slots are a key family of the codeplug settings area, written by the Codeplug Editor; the radio only
// reads them
#ifndef RFOUNDRY_SPEED_DIAL_H
#define RFOUNDRY_SPEED_DIAL_H

#include <stdint.h>
#include <stdbool.h>
#include "codeplug/codeplug.h"

#define SPEED_DIAL_SLOTS	10u	// digits 0-9, slot n at CODEPLUG_KEY_SPEED_DIAL + n
#define SPEED_DIAL_REC_LEN	20u	// the record this version reads: flags, ID (3), name (16)

// Call types (flags bits 0-1), as a target record's (channel-modes.md 5.2); 3 is not a speed dial
enum { SPEED_DIAL_INDIVIDUAL, SPEED_DIAL_GROUP, SPEED_DIAL_ALL };

typedef struct {
	uint8_t type;		// SPEED_DIAL_*
	uint32_t id;		// 0xFFFFFF for all call
	char name[CODEPLUG_NAME_LEN + 1];	// "" when the slot has none
} speed_dial_t;

// A slot's record from its value (v, n bytes as stored). False when the record is absent for the reader: too short,
// call type 3, an ID of 0 or above CODEPLUG_DMR_ID_MAX
bool speed_dial_decode(const uint8_t *v, int n, speed_dial_t *out);

// Slot n (0-9) from the codeplug settings area (CONFIG_SPEED_DIAL). False when the slot is empty or n is out of range
bool speed_dial_get(uint8_t n, speed_dial_t *out);

#endif
