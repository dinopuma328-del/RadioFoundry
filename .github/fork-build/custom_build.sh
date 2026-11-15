#!/bin/sh
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry Authors
#
# Fork only (build-on-demand.yml): one board's image with the web flasher's feature choice, packaged by tools/release.py
# into OUT. Run through the csky-elf image's run.sh, like tools/release_build.sh.
#
#   .github/fork-build/custom_build.sh BOARD FEATURES VERSION OUT
#
# FEATURES is the comma list of switches that are on (the flasher's selection, names without CONFIG_). Every switch the
# flasher lists is set to y or n by it; the rest keep the board's defaults.
set -eu
cd "$(dirname "$0")/../.."
BOARD=$1 ON=$2 VERSION=$3 OUT=$4
PY=$(tools/rfoundry_python.sh)
NAMES=$("$PY" -c 'import sys; sys.path.insert(0, "site"); from rfoundrysite import repo; print(" ".join(f["name"] for f in repo.features()))')
ARGS=""
for n in $NAMES; do
	case ",$ON," in *",$n,"*) v=y ;; *) v=n ;; esac
	ARGS="$ARGS CONFIG_$n=$v"
done
echo "custom_build: $BOARD$ARGS"
# shellcheck disable=SC2086
make BOARD="$BOARD" $ARGS -j"$(nproc 2>/dev/null || echo 4)"
# the manifest names the switches the image really has: make's resolved list, not the request
# shellcheck disable=SC2086
FEATS=$(make -s BOARD="$BOARD" $ARGS print-config | sed -n 's/=y$//p' | paste -sd, -)
"$PY" tools/release.py --board "$BOARD" --version "$VERSION" --features "$FEATS" --out "$OUT"
