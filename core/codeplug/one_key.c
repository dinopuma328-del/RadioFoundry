// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// One key operation slots and quick texts from the codeplug settings area (one_key.h, codeplug-settings.md)
#include <string.h>
#include "config.h"
#include "codeplug/one_key.h"
#include "codeplug/codeplug_kv.h"

#if CONFIG_ONE_KEY

bool one_key_decode(const uint8_t *v, int n, one_key_t *out)
{
	if (n < (int)ONE_KEY_REC_LEN) {
		return false;
	}
	uint8_t type = v[0] & 0x03u;
	uint8_t action = (uint8_t)((v[0] >> 2) & 0x03u);	// bits 4-7 reserved: a later version's, ignored
	uint32_t id = (uint32_t)v[1] | ((uint32_t)v[2] << 8) | ((uint32_t)v[3] << 16);
	if (type > ONE_KEY_ALL || action > ONE_KEY_TEXT) {
		return false;
	}
	if (type != ONE_KEY_ALL && (id == 0u || id > CODEPLUG_DMR_ID_MAX)) {
		return false;
	}
	// a text goes to a person or a talkgroup; the quick text number is checked here, its text when it is sent
	if (action == ONE_KEY_TEXT && (type == ONE_KEY_ALL || v[20] >= QUICK_TEXTS)) {
		return false;
	}
	out->type = type;
	out->action = action;
	out->text = action == ONE_KEY_TEXT ? v[20] : 0u;
	out->id = type == ONE_KEY_ALL ? 0xFFFFFFu : id;
	unsigned i = 0;
	while (i < CODEPLUG_NAME_LEN && v[4 + i] != 0u && v[4 + i] != 0xFFu) {
		out->name[i] = (char)v[4 + i];
		i++;
	}
	out->name[i] = '\0';
	return true;
}

bool one_key_get(uint8_t n, one_key_t *out)
{
	uint8_t v[ONE_KEY_REC_LEN];	// a longer (later) record is read from the front
	if (n >= ONE_KEY_SLOTS) {
		return false;
	}
	int len = codeplug_kv_get((uint16_t)(CODEPLUG_KEY_ONE_KEY + n), v, sizeof v);
	return one_key_decode(v, len, out);
}

#endif

#if CONFIG_ONE_KEY && CONFIG_DMR_SMS

bool quick_text_decode(const uint8_t *v, int len, char *out, size_t cap)
{
	size_t i = 0;
	if (cap == 0u) {
		return false;
	}
	while (len > 0 && i < (size_t)len && i < QUICK_TEXT_MAX && i + 1u < cap && v[i] != 0u && v[i] != 0xFFu) {
		out[i] = (char)v[i];
		i++;
	}
	out[i] = '\0';
	return i > 0u;
}

bool quick_text_get(uint8_t n, char *out, size_t cap)
{
	uint8_t v[QUICK_TEXT_MAX];	// a longer value is read from the front
	if (n >= QUICK_TEXTS) {
		if (cap > 0u) {
			out[0] = '\0';
		}
		return false;
	}
	int len = codeplug_kv_get((uint16_t)(CODEPLUG_KEY_QUICK_TEXT + n), v, sizeof v);
	if (len > (int)sizeof v) {
		len = (int)sizeof v;
	}
	return quick_text_decode(v, len, out, cap);
}

#endif
