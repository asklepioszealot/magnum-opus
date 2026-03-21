use std::{
  env,
  io::{Read, Write},
  net::{TcpListener, TcpStream},
  process::Command,
  sync::Mutex,
  thread,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[path = "../../../../tooling/rust/desktop_discovery.rs"]
mod desktop_discovery;

const LAUNCH_ARG_PREFIX: &str = "--study-shell-launch=";
const RETURN_ARG_PREFIX: &str = "--study-shell-return=";
const SINGLE_INSTANCE_ADDR: &str = "127.0.0.1:45231";
const NATIVE_RETURN_EVENT_NAME: &str = "magnum-study-shell-return";
const PENDING_NATIVE_RETURN_KEY: &str = "__MAGNUM_PENDING_STUDY_SHELL_RETURN__";

struct StartupShellReturnPayload(Mutex<Option<String>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchFlowRequest {
  flow_id: String,
  app_path: String,
  encoded_payload: String,
}

#[derive(Debug, Serialize)]
struct LaunchFlowResponse {
  mode: &'static str,
  target: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SingleInstanceMessage {
  kind: String,
  encoded_payload: Option<String>,
}

#[tauri::command]
fn launch_flow_app(request: LaunchFlowRequest) -> Result<LaunchFlowResponse, String> {
  let app_root = desktop_discovery::resolve_app_root(&request.app_path).ok_or_else(|| {
    format!(
      "Workspace içindeki uygulama klasörü bulunamadı: {}",
      request.app_path
    )
  })?;

  let executable = desktop_discovery::resolve_desktop_executable(&app_root).map_err(|error| {
    format!(
      "{} için çalıştırılabilir desktop build bulunamadı. {}",
      request.flow_id, error
    )
  })?;

  Command::new(&executable.path)
    .arg(format!("{LAUNCH_ARG_PREFIX}{}", request.encoded_payload))
    .spawn()
    .map_err(|error| format!("Child app başlatılamadı: {error}"))?;

  Ok(LaunchFlowResponse {
    mode: executable.source,
    target: executable.path.display().to_string(),
  })
}

fn extract_return_payload_arg() -> Option<String> {
  env::args()
    .find_map(|arg| arg.strip_prefix(RETURN_ARG_PREFIX).map(str::to_owned))
}

fn focus_main_window(main_window: &tauri::WebviewWindow) {
  let _ = main_window.unminimize();
  let _ = main_window.show();
  let _ = main_window.set_focus();
}

fn dispatch_return_payload_to_shell(
  app_handle: &tauri::AppHandle,
  encoded_payload: &str,
) -> tauri::Result<()> {
  let Some(main_window) = app_handle.get_webview_window("main") else {
    return Ok(());
  };

  let encoded_payload_json =
    serde_json::to_string(encoded_payload).unwrap_or_else(|_| "\"\"".to_owned());
  let event_name_json =
    serde_json::to_string(NATIVE_RETURN_EVENT_NAME).unwrap_or_else(|_| "\"\"".to_owned());
  let pending_key_json =
    serde_json::to_string(PENDING_NATIVE_RETURN_KEY).unwrap_or_else(|_| "\"\"".to_owned());
  let script = format!(
    "window[{pending_key_json}] = {{ encodedPayload: {encoded_payload_json} }};\
window.dispatchEvent(new CustomEvent({event_name_json}, {{ detail: {{ encodedPayload: {encoded_payload_json} }} }}));"
  );
  main_window.eval(&script)?;
  focus_main_window(&main_window);
  Ok(())
}

fn handle_single_instance_message(
  app_handle: &tauri::AppHandle,
  message: SingleInstanceMessage,
) -> tauri::Result<()> {
  if message.kind == "study-shell-return" {
    if let Some(encoded_payload) = message.encoded_payload.as_deref() {
      dispatch_return_payload_to_shell(app_handle, encoded_payload)?;
    }
    return Ok(());
  }

  if message.kind == "focus" {
    if let Some(main_window) = app_handle.get_webview_window("main") {
      focus_main_window(&main_window);
    }
  }

  Ok(())
}

fn start_single_instance_listener(app_handle: tauri::AppHandle, listener: TcpListener) {
  thread::spawn(move || {
    for incoming in listener.incoming() {
      let Ok(mut stream) = incoming else {
        continue;
      };

      let mut message = String::new();
      if stream.read_to_string(&mut message).is_err() {
        continue;
      }

      let trimmed = message.trim();
      if trimmed.is_empty() {
        continue;
      }

      let Ok(parsed_message) = serde_json::from_str::<SingleInstanceMessage>(trimmed) else {
        continue;
      };

      let _ = handle_single_instance_message(&app_handle, parsed_message);
    }
  });
}

fn forward_to_existing_instance(message: &SingleInstanceMessage) -> bool {
  let Ok(mut stream) = TcpStream::connect(SINGLE_INSTANCE_ADDR) else {
    return false;
  };

  let Ok(serialized_message) = serde_json::to_string(message) else {
    return false;
  };

  if stream.write_all(serialized_message.as_bytes()).is_err() {
    return false;
  }

  stream.flush().is_ok()
}

fn configure_single_instance_bridge(
  app: &mut tauri::App<tauri::Wry>,
  startup_return_payload: Option<&str>,
) -> tauri::Result<bool> {
  let startup_message = SingleInstanceMessage {
    kind: if startup_return_payload.is_some() {
      "study-shell-return".to_owned()
    } else {
      "focus".to_owned()
    },
    encoded_payload: startup_return_payload.map(str::to_owned),
  };

  match TcpListener::bind(SINGLE_INSTANCE_ADDR) {
    Ok(listener) => {
      start_single_instance_listener(app.handle().clone(), listener);
      Ok(false)
    }
    Err(_) => {
      if forward_to_existing_instance(&startup_message) {
        app.handle().exit(0);
        return Ok(true);
      }

      Ok(false)
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let startup_return_payload = extract_return_payload_arg();

  tauri::Builder::default()
    .manage(StartupShellReturnPayload(Mutex::new(startup_return_payload)))
    .on_page_load(|webview, _payload| {
      if webview.label() != "main" {
        return;
      }

      let state = webview.app_handle().state::<StartupShellReturnPayload>();
      let Ok(mut startup_return_payload) = state.0.lock() else {
        return;
      };

      let Some(encoded_payload) = startup_return_payload.take() else {
        return;
      };

      let _ = dispatch_return_payload_to_shell(webview.app_handle(), &encoded_payload);
    })
    .invoke_handler(tauri::generate_handler![launch_flow_app])
    .setup(|app| {
      let startup_return_payload = app
        .handle()
        .state::<StartupShellReturnPayload>()
        .0
        .lock()
        .ok()
        .and_then(|payload| payload.clone());

      if configure_single_instance_bridge(app, startup_return_payload.as_deref())? {
        return Ok(());
      }

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
