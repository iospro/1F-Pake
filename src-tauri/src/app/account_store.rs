use crate::util::get_data_dir;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::SystemTime};
use tauri::{AppHandle, Config, Emitter, Event, Listener};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountRecord {
    pub id: String,
    pub title: String,
    pub host: String,
    pub base_url: String,
    pub active: bool,
    pub credential_state: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct AccountStore {
    active_account_id: Option<String>,
    accounts: Vec<AccountRecord>,
}

fn now_string() -> String {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn store_path(app: &AppHandle, tauri_config: &Config) -> std::io::Result<PathBuf> {
    let package_name = tauri_config
        .product_name
        .clone()
        .unwrap_or_else(|| "pake".to_string());
    Ok(get_data_dir(app, package_name)?.join("accounts.json"))
}

fn load_store(app: &AppHandle, tauri_config: &Config) -> Result<AccountStore, String> {
    let path = store_path(app, tauri_config).map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(AccountStore::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_store(app: &AppHandle, tauri_config: &Config, store: &AccountStore) -> Result<(), String> {
    let path = store_path(app, tauri_config).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

fn emit_snapshot(app: &AppHandle, store: &AccountStore) {
    let _ = app.emit(
        "ru.1forma.accounts.snapshot",
        AccountListResponse {
            active_account_id: store.active_account_id.clone(),
            accounts: store.accounts.clone(),
        },
    );
}

#[derive(Deserialize)]
pub struct UpsertAccountParams {
    pub title: String,
    pub host: String,
}

#[derive(Deserialize)]
pub struct SetActiveAccountParams {
    pub id: String,
}

#[derive(Deserialize)]
pub struct DeleteAccountParams {
    pub id: String,
}

#[derive(Clone, Serialize)]
pub struct AccountListResponse {
  pub active_account_id: Option<String>,
  pub accounts: Vec<AccountRecord>,
}

fn normalize_host(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

fn host_label(host: &str) -> String {
    host.trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string()
}

#[tauri::command]
pub fn list_accounts(app: AppHandle) -> Result<AccountListResponse, String> {
    let tauri_config = app.config().clone();
    let store = load_store(&app, &tauri_config)?;
    Ok(AccountListResponse {
        active_account_id: store.active_account_id,
        accounts: store.accounts,
    })
}

#[tauri::command]
pub fn upsert_account(app: AppHandle, params: UpsertAccountParams) -> Result<AccountRecord, String> {
    let tauri_config = app.config().clone();
    let mut store = load_store(&app, &tauri_config)?;
    let host = normalize_host(&params.host);
    let id = host_label(&host);
    let now = now_string();

    if let Some(existing) = store.accounts.iter_mut().find(|account| account.id == id) {
        existing.title = params.title.clone();
        existing.host = host_label(&host);
        existing.base_url = host.clone();
        existing.updated_at = now.clone();
        existing.active = true;
        existing.credential_state = "new".to_string();
        let updated = existing.clone();
        store.active_account_id = Some(existing.id.clone());
        save_store(&app, &tauri_config, &store)?;
        return Ok(updated);
    }

    for account in &mut store.accounts {
        account.active = false;
    }

    let record = AccountRecord {
        id: id.clone(),
        title: params.title,
        host: host_label(&host),
        base_url: host,
        active: true,
        credential_state: "new".to_string(),
        access_token: None,
        refresh_token: None,
        expires_at: None,
        created_at: now.clone(),
        updated_at: now,
    };

    store.active_account_id = Some(record.id.clone());
    store.accounts.push(record.clone());
    save_store(&app, &tauri_config, &store)?;
    emit_snapshot(&app, &store);
    Ok(record)
}

#[tauri::command]
pub fn set_active_account(app: AppHandle, params: SetActiveAccountParams) -> Result<AccountRecord, String> {
    let tauri_config = app.config().clone();
    let mut store = load_store(&app, &tauri_config)?;

    let mut found = None;
    for account in &mut store.accounts {
        account.active = account.id == params.id;
        if account.active {
            account.updated_at = now_string();
            found = Some(account.clone());
        }
    }

    let account = found.ok_or_else(|| "Account not found".to_string())?;
    store.active_account_id = Some(account.id.clone());
    save_store(&app, &tauri_config, &store)?;
    emit_snapshot(&app, &store);
    Ok(account)
}

#[tauri::command]
pub fn delete_account(app: AppHandle, params: DeleteAccountParams) -> Result<(), String> {
    let tauri_config = app.config().clone();
    let mut store = load_store(&app, &tauri_config)?;
    let before_len = store.accounts.len();

    store.accounts.retain(|account| account.id != params.id);
    if store.accounts.len() == before_len {
        return Err("Account not found".to_string());
    }

    if store
        .active_account_id
        .as_ref()
        .is_some_and(|active_id| active_id == &params.id)
    {
        store.active_account_id = store.accounts.first().map(|account| account.id.clone());
        for account in &mut store.accounts {
            account.active = store
                .active_account_id
                .as_ref()
                .is_some_and(|active_id| active_id == &account.id);
        }
    }

    save_store(&app, &tauri_config, &store)?;
    emit_snapshot(&app, &store);
    Ok(())
}

pub fn emit_current_accounts_snapshot(app: &AppHandle) -> Result<(), String> {
    let tauri_config = app.config().clone();
    let store = load_store(app, &tauri_config)?;
    emit_snapshot(app, &store);
    Ok(())
}

pub fn active_account_base_url(app: &AppHandle) -> Option<String> {
    const FALLBACK_ACTIVE_URL: &str = "https://ru.1forma.ru";
    let tauri_config = app.config().clone();
    let store = load_store(app, &tauri_config).ok()?;
    let active_id = store.active_account_id.as_deref();
    let account = store
        .accounts
        .iter()
        .find(|account| account.active)
        .or_else(|| active_id.and_then(|id| store.accounts.iter().find(|account| account.id == id)))
        .or_else(|| store.accounts.first())?;
    let candidate = account.base_url.trim();
    if candidate.is_empty() {
        eprintln!("[Pake] active account base_url empty, using fallback {FALLBACK_ACTIVE_URL}");
        return Some(FALLBACK_ACTIVE_URL.to_string());
    }
    if candidate.starts_with("http://") || candidate.starts_with("https://") {
        eprintln!("[Pake] active account base_url loaded: {candidate}");
        return Some(candidate.to_string());
    }
    let normalized = format!("https://{candidate}");
    eprintln!("[Pake] active account base_url normalized: {normalized}");
    Some(normalized)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountBridgeRequest {
    pub request_id: String,
    pub action: String,
    pub params: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountBridgeResponse<T> {
    pub request_id: String,
    pub ok: bool,
    pub action: String,
    pub data: Option<T>,
    pub error: Option<String>,
}

pub fn register_account_bridge(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    app.listen("ru.1forma.accounts:request", move |event: Event| {
        let payload = event.payload();
        if payload.is_empty() {
            return;
        }
        let Ok(request) = serde_json::from_str::<AccountBridgeRequest>(payload) else {
            return;
        };

        let response_event = "ru.1forma.accounts:response";
        let tauri_config = app_handle.config().clone();

        match request.action.as_str() {
            "list_accounts" => {
                let result = load_store(&app_handle, &tauri_config).map(|store| AccountListResponse {
                    active_account_id: store.active_account_id,
                    accounts: store.accounts,
                });
                let response = match result {
                    Ok(data) => AccountBridgeResponse {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(data),
                        error: None,
                    },
                    Err(error) => AccountBridgeResponse {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            "upsert_account" => {
                let response = match serde_json::from_value::<UpsertAccountParams>(request.params)
                    .map_err(|error| error.to_string())
                    .and_then(|params| upsert_account(app_handle.clone(), params))
                {
                    Ok(data) => AccountBridgeResponse {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(data),
                        error: None,
                    },
                    Err(error) => AccountBridgeResponse::<AccountRecord> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error.to_string()),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            "set_active_account" => {
                let response = match serde_json::from_value::<SetActiveAccountParams>(request.params)
                    .map_err(|error| error.to_string())
                    .and_then(|params| set_active_account(app_handle.clone(), params))
                {
                    Ok(data) => AccountBridgeResponse {
                        request_id: request.request_id,
                        ok: true,
                        action: request.action,
                        data: Some(data),
                        error: None,
                    },
                    Err(error) => AccountBridgeResponse::<AccountRecord> {
                        request_id: request.request_id,
                        ok: false,
                        action: request.action,
                        data: None,
                        error: Some(error.to_string()),
                    },
                };
                let _ = app_handle.emit(response_event, response);
            }
            _ => {
                let response = AccountBridgeResponse::<serde_json::Value> {
                    request_id: request.request_id,
                    ok: false,
                    action: request.action,
                    data: None,
                    error: Some("Unknown action".to_string()),
                };
                let _ = app_handle.emit(response_event, response);
            }
        }
    });
}
