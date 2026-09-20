#!/usr/bin/env bash
# Host test for the earnings text helpers the badge screen relies on. No
# hardware, no ESP-IDF: the header is pure C++17.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
c++ -std=c++17 -Wall -Wextra -Werror -o "$TMP/earnings_text_test" earnings_text_test.cpp
"$TMP/earnings_text_test"
