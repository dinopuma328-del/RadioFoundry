// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Signaling tones (docs/spec/radio-features.md 4.4): short tone sequences played at the start of a transmission, at
// its end and when a reception ends, on the speaker, on air, or both, separately for DMR and FM. Up to SIG_STEPS
// {Hz, ms} steps each, the same shape as the five Frequency / Period rows of a CPS alert tone page.
//
// This file is pure data and a sample generator: no RTOS, no board. The radio core (radio_sm.c) picks what to play
// and where; beep.c plays the speaker copy; the DMR voice encoder and the FM tone hook carry the on air copy.
#ifndef RADIO_SIGTONE_H
#define RADIO_SIGTONE_H

#include <stdint.h>
#include <stdbool.h>
#include "radio/beep.h"

#define SIG_STEPS	5u
#define SIG_MAX_MS	600u	// a sequence's total length is cut to this: it holds the transmission or the speaker

typedef enum {
	SIG_EV_BEGIN,		// the transmission starts (talk permit)
	SIG_EV_END,		// the transmission ends (roger)
	SIG_EV_IDLE,		// the reception ends, the channel is free
	SIG_EV_COUNT
} sig_event_t;

typedef enum {
	SIG_OUT_DEFAULT,	// what the radio did before this setting existed
	SIG_OUT_OFF,
	SIG_OUT_LOCAL,		// the speaker only
	SIG_OUT_AIR,		// transmitted only
	SIG_OUT_BOTH,
	SIG_OUT_COUNT
} sig_out_t;

typedef enum {
	SIG_SND_STANDARD,	// the event's usual sound
	SIG_SND_CHIRP,
	SIG_SND_BLIP,
	SIG_SND_DOUBLE,
	SIG_SND_ROGER,
	SIG_SND_CALL5,		// the five tone call pattern, the longest preset
	SIG_SND_IDLE1,		// one 2 kHz tone
	SIG_SND_RESET2,		// a falling pair
	SIG_SND_COUNT
} sig_snd_t;

// Whether out sounds on the speaker / goes on air. Idle has no air copy (nothing is being sent)
bool sig_out_local(uint8_t out);
bool sig_out_air(uint8_t out, sig_event_t ev);
// A valid out for the event (idle: no air), else DEFAULT
uint8_t sig_out_clean(uint8_t out, sig_event_t ev);

// A preset's steps for an event into out[SIG_STEPS]; the count. Always at least one step. Total length within
// SIG_MAX_MS
uint8_t sig_steps(uint8_t snd, sig_event_t ev, beep_seg_t out[SIG_STEPS]);
uint32_t sig_total_ms(const beep_seg_t *s, uint8_t n);

// Sample generator (8 kHz mono, phase continuous across steps, 2 ms fades at each step's edges)
typedef struct {
	beep_seg_t seg[SIG_STEPS];
	uint8_t n, i;
	uint32_t left;		// samples left in the step
	uint32_t len;		// samples in the step
	uint32_t phase, step;
	int32_t amp;		// Q15 of full scale
} sig_gen_t;

void sig_gen_start(sig_gen_t *g, const beep_seg_t *s, uint8_t n, int32_t amp_q15);
// Fill count samples; the unplayed rest is zero. True while the sequence still has samples after this call
bool sig_gen_block(sig_gen_t *g, int16_t *pcm, unsigned count);
bool sig_gen_done(const sig_gen_t *g);
// Samples in the whole sequence
uint32_t sig_gen_samples(const beep_seg_t *s, uint8_t n);

#endif
