export type ResourceSlot = "idle" | "active" | "active_alt";
export type Layout = "default" | "vertical" | "horizontal";
export type Resources = Record<ResourceSlot, string | null>;
export type Clicker = { id: string; resources: Resources };
export type Settings = {
  scale: number;
  layout: Layout;
  clickers: Clicker[];
  soundEnabled: boolean;
  sounds: string[];
};

const emptyResources = (): Resources => ({ idle: null, active: null, active_alt: null });

export const createClicker = (id: string): Clicker => ({ id, resources: emptyResources() });

export const defaultSettings: Settings = {
  scale: 1,
  layout: "default",
  clickers: [createClicker("clicker-1")],
  soundEnabled: true,
  sounds: [],
};

function parseClickers(saved: Partial<Settings> & { resources?: Partial<Resources> }): Clicker[] {
  if (Array.isArray(saved.clickers)) {
    const clickers = (saved.clickers as Array<Partial<Clicker> | null>)
      .filter((clicker): clicker is Partial<Clicker> => Boolean(clicker) && typeof clicker === "object")
      .slice(0, 4)
      .map((clicker, index) => ({
        id: typeof clicker.id === "string" && clicker.id.length > 0 ? clicker.id : `clicker-${index + 1}`,
        resources: { ...emptyResources(), ...clicker.resources },
      }));
    if (clickers.length > 0) return clickers;
  }
  return [{ id: "clicker-1", resources: { ...emptyResources(), ...saved.resources } }];
}

export function parseSettings(raw: string | null): Settings {
  try {
    const saved = JSON.parse(raw ?? "null") as (Partial<Settings> & { resources?: Partial<Resources> }) | null;
    if (!saved) return defaultSettings;
    return {
      scale: typeof saved.scale === "number" && saved.scale >= 0.5 && saved.scale <= 4 ? saved.scale : 1,
      layout: saved.layout === "vertical" || saved.layout === "horizontal" ? saved.layout : "default",
      clickers: parseClickers(saved),
      soundEnabled: saved.soundEnabled !== false,
      sounds: Array.isArray(saved.sounds) ? saved.sounds.filter((sound): sound is string => typeof sound === "string") : [],
    };
  } catch {
    return defaultSettings;
  }
}
