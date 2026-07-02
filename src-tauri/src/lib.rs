#[cfg_attr(mobile, tauri::mobile_entry_point)]
mod app;
mod util;

use tauri::Manager;
#[cfg(target_os = "linux")]
const PAKE_LINUX_WEBKIT_SAFE_MODE: &str = "PAKE_LINUX_WEBKIT_SAFE_MODE";
#[cfg(target_os = "linux")]
const WEBKIT_DISABLE_DMABUF_RENDERER: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
#[cfg(target_os = "linux")]
const WEBKIT_DISABLE_COMPOSITING_MODE: &str = "WEBKIT_DISABLE_COMPOSITING_MODE";

use app::{menu, window::MultiWindowState};
use util::get_pake_config;

#[cfg(any(target_os = "linux", test))]
fn is_disabled_env_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "0" | "false" | "off" | "no" | "native" | "disabled"
    )
}

#[cfg(any(target_os = "linux", test))]
fn is_non_empty_env_value(value: Option<&str>) -> bool {
    value.map(|value| !value.trim().is_empty()).unwrap_or(false)
}

#[cfg(any(target_os = "linux", test))]
fn contains_niri(value: &str) -> bool {
    value
        .split([':', ';', ',', ' '])
        .any(|part| part.eq_ignore_ascii_case("niri"))
}

#[cfg(any(target_os = "linux", test))]
fn should_enable_linux_webkit_safe_mode_from_values(
    safe_mode: Option<&str>,
    niri_socket: Option<&str>,
    desktop_values: &[Option<&str>],
) -> bool {
    if let Some(value) = safe_mode.filter(|value| !value.trim().is_empty()) {
        return !is_disabled_env_value(value);
    }

    let is_niri_session = is_non_empty_env_value(niri_socket)
        || desktop_values
            .iter()
            .flatten()
            .any(|value| contains_niri(value));

    !is_niri_session
}

#[cfg(target_os = "linux")]
fn apply_linux_webkit_runtime_flags() {
    let safe_mode = std::env::var(PAKE_LINUX_WEBKIT_SAFE_MODE).ok();
    if safe_mode.as_deref().is_some_and(is_disabled_env_value) {
        std::env::remove_var(WEBKIT_DISABLE_DMABUF_RENDERER);
        std::env::remove_var(WEBKIT_DISABLE_COMPOSITING_MODE);
        return;
    }

    let desktop_values = [
        std::env::var("XDG_CURRENT_DESKTOP").ok(),
        std::env::var("XDG_SESSION_DESKTOP").ok(),
        std::env::var("DESKTOP_SESSION").ok(),
    ];
    let desktop_refs = desktop_values
        .iter()
        .map(|value| value.as_deref())
        .collect::<Vec<_>>();

    if !should_enable_linux_webkit_safe_mode_from_values(
        safe_mode.as_deref(),
        std::env::var("NIRI_SOCKET").ok().as_deref(),
        &desktop_refs,
    ) {
        return;
    }

    if std::env::var(WEBKIT_DISABLE_DMABUF_RENDERER).is_err() {
        std::env::set_var(WEBKIT_DISABLE_DMABUF_RENDERER, "1");
    }
    if std::env::var(WEBKIT_DISABLE_COMPOSITING_MODE).is_err() {
        std::env::set_var(WEBKIT_DISABLE_COMPOSITING_MODE, "1");
    }
}

pub fn run_app() {
    #[cfg(target_os = "linux")]
    apply_linux_webkit_runtime_flags();

    let (pake_config, tauri_config) = get_pake_config();
    let tauri_app = tauri::Builder::default();

    let show_system_tray = pake_config.show_system_tray();
    let _init_fullscreen = pake_config.windows[0].fullscreen;
    let activation_shortcut = pake_config.windows[0].activation_shortcut.clone();
    let hide_on_close = pake_config.windows[0].hide_on_close;
    let start_to_tray = pake_config.windows[0].start_to_tray && show_system_tray;
    let _multi_window = pake_config.multi_window;
    let _enable_find = pake_config.windows[0].enable_find;
    let app_builder = tauri_app
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    app_builder
        .invoke_handler(tauri::generate_handler![
            init_account_bridge,
            app::account_store::list_accounts,
            app::account_store::delete_account,
            app::invoke::download_file,
            app::account_store::set_active_account,
            app::account_store::upsert_account,
            app::invoke::send_notification,
            app::invoke::increment_dock_badge,
            app::invoke::set_dock_badge,
            app::invoke::set_dock_badge_label,
            app::invoke::clear_dock_badge,
            app::invoke::update_theme_mode,
            app::invoke::clear_cache_and_restart,
        ])
        .setup(move |app| {
            app.manage(MultiWindowState::new(
                pake_config.clone(),
                tauri_config.clone(),
            ));
            #[cfg(target_os = "macos")]
            {
                menu::set_app_menu(app.app_handle(), _multi_window, _enable_find)?;
                app.on_menu_event(move |app_handle, event| {
                    menu::handle_menu_click(app_handle, event.id().as_ref());
                });
            }
            let _ = app::setup::set_system_tray(
                app.app_handle(),
                show_system_tray,
                &pake_config.system_tray_path,
                _init_fullscreen,
                _multi_window,
            );
            let _ = app::setup::set_global_shortcut(app.app_handle(), activation_shortcut, _init_fullscreen);
            let _ = app::window::set_window(
                app.app_handle(),
                &pake_config,
                &tauri_config,
            )?;
            Ok(())
        })
        .on_window_event(move |_window, _event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                if hide_on_close && _window.label() == "pake" {
                    let window = _window.clone();
                    tauri::async_runtime::spawn(async move {
                        #[cfg(target_os = "macos")]
                        {
                            if window.is_fullscreen().unwrap_or(false) {
                                let _ = window.set_fullscreen(false);
                                tokio::time::sleep(std::time::Duration::from_millis(900)).await;
                            }
                        }
                        #[cfg(target_os = "linux")]
                        {
                            if window.is_fullscreen().unwrap_or(false) {
                                let _ = window.set_fullscreen(false);
                                let _ = window.set_focus();
                            }
                        }
                        #[cfg(not(target_os = "macos"))]
                        let _ = window.minimize();
                        let _ = window.hide();
                    });
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("[Pake] Fatal error while building Tauri application: {error}");
            std::process::exit(1);
        })
        .run(|_, _| {});
}

#[tauri::command]
fn init_account_bridge(app: tauri::AppHandle) -> Result<(), String> {
    app::account_store::register_account_bridge(&app);
    app::account_store::emit_current_accounts_snapshot(&app)?;
    Ok(())
}

pub fn run() {
    run_app()
}
