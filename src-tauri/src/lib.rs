use serde::Serialize;
use std::path::Component;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MapStatus {
    map_name: String,
    vpk_path: Option<String>,
    cache_path: String,
    scene_path: Option<String>,
    ready: bool,
    extractor_available: bool,
    material_warning: Option<String>,
}

struct RunningMapServer {
    root: PathBuf,
    scene_url: String,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
struct MapServerState(Mutex<Option<RunningMapServer>>);

const MAP_BUFFER_SLICE_BYTES: u64 = 64 * 1024 * 1024;
const MAP_CACHE_COMPLETE_MARKER: &str = ".extraction-complete";

fn temp_pb_path() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("cs2-replay-{}-{nonce}.pb", std::process::id()))
}

#[tauri::command]
async fn parse_demo(path: String, app: AppHandle) -> Result<String, String> {
    let pb_path = temp_pb_path();
    let pb_path_arg = pb_path.to_string_lossy().to_string();
    let sidecar = app
        .shell()
        .sidecar("cs2-parser")
        .map_err(|error| format!("Failed to create parser sidecar: {error}"))?;

    let output = sidecar
        .args([path.as_str(), "--output", pb_path_arg.as_str()])
        .output()
        .await
        .map_err(|error| format!("Failed to execute parser: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Parser failed: {stderr}"));
    }
    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Failed to read parser response: {error}"))?;
    if response["success"] == false {
        return Err(response["error"]
            .as_str()
            .unwrap_or("Unknown parser error")
            .to_string());
    }
    if !pb_path.is_file() {
        return Err("Parser completed without writing protobuf output".to_string());
    }
    Ok(pb_path.to_string_lossy().to_string())
}

#[tauri::command]
fn release_replay_file(path: String) -> Result<(), String> {
    let candidate = PathBuf::from(path);
    let name = candidate
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !name.starts_with("cs2-replay-")
        || candidate.parent() != Some(std::env::temp_dir().as_path())
    {
        return Err("Refusing to remove a file outside the replay temp scope".to_string());
    }
    if candidate.exists() {
        std::fs::remove_file(candidate)
            .map_err(|error| format!("Failed to remove replay temp file: {error}"))?;
    }
    Ok(())
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
    rx.await
        .map_err(|_| "Dialog cancelled".to_string())
        .map(|file| file.map(|value| value.to_string()))
}

fn validate_map_name(map_name: &str) -> Result<(), String> {
    if map_name.len() < 4
        || !map_name.starts_with("de_")
        || !map_name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err(format!("Unsupported map name: {map_name}"));
    }
    Ok(())
}

fn resolve_cs2_root(selected: &Path) -> Option<PathBuf> {
    let folder_name_is_correct = selected
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("Counter-Strike Global Offensive"));
    let csgo = selected.join("game").join("csgo");
    let is_install =
        folder_name_is_correct && csgo.join("gameinfo.gi").is_file() && csgo.join("maps").is_dir();
    is_install.then(|| std::fs::canonicalize(selected).unwrap_or_else(|_| selected.to_path_buf()))
}

#[tauri::command]
fn validate_cs2_folder(path: String) -> Result<String, String> {
    resolve_cs2_root(Path::new(&path))
        .map(|root| root.to_string_lossy().to_string())
        .ok_or_else(|| {
            "Select the steamapps\\common\\Counter-Strike Global Offensive folder".to_string()
        })
}

fn find_map_vpk(map_name: &str, game_path: &Path) -> Option<PathBuf> {
    let vpk = game_path
        .join("game")
        .join("csgo")
        .join("maps")
        .join(format!("{map_name}.vpk"));
    vpk.is_file().then_some(vpk)
}

fn vpk_cache_key(vpk: &Path) -> String {
    let metadata = std::fs::metadata(vpk).ok();
    let size = metadata
        .as_ref()
        .map(|value| value.len())
        .unwrap_or_default();
    let modified = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    format!("{size}-{modified}")
}

fn extractor_path(app: &AppHandle) -> Option<PathBuf> {
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tools")
        .join("source2viewer")
        .join("Source2Viewer-CLI.exe");
    if development.is_file() {
        return Some(development);
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|root| {
            root.join("tools")
                .join("source2viewer")
                .join("Source2Viewer-CLI.exe")
        })
        .filter(|path| path.is_file())
}

fn map_paths(
    map_name: &str,
    vpk: Option<&Path>,
    app: &AppHandle,
) -> Result<(PathBuf, PathBuf), String> {
    let cache_key = vpk
        .map(vpk_cache_key)
        .unwrap_or_else(|| "unknown".to_string());
    let cache = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app cache: {error}"))?
        .join("maps")
        .join(map_name)
        .join(cache_key);
    let scene = cache.join("maps").join(format!("{map_name}.gltf"));
    let scene = if scene.is_file() && cache.join(MAP_CACHE_COMPLETE_MARKER).is_file() {
        ensure_streamable_gltf(&scene)?
    } else {
        scene
    };
    Ok((cache, scene))
}

fn ensure_streamable_gltf(scene: &Path) -> Result<PathBuf, String> {
    let stem = scene
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Map scene has an invalid file name".to_string())?;
    let stream_scene = scene.with_file_name(format!("{stem}.stream.gltf"));
    if stream_scene.is_file() {
        return Ok(stream_scene);
    }

    let data = std::fs::read(scene)
        .map_err(|error| format!("Failed to read map glTF for streaming: {error}"))?;
    let mut document: serde_json::Value = serde_json::from_slice(&data)
        .map_err(|error| format!("Failed to parse map glTF for streaming: {error}"))?;
    let buffers = document
        .get("buffers")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Map glTF does not contain buffers".to_string())?;
    if buffers.len() != 1 {
        return Ok(scene.to_path_buf());
    }
    let source_uri = buffers[0]
        .get("uri")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Map glTF buffer is embedded or has no URI".to_string())?
        .to_string();
    let source_length = buffers[0]
        .get("byteLength")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| "Map glTF buffer has no byte length".to_string())?;
    if source_length <= MAP_BUFFER_SLICE_BYTES {
        return Ok(scene.to_path_buf());
    }

    let views = document
        .get("bufferViews")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Map glTF has no buffer views".to_string())?;
    let mut ordered_views = Vec::with_capacity(views.len());
    for (index, view) in views.iter().enumerate() {
        if view.get("buffer").and_then(|value| value.as_u64()) != Some(0) {
            return Ok(scene.to_path_buf());
        }
        let offset = view
            .get("byteOffset")
            .and_then(|value| value.as_u64())
            .unwrap_or_default();
        let length = view
            .get("byteLength")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| "Map glTF buffer view has no byte length".to_string())?;
        ordered_views.push((index, offset, length));
    }
    ordered_views.sort_by_key(|(_, offset, _)| *offset);

    let mut groups: Vec<(u64, u64)> = Vec::new();
    let mut view_groups = vec![0_usize; views.len()];
    for (index, offset, length) in ordered_views {
        let end = offset
            .checked_add(length)
            .ok_or_else(|| "Map glTF buffer view overflowed".to_string())?;
        let group_index = if let Some((start, group_end)) = groups.last_mut() {
            if end.saturating_sub(*start) <= MAP_BUFFER_SLICE_BYTES {
                *group_end = (*group_end).max(end);
                groups.len() - 1
            } else {
                groups.push((offset, end));
                groups.len() - 1
            }
        } else {
            groups.push((offset, end));
            0
        };
        view_groups[index] = group_index;
    }

    let stream_buffers = groups
        .iter()
        .map(|(start, end)| {
            let length = end - start;
            serde_json::json!({
                "byteLength": length,
                "uri": format!("{source_uri}?offset={start}&length={length}")
            })
        })
        .collect();
    document["buffers"] = serde_json::Value::Array(stream_buffers);
    let mutable_views = document
        .get_mut("bufferViews")
        .and_then(|value| value.as_array_mut())
        .ok_or_else(|| "Map glTF buffer views became unavailable".to_string())?;
    for (index, view) in mutable_views.iter_mut().enumerate() {
        let object = view
            .as_object_mut()
            .ok_or_else(|| "Map glTF buffer view is invalid".to_string())?;
        let original_offset = object
            .get("byteOffset")
            .and_then(|value| value.as_u64())
            .unwrap_or_default();
        let group_index = view_groups[index];
        object.insert("buffer".to_string(), serde_json::json!(group_index));
        object.insert(
            "byteOffset".to_string(),
            serde_json::json!(original_offset - groups[group_index].0),
        );
    }

    let encoded = serde_json::to_vec(&document)
        .map_err(|error| format!("Failed to encode streaming map glTF: {error}"))?;
    let temporary = stream_scene.with_extension("gltf.tmp");
    std::fs::write(&temporary, encoded)
        .map_err(|error| format!("Failed to write streaming map glTF: {error}"))?;
    std::fs::rename(&temporary, &stream_scene)
        .map_err(|error| format!("Failed to finalize streaming map glTF: {error}"))?;
    Ok(stream_scene)
}

fn build_map_status(map_name: &str, game_path: &str, app: &AppHandle) -> Result<MapStatus, String> {
    validate_map_name(map_name)?;
    let root = resolve_cs2_root(Path::new(game_path))
        .ok_or_else(|| "The saved Counter-Strike 2 folder is no longer valid".to_string())?;
    let vpk = find_map_vpk(map_name, &root);
    let (cache, scene) = map_paths(map_name, vpk.as_deref(), app)?;
    let ready = scene.is_file() && cache.join(MAP_CACHE_COMPLETE_MARKER).is_file();
    Ok(MapStatus {
        map_name: map_name.to_string(),
        vpk_path: vpk.as_ref().map(|path| path.to_string_lossy().to_string()),
        cache_path: cache.to_string_lossy().to_string(),
        scene_path: ready.then(|| scene.to_string_lossy().to_string()),
        ready,
        extractor_available: extractor_path(app).is_some(),
        material_warning: Some(
            "CS2 shader v71 exceeds stable VRF shader parsing; base textures use fallback mappings."
                .to_string(),
        ),
    })
}

#[tauri::command]
fn map_status(map_name: String, game_path: String, app: AppHandle) -> Result<MapStatus, String> {
    build_map_status(&map_name, &game_path, &app)
}

#[tauri::command]
async fn prepare_map(
    map_name: String,
    game_path: String,
    app: AppHandle,
) -> Result<MapStatus, String> {
    let status = build_map_status(&map_name, &game_path, &app)?;
    if status.ready {
        return Ok(status);
    }
    let vpk = status
        .vpk_path
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| format!("CS2 map VPK was not found for {map_name}"))?;
    let extractor = extractor_path(&app)
        .ok_or_else(|| "The bundled 3D map component is unavailable".to_string())?;
    let cache = PathBuf::from(&status.cache_path);
    std::fs::create_dir_all(&cache)
        .map_err(|error| format!("Failed to create map cache: {error}"))?;
    let completion_marker = cache.join(MAP_CACHE_COMPLETE_MARKER);
    if completion_marker.is_file() {
        std::fs::remove_file(&completion_marker)
            .map_err(|error| format!("Failed to reset incomplete map cache: {error}"))?;
    }

    let internal_map = format!("maps/{map_name}.vmap_c");
    let mut command = tokio::process::Command::new(extractor);
    command
        .arg("-i")
        .arg(&vpk)
        .arg("-o")
        .arg(&cache)
        .arg("-d")
        .arg("--vpk_filepath")
        .arg(internal_map)
        .arg("--gltf_export_format")
        .arg("gltf")
        .arg("--gltf_export_materials")
        .arg("--gltf_textures_adapt")
        .arg("--threads")
        .arg("8")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let result = command
        .status()
        .await
        .map_err(|error| format!("Failed to start map extractor: {error}"))?;
    if !result.success() {
        return Err(format!("Map extractor exited with status {result}"));
    }
    let extracted_scene = cache.join("maps").join(format!("{map_name}.gltf"));
    if !extracted_scene.is_file() {
        return Err("Map extraction completed but no glTF scene was produced".to_string());
    }
    std::fs::write(&completion_marker, format!("{map_name}\n"))
        .map_err(|error| format!("Failed to finalize map cache: {error}"))?;
    let prepared = build_map_status(&map_name, &game_path, &app)?;
    if !prepared.ready {
        return Err("Map extraction completed but no glTF scene was produced".to_string());
    }
    Ok(prepared)
}

async fn start_static_map_server(
    root: PathBuf,
) -> Result<(String, tokio::task::JoinHandle<()>), String> {
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("Failed to bind local map server: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("Failed to read local map server address: {error}"))?;
    let task = tokio::spawn(async move {
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(connection) => connection,
                Err(error) => {
                    eprintln!("Local map server stopped: {error}");
                    break;
                }
            };
            let request_root = root.clone();
            tokio::spawn(async move {
                if let Err(error) = serve_map_request(stream, request_root).await {
                    eprintln!("Local map request failed: {error}");
                }
            });
        }
    });
    Ok((format!("http://{address}"), task))
}

fn decode_url_path(path: &str) -> Result<String, String> {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("Invalid percent encoding in map request".to_string());
            }
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                .map_err(|_| "Invalid map request encoding".to_string())?;
            decoded.push(
                u8::from_str_radix(hex, 16)
                    .map_err(|_| "Invalid percent encoding in map request".to_string())?,
            );
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "Map request path is not UTF-8".to_string())
}

fn safe_map_request_path(root: &Path, request_target: &str) -> Result<PathBuf, String> {
    let raw_path = request_target
        .split('?')
        .next()
        .unwrap_or_default()
        .trim_start_matches('/');
    let decoded = decode_url_path(raw_path)?;
    if decoded.is_empty() || decoded.contains('\\') || decoded.contains('\0') {
        return Err("Invalid map resource path".to_string());
    }
    let relative = Path::new(&decoded);
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Map resource path attempted to leave the cache".to_string());
    }
    Ok(root.join(relative))
}

fn map_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "gltf" => "model/gltf+json",
        "bin" => "application/octet-stream",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    }
}

fn parse_byte_range(headers: &str, file_length: u64) -> Option<(u64, u64)> {
    let range = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("range")
            .then(|| value.trim().strip_prefix("bytes=").map(str::to_string))
            .flatten()
    })?;
    let (start, end) = range.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        file_length.checked_sub(1)?
    } else {
        end.parse::<u64>().ok()?.min(file_length.checked_sub(1)?)
    };
    (start <= end && start < file_length).then_some((start, end))
}

fn requested_file_slice(request_target: &str, file_length: u64) -> Option<(u64, u64)> {
    let query = request_target.split_once('?')?.1;
    let mut offset = None;
    let mut length = None;
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=')?;
        match name {
            "offset" => offset = value.parse::<u64>().ok(),
            "length" => length = value.parse::<u64>().ok(),
            _ => {}
        }
    }
    let offset = offset?;
    let length = length?;
    let end = offset.checked_add(length)?;
    (length > 0 && offset < file_length && end <= file_length).then_some((offset, length))
}

async fn write_simple_response(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    body: &str,
) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await
}

async fn serve_map_request(mut stream: tokio::net::TcpStream, root: PathBuf) -> Result<(), String> {
    let mut request = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 4096];
    while request.len() < 16 * 1024 {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let headers = String::from_utf8(request).map_err(|_| "Invalid HTTP request".to_string())?;
    let first_line = headers
        .lines()
        .next()
        .ok_or_else(|| "Empty HTTP request".to_string())?;
    let mut request_parts = first_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let target = request_parts.next().unwrap_or_default();

    if method == "OPTIONS" {
        stream
            .write_all(b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nConnection: close\r\n\r\n")
            .await
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    if method != "GET" && method != "HEAD" {
        write_simple_response(&mut stream, "405 Method Not Allowed", "Method not allowed")
            .await
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let path = match safe_map_request_path(&root, target) {
        Ok(path) => path,
        Err(error) => {
            write_simple_response(&mut stream, "403 Forbidden", &error)
                .await
                .map_err(|write_error| write_error.to_string())?;
            return Ok(());
        }
    };
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => {
            write_simple_response(&mut stream, "404 Not Found", "Map resource not found")
                .await
                .map_err(|error| error.to_string())?;
            return Ok(());
        }
    };
    let length = file
        .metadata()
        .await
        .map_err(|error| error.to_string())?
        .len();
    let (slice_offset, slice_length) = requested_file_slice(target, length).unwrap_or((0, length));
    let range = parse_byte_range(&headers, slice_length);
    let (start, end, status) = range
        .map(|(start, end)| (start, end, "206 Partial Content"))
        .unwrap_or((0, slice_length.saturating_sub(1), "200 OK"));
    let response_length = if slice_length == 0 {
        0
    } else {
        end - start + 1
    };
    let mut response_headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {response_length}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n",
        map_content_type(&path)
    );
    if range.is_some() {
        response_headers.push_str(&format!(
            "Content-Range: bytes {start}-{end}/{slice_length}\r\n"
        ));
    }
    response_headers.push_str("\r\n");
    stream
        .write_all(response_headers.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    if method == "GET" && response_length > 0 {
        file.seek(std::io::SeekFrom::Start(slice_offset + start))
            .await
            .map_err(|error| error.to_string())?;
        let mut limited = file.take(response_length);
        tokio::io::copy(&mut limited, &mut stream)
            .await
            .map_err(|error| error.to_string())?;
    }
    stream.shutdown().await.map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn map_scene_url(
    map_name: String,
    game_path: String,
    app: AppHandle,
    state: State<'_, MapServerState>,
) -> Result<String, String> {
    let status = build_map_status(&map_name, &game_path, &app)?;
    let scene = status
        .scene_path
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| format!("Map cache is not ready for {map_name}"))?;
    let root = scene
        .parent()
        .ok_or_else(|| "Map scene has no cache directory".to_string())?
        .to_path_buf();

    {
        let running = state
            .0
            .lock()
            .map_err(|_| "Map server state is unavailable".to_string())?;
        if let Some(server) = running.as_ref() {
            if server.root == root {
                return Ok(server.scene_url.clone());
            }
        }
    }

    let (origin, task) = start_static_map_server(root.clone()).await?;
    let scene_name = scene
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Map scene has an invalid file name".to_string())?;
    let scene_url = format!("{origin}/{scene_name}");
    let mut running = state
        .0
        .lock()
        .map_err(|_| "Map server state is unavailable".to_string())?;
    if let Some(previous) = running.take() {
        previous.task.abort();
    }
    *running = Some(RunningMapServer {
        root,
        scene_url: scene_url.clone(),
        task,
    });
    Ok(scene_url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MapServerState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            parse_demo,
            release_replay_file,
            open_file_dialog,
            validate_cs2_folder,
            map_status,
            prepare_map,
            map_scene_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cs2-replay-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ))
    }

    #[test]
    fn cs2_install_root_is_resolved_from_the_selected_game_folder() {
        let common = unique_test_root("install-root").join("common");
        let install = common.join("Counter-Strike Global Offensive");
        let csgo = install.join("game").join("csgo");
        std::fs::create_dir_all(csgo.join("maps")).expect("create CS2 test folders");
        std::fs::write(csgo.join("gameinfo.gi"), b"test").expect("write game marker");

        assert_eq!(
            resolve_cs2_root(&install),
            std::fs::canonicalize(&install).ok()
        );
        assert!(resolve_cs2_root(&common).is_none());
        assert!(resolve_cs2_root(&csgo).is_none());

        std::fs::remove_dir_all(common.parent().expect("test root")).expect("remove test root");
    }

    async fn raw_request(address: &str, request: &str) -> String {
        let mut stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect to map server");
        stream
            .write_all(request.as_bytes())
            .await
            .expect("write request");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("read response");
        String::from_utf8(response).expect("response is UTF-8")
    }

    #[test]
    fn local_map_server_streams_and_restricts_files() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("create Tokio runtime");
        runtime.block_on(async {
            let root = std::env::temp_dir().join(format!(
                "cs2-map-server-test-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("system time")
                    .as_nanos()
            ));
            std::fs::create_dir_all(&root).expect("create test root");
            std::fs::write(root.join("sample.bin"), b"abcdef").expect("write test asset");

            let (origin, task) = start_static_map_server(root.clone())
                .await
                .expect("start map server");
            let address = origin.trim_start_matches("http://");

            let head = raw_request(
                address,
                "HEAD /sample.bin HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .await;
            assert!(head.starts_with("HTTP/1.1 200 OK"));
            assert!(head.contains("Content-Length: 6"));
            assert!(head.contains("Access-Control-Allow-Origin: *"));

            let range = raw_request(
                address,
                "GET /sample.bin HTTP/1.1\r\nHost: localhost\r\nRange: bytes=1-3\r\n\r\n",
            )
            .await;
            assert!(range.starts_with("HTTP/1.1 206 Partial Content"));
            assert!(range.contains("Content-Range: bytes 1-3/6"));
            assert!(range.ends_with("bcd"));

            let virtual_slice = raw_request(
                address,
                "GET /sample.bin?offset=2&length=3 HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .await;
            assert!(virtual_slice.starts_with("HTTP/1.1 200 OK"));
            assert!(virtual_slice.contains("Content-Length: 3"));
            assert!(virtual_slice.ends_with("cde"));

            let traversal = raw_request(
                address,
                "GET /../outside.bin HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .await;
            assert!(traversal.starts_with("HTTP/1.1 403 Forbidden"));

            task.abort();
            std::fs::remove_dir_all(root).expect("remove test root");
        });
    }

    #[test]
    fn inferno_manifest_uses_bounded_virtual_buffers_when_available() {
        let scene = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project root")
            .join("map-cache")
            .join("de_inferno")
            .join("maps")
            .join("de_inferno.gltf");
        if !scene.is_file() {
            return;
        }
        let stream_scene = ensure_streamable_gltf(&scene).expect("create streaming manifest");
        let document: serde_json::Value =
            serde_json::from_slice(&std::fs::read(stream_scene).expect("read streaming manifest"))
                .expect("parse streaming manifest");
        let buffers = document["buffers"].as_array().expect("stream buffers");
        assert!(buffers.len() > 1);
        for buffer in buffers {
            assert!(
                buffer["byteLength"].as_u64().expect("buffer length") <= MAP_BUFFER_SLICE_BYTES
            );
            assert!(buffer["uri"]
                .as_str()
                .expect("buffer URI")
                .contains("?offset="));
        }
    }
}
