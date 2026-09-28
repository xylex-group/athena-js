/**
 * Metro resolution notes for Athena (document only until full Expo app is scaffolded).
 *
 * Prefer:
 *   import { createReactNativeClient } from "@xylex-group/athena/react-native";
 *
 * Do not import package root (@xylex-group/athena) — Node fs/path/pg.
 *
 * When wiring a real Expo app, start from expo/metro-config getDefaultConfig(__dirname)
 * and keep the explicit /react-native subpath. Package-level exports["."].react-native
 * remains deferred (architecture AD-008).
 *
 * This file is intentionally free of `require("expo/metro-config")` so the lean
 * fixture gate does not need a full Expo install.
 */
module.exports = {};
