use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use rdev::{listen, Button, Event, EventType, Key};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputEvent {
    kind: &'static str,
    state: &'static str,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        // macOS에서 rdev의 키보드 레이아웃 변환은 이 리스너 스레드가
        // 메인 스레드가 아님을 명시해야 안전하게 동작한다.
        #[cfg(target_os = "macos")]
        rdev::set_is_main_thread(false);

        let _ = app.emit("input-listener-status", "starting");
        let listener_app = app.clone();
        let pressed_keys = Arc::new(Mutex::new(HashSet::new()));
        let pressed_buttons = Arc::new(Mutex::new(HashSet::new()));
        if let Err(error) = listen(move |event| {
            emit_input_event(
                &listener_app,
                &pressed_keys,
                &pressed_buttons,
                event,
            )
        }) {
            eprintln!("전역 입력 감지를 시작하지 못했습니다: {error:?}");
            let _ = app.emit("input-listener-status", "error");
        }
    });
}

fn emit_input_event(
    app: &AppHandle,
    pressed_keys: &Arc<Mutex<HashSet<Key>>>,
    pressed_buttons: &Arc<Mutex<HashSet<Button>>>,
    event: Event,
) {
    let input = match event.event_type {
        EventType::KeyPress(key) => {
            let mut keys = pressed_keys.lock().expect("키 입력 상태 잠금에 실패했습니다.");
            if keys.insert(key) {
                Some(InputEvent { kind: "keyboard", state: "down" })
            } else {
                None
            }
        }
        EventType::KeyRelease(key) => {
            let mut keys = pressed_keys.lock().expect("키 입력 상태 잠금에 실패했습니다.");
            keys.remove(&key);
            if keys.is_empty() {
                Some(InputEvent { kind: "keyboard", state: "up" })
            } else {
                None
            }
        }
        EventType::ButtonPress(button) => {
            let mut buttons = pressed_buttons.lock().expect("마우스 입력 상태 잠금에 실패했습니다.");
            if buttons.insert(button) {
                Some(InputEvent { kind: "mouse", state: "down" })
            } else {
                None
            }
        }
        EventType::ButtonRelease(button) => {
            let mut buttons = pressed_buttons.lock().expect("마우스 입력 상태 잠금에 실패했습니다.");
            buttons.remove(&button);
            if buttons.is_empty() {
                Some(InputEvent { kind: "mouse", state: "up" })
            } else {
                None
            }
        }
        EventType::ListenerReset => {
            pressed_keys
                .lock()
                .expect("키 입력 상태 잠금에 실패했습니다.")
                .clear();
            pressed_buttons
                .lock()
                .expect("마우스 입력 상태 잠금에 실패했습니다.")
                .clear();
            let _ = app.emit("input-reset", ());
            None
        }
        _ => None,
    };

    if let Some(input) = input {
        let _ = app.emit("input-event", input);
    }
}
