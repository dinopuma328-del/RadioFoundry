// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Speed dial slots from the codeplug settings area (speed_dial.h, codeplug-settings.md, "Speed dial slots")
#include <string.h>
#include "config.h"
#include "codeplug/speed_dial.h"
#include "codeplug/codeplug_kv.h"

#if CONFIG_DMR

bool speed_dial_decode(const uint8_t *v, int n, speed_dial_t *out)
{
	if (n < (int)SPEED_DIAL_REC_LEN) {
		return false;
	}
	uint8_t type = v[0] & 0x03u;	// bits 2-7 reserved: a later version's, ignored
	uint32_t id = (uint32_t)v[1] | ((uint32_t)v[2] << 8) | ((uint32_t)v[3] << 16);
	if (type > SPEED_DIAL_ALL || (type != SPEED_DIAL_ALL && (id == 0u || id > CODEPLUG_DMR_ID_MAX))) {
		return false;
	}
	out->type = type;
	out->id = type == SPEED_DIAL_ALL ? 0xFFFFFFu : id;
	unsigned i = 0;
	while (i < CODEPLUG_NAME_LEN && v[4 + i] != 0u && v[4 + i] != 0xFFu) {
		out->name[i] = (char)v[4 + i];
		i++;
	}
	out->name[i] = '\0';
	return true;
}

bool speed_dial_get(uint8_t n, speed_dial_t *out)
{
	uint8_t v[SPEED_DIAL_REC_LEN];	// a longer (later) record is read from the front
	if (n >= SPEED_DIAL_SLOTS) {
		return false;
	}
	int len = codeplug_kv_get((uint16_t)(CODEPLUG_KEY_SPEED_DIAL + n), v, sizeof v);
	return speed_dial_decode(v, len, out);
}

#endif
