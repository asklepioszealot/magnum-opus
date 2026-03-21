use std::{
  env,
  process::Command,
  sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[path = "../../../../tooling/rust/desktop_discovery.rs"]
mod desktop_discovery;

const LAUNCH_ARG_PREFIX: &str = "--study-shell-launch=";
const RETURN_ARG_PREFIX: &str = "--study-shell-return=";
const NATIVE_LAUNCH_EVENT_NAME: &str = "magnum-study-shell-launch";
const PENDING_NATIVE_LAUNCH_KEY: &str = "__MAGNUM_PENDING_STUDY_SHELL_LAUNCH__";

struct StartupShellLaunchPayload(Mutex<Option<String>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReturnToShellRequest {
  return_path: String,
  encoded_payload: String,
}

#[derive(Debug, Serialize)]
struct ReturnToShellResponse {
  mode: &'static str,
  target: String,
}

fn extract_launch_payload_arg() -> Option<String> {
  env::args()
    .find_map(|arg| arg.strip_prefix(LAUNCH_ARG_PREFIX).map(str::to_owned))
}

fn dispatch_startup_launch_payload<R: tauri::Runtime>(
  webview: &tauri::Webview<R>,
  encoded_payload: &str,
) -> tauri::Result<()> {
  let encoded_payload_json =
    serde_json::to_string(encoded_payload).unwrap_or_else(|_| "\"\"".to_owned());
  let event_name_json =
    serde_json::to_string(NATIVE_LAUNCH_EVENT_NAME).unwrap_or_else(|_| "\"\"".to_owned());
  let pending_launch_key_json =
    serde_json::to_string(PENDING_NATIVE_LAUNCH_KEY).unwrap_or_else(|_| "\"\"".to_owned());
  let script = format!(
    "window[{pending_launch_key_json}] = {{ encodedPayload: {encoded_payload_json} }};\
window.dispatchEvent(new CustomEvent({event_name_json}, {{ detail: {{ encodedPayload: {encoded_payload_json} }} }}));"
  );
  webview.eval(&script)?;
  Ok(())
}

#[tauri::command]
fn return_to_study_shell(request: ReturnToShellRequest) -> Result<ReturnToShellResponse, String> {
  let app_root = desktop_discovery::resolve_app_root(&request.return_path).ok_or_else(|| {
    format!(
      "Workspace içindeki study-shell klasörü bulunamadı: {}",
      request.return_path
    )
  })?;

  let executable = desktop_discovery::resolve_desktop_executable(&app_root)
    .map_err(|error| format!("Study Shell için çalıştırılabilir desktop build bulunamadı. {error}"))?;

  Command::new(&executable.path)
    .arg(format!("{RETURN_ARG_PREFIX}{}", request.encoded_payload))
    .spawn()
    .map_err(|error| format!("Study Shell başlatılamadı: {error}"))?;

  Ok(ReturnToShellResponse {
    mode: executable.source,
    target: executable.path.display().to_string(),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let startup_launch_payload = extract_launch_payload_arg();

  tauri::Builder::default()
    .manage(StartupShellLaunchPayload(Mutex::new(startup_launch_payload)))
    .on_page_load(|webview, _payload| {
      if webview.label() != "main" {
        return;
      }

      let state = webview.app_handle().state::<StartupShellLaunchPayload>();
      let Ok(mut startup_launch_payload) = state.0.lock() else {
        return;
      };

      let Some(encoded_payload) = startup_launch_payload.take() else {
        return;
      };

      let _ = dispatch_startup_launch_payload(webview, &encoded_payload);
    })
    .invoke_handler(tauri::generate_handler![return_to_study_shell])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
