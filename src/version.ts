declare const __PLUGIN_VERSION__: string | undefined;

export const DEFAULT_PLUGIN_VERSION = "0.0.0-dev";

export const PLUGIN_VERSION =
  typeof __PLUGIN_VERSION__ === "string"
    ? __PLUGIN_VERSION__
    : DEFAULT_PLUGIN_VERSION;

export const IS_PRERELEASE = PLUGIN_VERSION.includes("-beta.");
