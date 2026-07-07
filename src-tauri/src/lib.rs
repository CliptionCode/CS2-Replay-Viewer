use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

fn temp_pb_path() -> PathBuf {
    std::env::temp_dir().join("cs2-replay-data.pb")
}

#[tauri::command]
async fn parse_demo(path: String, app: AppHandle) -> Result<String, String> {
    let sidecar = app.shell()
        .sidecar("cs2-parser")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?;

    let output = sidecar
        .args([&path])
        .output()
        .await
        .map_err(|e| format!("Failed to execute cs2-parser: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Parser failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let response: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

    if response["success"] == false {
        return Err(response["error"].as_str().unwrap_or("Unknown error").to_string());
    }

    let b64 = response["data"].as_str().unwrap_or("");
    let pb_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        b64,
    ).map_err(|e| format!("Failed to decode base64: {}", e))?;

    let pb_path = temp_pb_path();
    std::fs::write(&pb_path, &pb_bytes)
        .map_err(|e| format!("Failed to write protobuf file: {}", e))?;

    Ok(pb_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_file_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("CS2 Demos", &["dem"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    rx.await.map_err(|_| "Dialog cancelled".to_string())
        .map(|opt| opt.map(|f| f.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![parse_demo, open_file_dialog])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}