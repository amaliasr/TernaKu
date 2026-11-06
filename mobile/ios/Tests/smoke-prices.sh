#!/usr/bin/env bash
# Requires macOS with Xcode and an installed iPhone simulator runtime.
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/ternaku-price-test.XXXXXX")"
device=""
injector=""
cleanup() {
  if [[ -n "$injector" ]]; then kill "$injector" 2>/dev/null || true; fi
  if [[ -n "$device" ]]; then xcrun simctl delete "$device" || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

xcrun simctl list devices available -j > "$work/available.json"
selection="$(python3 - "$work/available.json" <<'PY'
import json
import sys
choices = []
for runtime, devices in json.load(open(sys.argv[1]))["devices"].items():
    if not runtime.startswith("com.apple.CoreSimulator.SimRuntime.iOS-"):
        continue
    for device in devices:
        if device["name"].startswith("iPhone") and device.get("deviceTypeIdentifier"):
            version = tuple(map(int, runtime.split("iOS-")[1].split("-")))
            choices.append((version, device["deviceTypeIdentifier"], runtime))
if not choices:
    sys.exit("Install an iOS simulator runtime and iPhone simulator in Xcode.")
print(" ".join(max(choices)[1:]))
PY
)"
read -r model runtime <<< "$selection"
device="$(xcrun simctl create "TernaKu price test $$" "$model" "$runtime")"
xcrun simctl bootstatus "$device" -b

inject() {
  local runner="" request="" marker=""
  # The test grants notification permission, terminates TernaKu, then signals from its own sandbox.
  while true; do
    runner="$(xcrun simctl get_app_container "$device" com.rstudiohub.ternaku.uitests.xctrunner data 2>/dev/null || true)"
    marker="$runner/tmp/ternaku-price-ready"
    if [[ -n "$runner" && -s "$marker" ]]; then break; fi
    sleep 1
  done
  request="$(cat "$marker")"
  for suffix in a b; do
    printf '{"aps":{"alert":{"title":"Harga telur diperbarui","body":"Bagus Rp28.000/kg, bentes Rp18.000/kg."},"sound":"default"},"tag":"price-smoke-%s"}' "$suffix" > "$work/price.json"
    xcrun simctl push "$device" com.rstudiohub.ternaku "$work/price.json"
    sleep 2
  done
  printf '%s' "$request" > "$runner/tmp/ternaku-price-delivered"
}
inject &
injector=$!
xcodebuild -project "$project_dir/TernaKu.xcodeproj" -scheme TernaKu -configuration Debug \
  -destination "platform=iOS Simulator,id=$device" -derivedDataPath "$work/build" \
  -testLanguage en -testRegion US -parallel-testing-enabled NO \
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG TERNAKU_UI_SMOKE' \
  -only-testing:PriceAlertsUITests/PriceAlertsUITests/testTwoEqualPricesArriveWhileTerminated test
