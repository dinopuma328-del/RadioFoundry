// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Signaling tones (core/radio/sigtone.c): which outputs sound where, the presets, the length cap and the sample
// generator (length, silence, no samples after the end, the pitch)
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "radio/sigtone.h"

static int failures, checks;
#define CHECK(c) do { checks++; if (!(c)) { failures++; printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)

static void test_out(void)
{
	CHECK(!sig_out_local(SIG_OUT_DEFAULT) && !sig_out_local(SIG_OUT_OFF) && sig_out_local(SIG_OUT_LOCAL) &&
	      !sig_out_local(SIG_OUT_AIR) && sig_out_local(SIG_OUT_BOTH));
	CHECK(sig_out_air(SIG_OUT_AIR, SIG_EV_BEGIN) && sig_out_air(SIG_OUT_BOTH, SIG_EV_END) &&
	      !sig_out_air(SIG_OUT_LOCAL, SIG_EV_END) && !sig_out_air(SIG_OUT_DEFAULT, SIG_EV_BEGIN));
	// nothing is sent when a reception ends
	CHECK(!sig_out_air(SIG_OUT_AIR, SIG_EV_IDLE) && !sig_out_air(SIG_OUT_BOTH, SIG_EV_IDLE));
	CHECK(sig_out_clean(SIG_OUT_AIR, SIG_EV_IDLE) == SIG_OUT_DEFAULT && sig_out_clean(SIG_OUT_BOTH, SIG_EV_IDLE) == SIG_OUT_DEFAULT);
	CHECK(sig_out_clean(SIG_OUT_BOTH, SIG_EV_END) == SIG_OUT_BOTH && sig_out_clean(SIG_OUT_LOCAL, SIG_EV_IDLE) == SIG_OUT_LOCAL);
	CHECK(sig_out_clean(200, SIG_EV_BEGIN) == SIG_OUT_DEFAULT && sig_out_clean(SIG_OUT_COUNT, SIG_EV_END) == SIG_OUT_DEFAULT);
}

static void test_presets(void)
{
	beep_seg_t s[SIG_STEPS];
	for (int snd = 0; snd < SIG_SND_COUNT + 2; snd++) {
		for (int ev = 0; ev < SIG_EV_COUNT; ev++) {
			uint8_t n = sig_steps((uint8_t)snd, (sig_event_t)ev, s);
			CHECK(n >= 1 && n <= SIG_STEPS && sig_total_ms(s, n) <= SIG_MAX_MS && sig_total_ms(s, n) != 0);
			for (uint8_t i = 0; i < n; i++) {
				CHECK(s[i].hz != BEEP_HZ_SWEEP && s[i].hz < 4000);
			}
		}
	}
	// the standard sound follows the event: the permit pitch at the start, the call end's otherwise
	uint8_t n = sig_steps(SIG_SND_STANDARD, SIG_EV_BEGIN, s);
	CHECK(n == 3 && s[0].hz == 1600 && s[2].hz == 1600);
	n = sig_steps(SIG_SND_STANDARD, SIG_EV_END, s);
	CHECK(n == 3 && s[0].hz == 1200 && s[2].hz == 900);
	// the presets read off an alert tone page: the call tone's five steps, the idle tone, the reset tone
	n = sig_steps(SIG_SND_CALL5, SIG_EV_BEGIN, s);
	CHECK(n == 5 && s[0].hz == 0 && s[1].hz == 1570 && s[2].hz == 1050 && s[3].hz == 1570 && s[4].hz == 1320 &&
	      s[0].ms == 40 && s[4].ms == 40);
	n = sig_steps(SIG_SND_IDLE1, SIG_EV_IDLE, s);
	CHECK(n == 1 && s[0].hz == 2000 && s[0].ms == 100);
	n = sig_steps(SIG_SND_RESET2, SIG_EV_END, s);
	CHECK(n == 2 && s[0].hz == 640 && s[0].ms == 100 && s[1].hz == 950 && s[1].ms == 50);
	// the roger preset is the FM roger beep
	n = sig_steps(SIG_SND_ROGER, SIG_EV_END, s);
	CHECK(n == 2 && s[0].hz == 1200 && s[0].ms == 100 && s[1].hz == 900 && s[1].ms == 100);
}

// Zero crossings of a block: about 2 * hz * seconds
static int crossings(const int16_t *p, int n)
{
	int c = 0;
	for (int i = 1; i < n; i++) {
		if ((p[i - 1] < 0) != (p[i] < 0)) {
			c++;
		}
	}
	return c;
}

static void test_gen(void)
{
	static int16_t pcm[8000];
	beep_seg_t one[] = { { 1000, 100 } };
	sig_gen_t g;
	CHECK(sig_gen_samples(one, 1) == 800);
	sig_gen_start(&g, one, 1, 16000);
	memset(pcm, 0x55, sizeof(pcm));
	// 160 samples: the tone's first 100 ms is 800 samples, so the sequence goes on
	CHECK(sig_gen_block(&g, pcm, 160) && !sig_gen_done(&g));
	int c = crossings(pcm + 16, 144);
	CHECK(c >= 2 * 1000 * 144 / 8000 - 2 && c <= 2 * 1000 * 144 / 8000 + 2);
	// the fade in: the first sample is silent, the peak is near the level
	int peak = 0;
	for (int i = 0; i < 160; i++) {
		peak = abs(pcm[i]) > peak ? abs(pcm[i]) : peak;
	}
	CHECK(pcm[0] == 0 && peak > 14000 && peak <= 16000);
	// the rest: 640 samples of the tone end the sequence; the unplayed part of the block is zero
	CHECK(!sig_gen_block(&g, pcm, 800 - 160 + 40));
	CHECK(sig_gen_done(&g));
	for (int i = 800 - 160; i < 800 - 160 + 40; i++) {
		CHECK(pcm[i] == 0);
	}
	CHECK(pcm[800 - 160 - 1] == 0);	// fades out

	// a pause is silent, the next step goes on in phase (no jump to a full level at its first sample)
	beep_seg_t seq[] = { { 0, 40 }, { 1570, 40 }, { 1050, 40 } };
	sig_gen_start(&g, seq, 3, 20000);
	CHECK(sig_gen_samples(seq, 3) == 960);
	CHECK(sig_gen_block(&g, pcm, 320));
	for (int i = 0; i < 320; i++) {
		CHECK(pcm[i] == 0);
	}
	CHECK(!sig_gen_block(&g, pcm, 640));
	c = crossings(pcm + 16, 320 - 32);
	CHECK(c >= 2 * 1570 * 288 / 8000 - 2 && c <= 2 * 1570 * 288 / 8000 + 2);
	c = crossings(pcm + 320 + 16, 320 - 32);
	CHECK(c >= 2 * 1050 * 288 / 8000 - 2 && c <= 2 * 1050 * 288 / 8000 + 2);
	CHECK(sig_gen_done(&g));
	// after the end: zeros, and no longer "more"
	memset(pcm, 0x55, 320);
	CHECK(!sig_gen_block(&g, pcm, 160) && pcm[0] == 0 && pcm[159] == 0);

	// an empty sequence is done at once
	sig_gen_start(&g, one, 0, 1000);
	CHECK(sig_gen_done(&g) && !sig_gen_block(&g, pcm, 160));
	// a level above full scale is held at full scale
	sig_gen_start(&g, one, 1, 99999);
	CHECK(g.amp == 32767);
}

int main(void)
{
	test_out();
	test_presets();
	test_gen();
	printf("%d checks, %d failed\n", checks, failures);
	return failures != 0;
}
