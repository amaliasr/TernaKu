#!/usr/bin/env bash
# Archive, export, and check a local device IPA. Upload is a separate owner action.
set -euo pipefail
usage() { echo 'Usage: bash prepare-testflight.sh TEAM_ID BUILD_NUMBER [new_output_directory]'; }
fail() { echo "$*" >&2; exit 1; }
if [[ ${1:-} == --help ]]; then usage; exit 0; fi
if (( $# < 2 || $# > 3 )); then usage >&2; exit 2; fi
team="$1"
build="$2"
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] || fail 'Gunakan Team ID Apple yang terdiri dari 10 huruf/angka.'
[[ "$build" =~ ^[1-9][0-9]{0,3}$ ]] || fail 'Gunakan nomor build 1–9999 yang belum pernah diunggah untuk versi ini.'
[[ "$(uname -s)" == Darwin ]] || fail 'Jalankan pada Mac dengan Xcode dan identitas penandatanganan peternakan.'
sdk="$(xcrun --sdk iphoneos --show-sdk-version)"
xcode="$(xcodebuild -version | awk '$1 == "Xcode" {print $2}')"
[[ ${sdk%%.*} -ge 26 && ${xcode%%.*} -ge 26 ]] || fail 'Pilih Xcode 26 atau lebih baru dengan SDK iOS 26 atau lebih baru.'

umask 077
ios="$(cd "$(dirname "$0")" && pwd)"
output="${3:-$ios/build/testflight-$build}"
mkdir -p "$(dirname "$output")"
mkdir "$output" || fail 'Pilih direktori keluaran baru agar arsip yang ada tetap tersimpan.'
output="$(cd "$output" && pwd)"
archive="$output/TernaKu.xcarchive"
xcodebuild -project "$ios/TernaKu.xcodeproj" -scheme TernaKu -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$archive" \
    DEVELOPMENT_TEAM="$team" CURRENT_PROJECT_VERSION="$build" archive

options="$output/ExportOptions.plist"
plutil -create xml1 "$options"
plutil -insert method -string app-store-connect "$options"
plutil -insert destination -string export "$options"
plutil -insert signingStyle -string automatic "$options"
plutil -insert teamID -string "$team" "$options"
plutil -insert manageAppVersionAndBuildNumber -bool NO "$options"
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" -exportPath "$output/export"

ipa="$output/export/TernaKu.ipa"
[[ -f "$ipa" ]] || fail "Paket hasil ekspor belum ditemukan di $ipa"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/ternaku-testflight.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
ditto -x -k "$ipa" "$scratch"
app="$scratch/Payload/TernaKu.app"
info="$app/Info.plist"
signed="$scratch/entitlements.plist"
codesign --verify --strict "$app"
codesign --display --entitlements - "$app" > "$signed"
expect() {
    local value
    value="$(/usr/libexec/PlistBuddy -c "Print :$2" "$1")"
    [[ "$value" == "$3" ]] || fail "Nilai $2 tidak cocok pada paket hasil ekspor."
}
expect "$info" CFBundleIdentifier com.rstudiohub.ternaku
expect "$info" CFBundleVersion "$build"
expect "$info" DTPlatformName iphoneos
expect "$info" APNSEnvironment production
expect "$signed" aps-environment production
expect "$signed" com.apple.developer.team-identifier "$team"
echo "Paket perangkat untuk TestFlight siap di $ipa"
