import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { createClicker, parseSettings, type Clicker, type ResourceSlot, type Settings } from "./settings";

const STORAGE_KEY = "input-pet-clicker.settings.v2";

export default function App() {
  return new URLSearchParams(window.location.search).get("window") === "settings" ? <SettingsWindow /> : <WidgetWindow />;
}

function WidgetWindow() {
  const [settings, setSettings] = useState<Settings>(() => parseSettings(localStorage.getItem(STORAGE_KEY)));
  const [inputActive, setInputActive] = useState(false);
  const [activeSlot, setActiveSlot] = useState<ResourceSlot>("active");
  const alternate = useRef(false);
  const keyboardHeld = useRef(false);
  const mouseActive = useRef(false);
  const activeAudio = useRef(new Set<HTMLAudioElement>());
  const openedInitialSettings = useRef(false);

  useEffect(() => {
    const imageSide = Math.ceil(128 * settings.scale);
    void invoke("resize_main_widget", { imageSide, clickerCount: settings.clickers.length });
  }, [settings.scale, settings.clickers.length]);

  useEffect(() => {
    let previousTick = Date.now();
    const heartbeat = window.setInterval(() => {
      const now = Date.now();
      if (now - previousTick > 8_000) {
        void invoke("reset_input_state");
      }
      previousTick = now;
    }, 2_000);
    return () => window.clearInterval(heartbeat);
  }, []);

  useEffect(() => {
    const resetAfterVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      keyboardHeld.current = false;
      mouseActive.current = false;
      setInputActive(false);
      void invoke("reset_input_state");
    };
    document.addEventListener("visibilitychange", resetAfterVisibilityChange);
    return () => document.removeEventListener("visibilitychange", resetAfterVisibilityChange);
  }, []);

  useEffect(() => {
    const hasImage = settings.clickers.some((clicker) => Object.values(clicker.resources).some(Boolean));
    if (!hasImage && !openedInitialSettings.current) {
      openedInitialSettings.current = true;
      void invoke("open_settings_window");
    }
  }, [settings.clickers]);

  useEffect(() => {
    const unlisten = listen<Settings>("settings-updated", ({ payload }) => setSettings(payload));
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setSettings(parseSettings(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => {
      void unlisten.then((remove) => remove());
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const playRandomSound = () => {
      if (!settings.soundEnabled || settings.sounds.length === 0) return;
      const path = settings.sounds[Math.floor(Math.random() * settings.sounds.length)];
      const audio = new Audio(convertFileSrc(path));
      audio.preload = "auto";
      const release = () => activeAudio.current.delete(audio);
      audio.addEventListener("ended", release, { once: true });
      audio.addEventListener("error", () => {
        release();
        void emit("sound-playback-error", "음원을 재생할 수 없습니다. 지원 형식과 파일 상태를 확인하세요.");
      }, { once: true });
      activeAudio.current.add(audio);
      void audio.play().catch(() => {
        release();
        void emit("sound-playback-error", "음원 재생이 차단되었습니다. 설정을 다시 열거나 다른 음원 형식을 사용하세요.");
      });
    };
    const unlisten = listen<{ kind: "keyboard" | "mouse"; state: "down" | "up" }>("input-event", ({ payload }) => {
      const refresh = () => setInputActive(keyboardHeld.current || mouseActive.current);
      if (payload.state === "up") {
        if (payload.kind === "keyboard") keyboardHeld.current = false;
        else mouseActive.current = false;
        refresh();
        return;
      }
      if (settings.clickers.some((clicker) => clicker.resources.active_alt)) {
        alternate.current = !alternate.current;
        setActiveSlot(alternate.current ? "active_alt" : "active");
      } else {
        setActiveSlot("active");
      }
      if (payload.kind === "keyboard") {
        keyboardHeld.current = true;
        refresh();
      } else {
        mouseActive.current = true;
        refresh();
      }
      playRandomSound();
    });
    const unlistenReset = listen("input-reset", () => {
      keyboardHeld.current = false;
      mouseActive.current = false;
      setInputActive(false);
    });
    return () => {
      void unlisten.then((remove) => remove());
      void unlistenReset.then((remove) => remove());
    };
  }, [settings.clickers, settings.soundEnabled, settings.sounds]);

  const columns = settings.clickers.length > 2 ? 2 : settings.clickers.length;
  return (
    <main className="widget-shell" data-tauri-drag-region="" onContextMenu={(event) => event.preventDefault()}>
      <div className="pet-grid" data-tauri-drag-region="" style={{ gridTemplateColumns: `repeat(${columns}, ${128 * settings.scale}px)` }}>
        {settings.clickers.map((clicker, index) => {
          const imagePath = inputActive ? clicker.resources[activeSlot] ?? clicker.resources.active : clicker.resources.idle;
          const imageSource = imagePath ? convertFileSrc(imagePath) : null;
          return (
            <div key={clicker.id} className={`pet-visual ${imageSource ? "has-image" : "placeholder"}`} data-tauri-drag-region="" style={{ width: `${128 * settings.scale}px`, height: `${128 * settings.scale}px` }}>
              {imageSource ? <img src={imageSource} alt={`클리커 ${index + 1} 입력 반응 이미지`} draggable={false} data-tauri-drag-region="" /> : <span data-tauri-drag-region="">{inputActive ? "✦" : "●"}</span>}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function SettingsWindow() {
  const [settings, setSettings] = useState<Settings>(() => parseSettings(localStorage.getItem(STORAGE_KEY)));
  const [resourceError, setResourceError] = useState<string | null>(null);
  const latestSettings = useRef(settings);
  latestSettings.current = settings;

  useEffect(() => {
    void emit("settings-updated", settings);
    const timer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), 150);
    return () => window.clearTimeout(timer);
  }, [settings]);

  useEffect(() => {
    const persistNow = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(latestSettings.current));
    window.addEventListener("pagehide", persistNow);
    return () => {
      persistNow();
      window.removeEventListener("pagehide", persistNow);
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("sound-playback-error", ({ payload }) => setResourceError(payload));
    return () => void unlisten.then((remove) => remove());
  }, []);

  async function chooseResource(clicker: Clicker, slot: ResourceSlot) {
    setResourceError(null);
    try {
      const file = await open({ multiple: false, directory: false, filters: [{ name: "이미지", extensions: ["png", "webp", "jpg", "jpeg"] }] });
      if (!file || Array.isArray(file)) return;
      const path = await invoke<string>("import_resource", {
        sourcePath: file,
        clickerId: clicker.id,
        slot,
        previousPath: clicker.resources[slot],
      });
      setSettings((current) => ({
        ...current,
        clickers: current.clickers.map((currentClicker) => currentClicker.id === clicker.id
          ? { ...currentClicker, resources: { ...currentClicker.resources, [slot]: path } }
          : currentClicker),
      }));
    } catch (error) {
      setResourceError(typeof error === "string" ? error : "이미지를 적용하지 못했습니다.");
    }
  }

  async function chooseSounds() {
    setResourceError(null);
    try {
      const files = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "음원", extensions: ["mp3", "wav", "m4a", "aac", "ogg"] }],
      });
      if (!files || !Array.isArray(files) || files.length === 0) return;
      const paths = await invoke<string[]>("import_sounds", { sourcePaths: files });
      setSettings((current) => ({ ...current, sounds: [...new Set([...current.sounds, ...paths])]}));
    } catch (error) {
      setResourceError(typeof error === "string" ? error : "음원을 적용하지 못했습니다.");
    }
  }

  async function clearSounds() {
    setResourceError(null);
    try {
      await invoke("clear_sounds", { soundPaths: settings.sounds });
      setSettings((current) => ({ ...current, sounds: [] }));
    } catch (error) {
      setResourceError(typeof error === "string" ? error : "등록 음원을 지우지 못했습니다.");
    }
  }

  function addClicker() {
    setSettings((current) => current.clickers.length >= 4 ? current : {
      ...current,
      clickers: [...current.clickers, createClicker(`clicker-${Date.now()}`)],
    });
  }

  function removeClicker() {
    setSettings((current) => current.clickers.length <= 1 ? current : {
      ...current,
      clickers: current.clickers.slice(0, -1),
    });
  }

  return (
    <main className="settings-window" onContextMenu={(event) => event.preventDefault()}>
      <h1>클리커 설정</h1>
      <section className="clicker-controls" aria-label="클리커 관리">
        <span>활성 클리커: {settings.clickers.length}/4</span>
        <div>
          <button onClick={addClicker} disabled={settings.clickers.length >= 4}>클리커 추가</button>
          <button className="secondary-button" onClick={removeClicker} disabled={settings.clickers.length <= 1}>클리커 제거</button>
        </div>
      </section>
      <h2>공통 이미지 크기</h2>
      <input aria-label="이미지 크기" type="range" min="0.5" max="4" step="0.1" value={settings.scale} onChange={(event) => setSettings((current) => ({ ...current, scale: Number(event.target.value) }))} />
      <section className="clicker-list" aria-label="클리커별 이미지 설정">
        {settings.clickers.map((clicker, index) => (
          <section className="clicker-card" key={clicker.id}>
            <h2>클리커 {index + 1}</h2>
            <div className="resource-actions">
              <button onClick={() => void chooseResource(clicker, "idle")}>기본 이미지 선택</button>
              <button onClick={() => void chooseResource(clicker, "active")}>입력 이미지 선택</button>
              <button onClick={() => void chooseResource(clicker, "active_alt")}>보조 이미지 선택</button>
            </div>
          </section>
        ))}
      </section>
      <section className="sound-settings" aria-label="사운드 효과 설정">
        <button
          type="button"
          className={`sound-toggle ${settings.soundEnabled ? "is-enabled" : ""}`}
          aria-pressed={settings.soundEnabled}
          onClick={() => setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}
        >
          입력 사운드: {settings.soundEnabled ? "켜짐" : "꺼짐"}
        </button>
        <button onClick={() => void chooseSounds()}>음원 파일 추가</button>
        <div className="sound-summary">등록된 음원: {settings.sounds.length}개</div>
        {settings.sounds.length > 0 && <button className="secondary-button" onClick={() => void clearSounds()}>등록 음원 모두 지우기</button>}
      </section>
      {resourceError && <p role="alert">{resourceError}</p>}
    </main>
  );
}
