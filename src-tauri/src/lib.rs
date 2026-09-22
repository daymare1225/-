mod input;

use std::{fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalSize, Manager, WindowEvent,
};

#[tauri::command]
fn import_resource(
    app: AppHandle,
    source_path: String,
    clicker_id: String,
    slot: String,
    previous_path: Option<String>,
) -> Result<String, String> {
    if !matches!(slot.as_str(), "idle" | "active" | "active_alt") {
        return Err("알 수 없는 이미지 슬롯입니다.".into());
    }
    if clicker_id.is_empty() || clicker_id.len() > 64 || !clicker_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') {
        return Err("유효하지 않은 클리커 번호입니다.".into());
    }

    let source = Path::new(&source_path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| matches!(value.as_str(), "png" | "webp" | "jpg" | "jpeg"))
        .ok_or_else(|| "PNG, WebP 또는 JPEG 이미지 파일만 사용할 수 있습니다.".to_string())?;
    let metadata = fs::metadata(source).map_err(|_| "선택한 이미지 파일을 읽을 수 없습니다.".to_string())?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err("이미지는 10MB 이하만 사용할 수 있습니다.".into());
    }

    let resource_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "앱 데이터 폴더를 찾을 수 없습니다.".to_string())?
        .join("resources");
    fs::create_dir_all(&resource_dir).map_err(|_| "이미지 저장 폴더를 만들 수 없습니다.".to_string())?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "이미지 저장 이름을 만들 수 없습니다.".to_string())?
        .as_nanos();
    let destination = resource_dir.join(format!("{clicker_id}-{slot}-{nonce}.{extension}"));
    fs::copy(source, &destination).map_err(|_| "이미지를 앱 폴더로 복사하지 못했습니다.".to_string())?;

    if let Some(previous_path) = previous_path {
        let canonical_resource_dir = fs::canonicalize(&resource_dir)
            .map_err(|_| "이미지 저장 폴더를 확인할 수 없습니다.".to_string())?;
        if let Ok(previous) = fs::canonicalize(previous_path) {
            if previous.parent() == Some(canonical_resource_dir.as_path()) {
                let _ = fs::remove_file(previous);
            }
        }
    }
    Ok(destination.to_string_lossy().into_owned())
}

const MAX_SOUND_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_SOUND_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

fn sound_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "앱 데이터 폴더를 찾을 수 없습니다.".to_string())?
        .join("sounds");
    fs::create_dir_all(&directory).map_err(|_| "음원 저장 폴더를 만들 수 없습니다.".to_string())?;
    Ok(directory)
}

fn total_sound_bytes(directory: &Path) -> Result<u64, String> {
    fs::read_dir(directory)
        .map_err(|_| "음원 저장 폴더를 읽을 수 없습니다.".to_string())?
        .try_fold(0_u64, |total, entry| {
            let size = entry
                .map_err(|_| "음원 파일 정보를 읽을 수 없습니다.".to_string())?
                .metadata()
                .map_err(|_| "음원 파일 정보를 읽을 수 없습니다.".to_string())?
                .len();
            Ok::<u64, String>(total.saturating_add(size))
        })
}

#[tauri::command]
fn import_sounds(app: AppHandle, source_paths: Vec<String>) -> Result<Vec<String>, String> {
    if source_paths.is_empty() {
        return Ok(Vec::new());
    }
    let sound_dir = sound_dir(&app)?;
    let sources = source_paths
        .into_iter()
        .map(|source_path| {
            let source = Path::new(&source_path);
            let extension = source
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .filter(|value| matches!(value.as_str(), "mp3" | "wav" | "m4a" | "aac" | "ogg"))
                .ok_or_else(|| "MP3, WAV, M4A, AAC 또는 OGG 음원만 사용할 수 있습니다.".to_string())?;
            let metadata = fs::metadata(source).map_err(|_| "선택한 음원 파일을 읽을 수 없습니다.".to_string())?;
            if metadata.len() > MAX_SOUND_FILE_BYTES {
                return Err("음원은 파일당 20MB 이하만 사용할 수 있습니다.".to_string());
            }
            Ok((source.to_path_buf(), extension, metadata.len()))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let incoming_bytes = sources.iter().map(|(_, _, size)| size).sum::<u64>();
    if total_sound_bytes(&sound_dir)?.saturating_add(incoming_bytes) > MAX_SOUND_TOTAL_BYTES {
        return Err("등록 음원의 총 용량은 100MB 이하만 사용할 수 있습니다.".to_string());
    }

    sources
        .into_iter()
        .enumerate()
        .map(|(index, (source, extension, _))| {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "음원 저장 이름을 만들 수 없습니다.".to_string())?
                .as_nanos();
            let destination = sound_dir.join(format!("sound-{nonce}-{index}.{extension}"));
            fs::copy(&source, &destination).map_err(|_| "음원을 앱 데이터 폴더로 복사하지 못했습니다.".to_string())?;
            Ok(destination.to_string_lossy().into_owned())
        })
        .collect()
}

#[tauri::command]
fn clear_sounds(app: AppHandle, sound_paths: Vec<String>) -> Result<(), String> {
    let sound_dir = fs::canonicalize(sound_dir(&app)?)
        .map_err(|_| "음원 저장 폴더를 확인할 수 없습니다.".to_string())?;
    for sound_path in sound_paths {
        let Ok(path) = fs::canonicalize(&sound_path) else {
            continue;
        };
        if path.parent() == Some(sound_dir.as_path())
            && path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("sound-"))
        {
            fs::remove_file(path).map_err(|_| "등록 음원을 지우지 못했습니다.".to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn resize_main_widget(app: AppHandle, image_side: u32, clicker_count: u32) -> Result<(), String> {
    let image_side = image_side.clamp(128, 512);
    let clicker_count = clicker_count.clamp(1, 4);
    let columns = if clicker_count > 2 { 2 } else { clicker_count };
    let rows = clicker_count.div_ceil(columns);
    let width = (image_side * columns + 96).max(220);
    let height = (image_side * rows + 128).max(220);
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "메인 위젯 창을 찾을 수 없습니다.".to_string())?;
    window
        .set_size(LogicalSize::new(width as f64, height as f64))
        .map_err(|_| "위젯 크기를 변경하지 못했습니다.".to_string())
}

#[tauri::command]
fn reset_input_state(app: AppHandle) {
    let _ = app.emit("input-reset", ());
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn show_settings_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![import_resource, import_sounds, clear_sounds, resize_main_widget, reset_input_state, open_settings_window])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_always_on_top(true)?;
            }
            if let Some(window) = app.get_webview_window("settings") {
                let settings_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = settings_window.hide();
                    }
                });
            }

            let toggle = MenuItem::with_id(app, "toggle", "표시 / 숨기기", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "설정", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &settings, &quit])?;
            let icon = app.default_window_icon().cloned().expect("기본 앱 아이콘이 없습니다.");
            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_main_window(app),
                    "settings" => show_settings_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            input::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri 애플리케이션 실행에 실패했습니다.");
}
