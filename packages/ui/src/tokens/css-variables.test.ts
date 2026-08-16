import { describe, expect, it } from "vitest";
import { chromeTokensToCssVariables } from "./css-variables.js";
import { lightChromeTokens } from "./light-theme.js";
import { darkChromeTokens } from "./dark-theme.js";

describe("chromeTokensToCssVariables", () => {
  it("maps light theme tokens to --renote-* custom properties", () => {
    const vars = chromeTokensToCssVariables(lightChromeTokens);
    expect(vars["--renote-color-background"]).toBe("#ffffff");
    expect(vars["--renote-color-foreground"]).toBe("#000000");
    expect(vars["--renote-border-width"]).toBe("1px");
  });

  it("produces a distinct value set for dark theme tokens", () => {
    const lightVars = chromeTokensToCssVariables(lightChromeTokens);
    const darkVars = chromeTokensToCssVariables(darkChromeTokens);
    expect(darkVars["--renote-color-background"]).not.toBe(lightVars["--renote-color-background"]);
    expect(darkVars["--renote-color-background"]).toBe("#000000");
  });
});
