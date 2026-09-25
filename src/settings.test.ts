import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("migrates the legacy single-clicker resources", () => {
    expect(parseSettings('{"scale":1.2,"resources":{"idle":"idle.png"}}')).toMatchObject({
      scale: 1.2,
      clickers: [{ id: "clicker-1", resources: { idle: "idle.png", active: null, active_alt: null } }],
    });
  });

  it("restores up to four independent clickers", () => {
    expect(parseSettings('{"clickers":[{"id":"one","resources":{"idle":"1.png"}},{"id":"two","resources":{"active":"2.png"}},{},{},{}]}')).toMatchObject({
      clickers: [
        { id: "one", resources: { idle: "1.png" } },
        { id: "two", resources: { active: "2.png" } },
        { id: "clicker-3" },
        { id: "clicker-4" },
      ],
    });
  });

  it("falls back safely for malformed or invalid data", () => {
    expect(parseSettings("not-json")).toEqual(defaultSettings);
    expect(parseSettings('{"scale":99}')).toMatchObject({ scale: 1, clickers: [{ id: "clicker-1" }] });
  });

  it("uses sound effects by default and restores sound settings", () => {
    expect(parseSettings(null)).toMatchObject({ soundEnabled: true, sounds: [] });
    expect(parseSettings('{"soundEnabled":false,"sounds":["click.mp3",3]}')).toMatchObject({
      soundEnabled: false,
      sounds: ["click.mp3"],
    });
  });

  it("uses the default layout for old or invalid settings and restores supported layouts", () => {
    expect(parseSettings(null)).toMatchObject({ layout: "default" });
    expect(parseSettings('{"layout":"vertical"}')).toMatchObject({ layout: "vertical" });
    expect(parseSettings('{"layout":"diagonal"}')).toMatchObject({ layout: "default" });
  });
});
