// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Signaling tones (sigtone.h)
#include <string.h>
#include "radio/sigtone.h"
#include "hal_audio.h"

#define RAMP_SAMPLES	16	// 2 ms, as beep.c: no clicks

bool sig_out_local(uint8_t out)
{
	return out == SIG_OUT_LOCAL || out == SIG_OUT_BOTH;
}

bool sig_out_air(uint8_t out, sig_event_t ev)
{
	return ev != SIG_EV_IDLE && (out == SIG_OUT_AIR || out == SIG_OUT_BOTH);
}

uint8_t sig_out_clean(uint8_t out, sig_event_t ev)
{
	if (out >= SIG_OUT_COUNT || (ev == SIG_EV_IDLE && (out == SIG_OUT_AIR || out == SIG_OUT_BOTH))) {
		return SIG_OUT_DEFAULT;
	}
	return out;
}

// Pitches follow the beeps' (beep.c): a sequence reads as the same family of sounds
static const beep_seg_t s_permit[] = { { 1600, 50 }, { 0, 40 }, { 1600, 50 } };
static const beep_seg_t s_end[] = { { 1200, 50 }, { 0, 30 }, { 900, 70 } };
static const beep_seg_t s_chirp[] = { { 1000, 40 }, { 1400, 40 }, { 1800, 40 } };
static const beep_seg_t s_blip[] = { { 1500, 60 } };
static const beep_seg_t s_double[] = { { 1500, 40 }, { 0, 40 }, { 1500, 40 } };
static const beep_seg_t s_roger[] = { { 1200, 100 }, { 900, 100 } };
// Five steps of 40 ms, the first silent: a call tone as a CPS alert tone page can hold
static const beep_seg_t s_call5[] = { { 0, 40 }, { 1570, 40 }, { 1050, 40 }, { 1570, 40 }, { 1320, 40 } };
static const beep_seg_t s_idle1[] = { { 2000, 100 } };
static const beep_seg_t s_reset2[] = { { 640, 100 }, { 950, 50 } };

uint32_t sig_total_ms(const beep_seg_t *s, uint8_t n)
{
	uint32_t t = 0;
	for (uint8_t i = 0; i < n; i++) {
		t += s[i].ms;
	}
	return t;
}

uint8_t sig_steps(uint8_t snd, sig_event_t ev, beep_seg_t out[SIG_STEPS])
{
	const beep_seg_t *src;
	uint8_t n;
#define USE(a)	do { src = a; n = sizeof(a) / sizeof(a[0]); } while (0)
	switch (snd) {
	case SIG_SND_CHIRP: USE(s_chirp); break;
	case SIG_SND_BLIP: USE(s_blip); break;
	case SIG_SND_DOUBLE: USE(s_double); break;
	case SIG_SND_ROGER: USE(s_roger); break;
	case SIG_SND_CALL5: USE(s_call5); break;
	case SIG_SND_IDLE1: USE(s_idle1); break;
	case SIG_SND_RESET2: USE(s_reset2); break;
	default:
		if (ev == SIG_EV_BEGIN) {
			USE(s_permit);
		} else {
			USE(s_end);
		}
		break;
	}
#undef USE
	if (n > SIG_STEPS) {
		n = SIG_STEPS;
	}
	uint32_t left = SIG_MAX_MS;
	uint8_t m = 0;
	for (uint8_t i = 0; i < n && left != 0; i++) {
		out[m] = src[i];
		if (out[m].hz == BEEP_HZ_SWEEP) {
			out[m].hz = 0;		// a step is a tone or a pause: BEEP_HZ_SWEEP is beep.c's
		}
		if (out[m].ms > left) {
			out[m].ms = (uint16_t)left;
		}
		left -= out[m].ms;
		m++;
	}
	return m;
}

// One period of a sine, Q15 (the same table as beep.c: this file builds without CONFIG_BEEP)
static const int16_t sine[64] = {
	0, 3212, 6393, 9512, 12539, 15446, 18204, 20787, 23170, 25329, 27245, 28898, 30273, 31356, 32137, 32609,
	32767, 32609, 32137, 31356, 30273, 28898, 27245, 25329, 23170, 20787, 18204, 15446, 12539, 9512, 6393, 3212,
	0, -3212, -6393, -9512, -12539, -15446, -18204, -20787, -23170, -25329, -27245, -28898, -30273, -31356, -32137,
	-32609, -32767, -32609, -32137, -31356, -30273, -28898, -27245, -25329, -23170, -20787, -18204, -15446, -12539,
	-9512, -6393, -3212,
};

uint32_t sig_gen_samples(const beep_seg_t *s, uint8_t n)
{
	return sig_total_ms(s, n) * (AUDIO_RATE_HZ / 1000);
}

static void load_step(sig_gen_t *g)
{
	const beep_seg_t *s = &g->seg[g->i];
	g->len = g->left = (uint32_t)s->ms * (AUDIO_RATE_HZ / 1000);
	g->step = (uint32_t)(((uint64_t)s->hz << 32) / AUDIO_RATE_HZ);
}

void sig_gen_start(sig_gen_t *g, const beep_seg_t *s, uint8_t n, int32_t amp_q15)
{
	memset(g, 0, sizeof(*g));
	if (n > SIG_STEPS) {
		n = SIG_STEPS;
	}
	memcpy(g->seg, s, n * sizeof(beep_seg_t));
	g->n = n;
	g->amp = amp_q15 > 32767 ? 32767 : amp_q15 < 0 ? 0 : amp_q15;
	if (n != 0) {
		load_step(g);
	}
}

bool sig_gen_done(const sig_gen_t *g)
{
	return g->i >= g->n;
}

bool sig_gen_block(sig_gen_t *g, int16_t *pcm, unsigned count)
{
	for (unsigned k = 0; k < count; k++) {
		while (g->i < g->n && g->left == 0) {
			if (++g->i < g->n) {
				load_step(g);
			}
		}
		if (g->i >= g->n) {
			pcm[k] = 0;
			continue;
		}
		int32_t v = 0;
		if (g->step != 0) {
			uint32_t done = g->len - g->left;
			uint32_t edge = done < g->left ? done : g->left - 1;
			int32_t amp = g->amp;
			if (edge < RAMP_SAMPLES) {
				amp = amp * (int32_t)edge / RAMP_SAMPLES;
			}
			uint32_t idx = g->phase >> 26;
			int32_t frac = (int32_t)((g->phase >> 16) & 0x3FFu);
			int32_t a = sine[idx], b = sine[(idx + 1) & 63u];
			v = ((a + (((b - a) * frac) >> 10)) * amp) >> 15;
			g->phase += g->step;
		}
		pcm[k] = (int16_t)v;
		g->left--;
	}
	// Exhausted steps are skipped here so "more" is true only while samples remain
	while (g->i < g->n && g->left == 0) {
		if (++g->i < g->n) {
			load_step(g);
		}
	}
	return g->i < g->n;
}
