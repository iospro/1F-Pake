use crate::app::window::open_tab_window;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Listener, Manager, Url, WebviewWindow};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TabRecord {
    pub id: u32,
    pub label: String,
    pub title: String,
    pub path: String,
    pub active: bool,
}

#[derive(Default)]
struct TabState {
    next_id: u32,
    active_tab_id: Option<u32>,
    tabs: Vec<TabRecord>,
}

pub struct TabManager {
    inner: Mutex<TabState>,
}

impl TabManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(TabState {
                next_id: 1,
                active_tab_id: None,
                tabs: Vec::new(),
            }),
        }
    }

    fn snapshot(&self) -> Vec<TabRecord> {
        let state = self.inner.lock().unwrap();
        state.tabs.clone()
    }

    fn emit_snapshot(app: &AppHandle, tabs: &[TabRecord]) {
        let payload = TabSnapshotResponse {
            version: current_version(),
            tabs: tabs.to_vec(),
        };
        let _ = app.emit("pake-tabs:snapshot", payload);
    }

    fn sync_active_flags(state: &mut TabState, active_id: Option<u32>) {
        state.active_tab_id = active_id;
        for tab in &mut state.tabs {
            tab.active = Some(tab.id) == active_id;
        }
    }

    fn record_for_url(id: u32, label: String, url: &Url, active: bool) -> TabRecord {
        let title = url.host_str().unwrap_or(url.as_str()).to_string();
        let path = if url.path().is_empty() {
            "/".to_string()
        } else {
            url.path().to_string()
        };
        TabRecord {
            id,
            label,
            title,
            path,
            active,
        }
    }

    fn find_tab_mut<'a>(tabs: &'a mut [TabRecord], id: u32) -> Option<&'a mut TabRecord> {
        tabs.iter_mut().find(|tab| tab.id == id)
    }

    pub(crate) fn tab_label(id: u32) -> String {
        if id == 1 {
            "pake".to_string()
        } else {
            format!("pake-tab-{id}")
        }
    }

    fn window_for(app: &AppHandle, tab: &TabRecord) -> Option<WebviewWindow> {
        app.get_webview_window(&tab.label)
    }

}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TabSnapshotResponse {
    pub version: u64,
    pub tabs: Vec<TabRecord>,
}

fn current_version() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Deserialize)]
pub struct OpenTabParams {
    pub url: String,
}

#[derive(Deserialize)]
pub struct SwitchTabParams {
    pub id: u32,
}

#[derive(Deserialize)]
pub struct CloseTabParams {
    pub id: u32,
}

#[derive(Deserialize)]
pub struct SetTabTitleParams {
    pub id: u32,
    pub title: String,
}

#[derive(Deserialize)]
pub struct SetTabPathParams {
    pub id: u32,
    pub path: String,
}

#[tauri::command]
pub fn get_tabs(app: AppHandle) -> Result<TabSnapshotResponse, String> {
    let manager = app.state::<TabManager>();
    Ok(TabSnapshotResponse {
        version: current_version(),
        tabs: manager.snapshot(),
    })
}

#[tauri::command]
pub fn open_tab(app: AppHandle, params: OpenTabParams) -> Result<TabRecord, String> {
    let url = Url::parse(&params.url).map_err(|e| e.to_string())?;
    let manager = app.state::<TabManager>();
    let mut state = manager.inner.lock().unwrap();
    let id = state.next_id;
    state.next_id += 1;
    let label = TabManager::tab_label(id);
    let _window = open_tab_window(&app, &label, url.clone()).map_err(|e| e.to_string())?;
    let record = TabRecord {
        id,
        label,
        title: url.host_str().unwrap_or(url.as_str()).to_string(),
        path: url.path().to_string(),
        active: false,
    };
    state.tabs.push(record.clone());
    let snapshot = state.tabs.clone();
    drop(state);
    TabManager::emit_snapshot(&app, &snapshot);
    Ok(record)
}

#[tauri::command]
pub fn switch_tab(app: AppHandle, params: SwitchTabParams) -> Result<TabRecord, String> {
    let manager = app.state::<TabManager>();
    let mut state = manager.inner.lock().unwrap();
    let tab = state
        .tabs
        .iter()
        .find(|tab| tab.id == params.id)
        .cloned()
        .ok_or_else(|| format!("Tab {} not found", params.id))?;

    let previous_id = state.active_tab_id;
    if previous_id == Some(tab.id) {
        return Ok(tab);
    }

    if let Some(previous) = previous_id.and_then(|id| state.tabs.iter().find(|tab| tab.id == id).cloned()) {
        if let Some(window) = TabManager::window_for(&app, &previous) {
            let _ = window.hide();
        }
    }

    if let Some(window) = TabManager::window_for(&app, &tab) {
        let _ = window.show();
        let _ = window.set_focus();
    }

    TabManager::sync_active_flags(&mut state, Some(tab.id));
    let updated = state.tabs.iter().find(|record| record.id == tab.id).cloned().unwrap_or(tab);
    let snapshot = state.tabs.clone();
    drop(state);
    TabManager::emit_snapshot(&app, &snapshot);
    Ok(updated)
}

#[tauri::command]
pub fn close_tab(app: AppHandle, params: CloseTabParams) -> Result<(), String> {
    if params.id == 1 {
        return Ok(());
    }
    let manager = app.state::<TabManager>();
    let mut state = manager.inner.lock().unwrap();
    let index = state
        .tabs
        .iter()
        .position(|tab| tab.id == params.id)
        .ok_or_else(|| format!("Tab {} not found", params.id))?;
    let tab = state.tabs.remove(index);
    if let Some(window) = app.get_webview_window(&tab.label) {
        let _ = window.hide();
        let _ = window.close();
    }
    let next_active = if state.active_tab_id == Some(params.id) {
        state.tabs.first().map(|tab| tab.id)
    } else {
        state.active_tab_id
    };
    TabManager::sync_active_flags(&mut state, next_active);
    let snapshot = state.tabs.clone();
    drop(state);
    TabManager::emit_snapshot(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub fn set_tab_title(app: AppHandle, params: SetTabTitleParams) -> Result<(), String> {
    let manager = app.state::<TabManager>();
    let mut state = manager.inner.lock().unwrap();
    let tab = TabManager::find_tab_mut(&mut state.tabs, params.id)
        .ok_or_else(|| format!("Tab {} not found", params.id))?;
    tab.title = params.title;
    let snapshot = state.tabs.clone();
    drop(state);
    TabManager::emit_snapshot(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub fn set_tab_path(app: AppHandle, params: SetTabPathParams) -> Result<(), String> {
    let manager = app.state::<TabManager>();
    let mut state = manager.inner.lock().unwrap();
    let tab = TabManager::find_tab_mut(&mut state.tabs, params.id)
        .ok_or_else(|| format!("Tab {} not found", params.id))?;
    tab.path = params.path;
    let snapshot = state.tabs.clone();
    drop(state);
    TabManager::emit_snapshot(&app, &snapshot);
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TabBridgeRequest {
    pub request_id: String,
    pub action: String,
    pub params: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TabBridgeResponse<T> {
    pub request_id: String,
    pub ok: bool,
    pub action: String,
    pub data: Option<T>,
    pub error: Option<String>,
}

pub fn register_tab_bridge(app: &AppHandle) {
    let app_handle = app.clone();
    app.listen("pake.tabs:request", move |event| {
        let payload = event.payload();
        if payload.is_empty() {
            return;
        }
        let Ok(request) = serde_json::from_str::<TabBridgeRequest>(payload) else {
            return;
        };
        let response_event = "pake.tabs:response";
        match request.action.as_str() {
            "get_tabs" => {
                let response = match get_tabs(app_handle.clone()) {
                    Ok(data) => TabBridgeResponse {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(data),
                        error: None,
                    },
                    Err(error) => TabBridgeResponse::<TabSnapshotResponse> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            "open_tab" => {
                let response = match serde_json::from_value::<OpenTabParams>(request.params)
                    .map_err(|error| error.to_string())
                    .and_then(|params| open_tab(app_handle.clone(), params))
                {
                    Ok(data) => TabBridgeResponse {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(data),
                        error: None,
                    },
                    Err(error) => TabBridgeResponse::<TabRecord> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            "switch_tab" => {
                let response = match serde_json::from_value::<SwitchTabParams>(request.params)
                    .map_err(|error| error.to_string())
                    .and_then(|params| switch_tab(app_handle.clone(), params))
                {
                    Ok(data) => TabBridgeResponse {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(data),
                        error: None,
                    },
                    Err(error) => TabBridgeResponse::<TabRecord> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            "close_tab" => {
                let response = match serde_json::from_value::<CloseTabParams>(request.params)
                    .map_err(|error| error.to_string())
                    .and_then(|params| close_tab(app_handle.clone(), params))
                {
                    Ok(()) => TabBridgeResponse::<serde_json::Value> {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(serde_json::Value::Null),
                        error: None,
                    },
                    Err(error) => TabBridgeResponse::<serde_json::Value> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            "set_tab_title" => {
                let response = match serde_json::from_value::<SetTabTitleParams>(request.params)
                    .map_err(|error| error.to_string())
                    .and_then(|params| set_tab_title(app_handle.clone(), params))
                {
                    Ok(()) => TabBridgeResponse::<serde_json::Value> {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(serde_json::Value::Null),
                        error: None,
                    },
                    Err(error) => TabBridgeResponse::<serde_json::Value> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            "set_tab_path" => {
                let response = match serde_json::from_value::<SetTabPathParams>(request.params)
                    .map_err(|error| error.to_string())
                    .and_then(|params| set_tab_path(app_handle.clone(), params))
                {
                    Ok(()) => TabBridgeResponse::<serde_json::Value> {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(serde_json::Value::Null),
                        error: None,
                    },
                    Err(error) => TabBridgeResponse::<serde_json::Value> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            _ => {
                let response = TabBridgeResponse::<serde_json::Value> {
                    request_id: request.request_id,
                    ok: false,
                    action: request.action,
                    data: None,
                    error: Some("Unknown tab action".to_string()),
                };
                let _ = app_handle.emit(response_event, response);
            }
        }
    });
}
