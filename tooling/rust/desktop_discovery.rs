use std::{
  collections::BTreeSet,
  env,
  fs,
  path::{Path, PathBuf},
  time::SystemTime,
};

const POINTER_FORMAT_V1: &str = "magnum-release-pointer-v1";

pub struct ResolvedDesktopExecutable {
  pub path: PathBuf,
  pub source: &'static str,
}

pub fn resolve_app_root(app_path: &str) -> Option<PathBuf> {
  let relative_path = PathBuf::from(app_path);
  workspace_root_candidates()
    .into_iter()
    .map(|root| root.join(&relative_path))
    .find(|candidate| candidate.is_dir())
}

pub fn resolve_desktop_executable(app_root: &Path) -> Result<ResolvedDesktopExecutable, String> {
  let mut checked_locations = Vec::new();

  let target_release = app_root.join("src-tauri").join("target").join("release").join("app.exe");
  checked_locations.push(format!("target_release={}", target_release.display()));
  if target_release.is_file() {
    return Ok(ResolvedDesktopExecutable {
      path: target_release,
      source: "target_release",
    });
  }

  if let Some(pointer_match) = resolve_pointer_executable(app_root, &mut checked_locations) {
    return Ok(pointer_match);
  }

  if let Some(release_match) = resolve_latest_release_executable(app_root, &mut checked_locations) {
    return Ok(release_match);
  }

  Err(format!(
    "Desktop executable bulunamadı. Kontrol edilen yollar: {}",
    checked_locations.join(" | ")
  ))
}

fn workspace_root_candidates() -> Vec<PathBuf> {
  let mut candidates = BTreeSet::new();

  if let Ok(current_dir) = env::current_dir() {
    candidates.extend(current_dir.ancestors().map(Path::to_path_buf));
  }

  if let Ok(current_exe) = env::current_exe() {
    candidates.extend(current_exe.ancestors().map(Path::to_path_buf));
  }

  candidates.into_iter().collect()
}

fn resolve_latest_release_executable(
  app_root: &Path,
  checked_locations: &mut Vec<String>,
) -> Option<ResolvedDesktopExecutable> {
  let release_root = app_root.join("release");
  checked_locations.push(format!("release_root={}", release_root.display()));

  let release_entries = fs::read_dir(&release_root).ok()?;
  let mut newest_match: Option<(SystemTime, PathBuf)> = None;

  for release_dir in release_entries.flatten() {
    let release_path = release_dir.path();
    if !release_path.is_dir() {
      continue;
    }

    let artifact_entries = match fs::read_dir(&release_path) {
      Ok(entries) => entries,
      Err(_) => continue,
    };

    for artifact in artifact_entries.flatten() {
      let artifact_path = artifact.path();
      let Some(file_name) = artifact_path.file_name().and_then(|value| value.to_str()) else {
        continue;
      };
      let file_name_lower = file_name.to_ascii_lowercase();
      if !artifact_path.is_file()
        || !file_name_lower.ends_with(".exe")
        || !file_name_lower.contains("portable")
      {
        continue;
      }

      let Ok(metadata) = artifact.metadata() else {
        continue;
      };
      let modified_at = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

      match &newest_match {
        Some((current_modified_at, _)) if modified_at <= *current_modified_at => {}
        _ => newest_match = Some((modified_at, artifact_path)),
      }
    }
  }

  newest_match.map(|(_, path)| ResolvedDesktopExecutable {
    path,
    source: "release_scan",
  })
}

fn resolve_pointer_executable(
  app_root: &Path,
  checked_locations: &mut Vec<String>,
) -> Option<ResolvedDesktopExecutable> {
  let pointer_path = app_root.join("LATEST_RELEASE_POINTER.txt");
  checked_locations.push(format!("pointer_file={}", pointer_path.display()));
  let pointer_content = fs::read_to_string(&pointer_path).ok()?;

  let entries = parse_key_value_lines(&pointer_content);
  let pointer_format = entries
    .get("format")
    .map(|value| value.trim())
    .unwrap_or("legacy");

  if pointer_format != "legacy" && pointer_format != POINTER_FORMAT_V1 {
    checked_locations.push(format!("pointer_invalid_format={pointer_format}"));
    return None;
  }

  let portable_value = entries.get("portable_exe")?.trim();
  if portable_value.is_empty() {
    checked_locations.push("pointer_missing_portable_exe".to_owned());
    return None;
  }

  let candidate_path = if PathBuf::from(portable_value).is_absolute() {
    PathBuf::from(portable_value)
  } else {
    app_root.join(portable_value)
  };

  if !candidate_path.is_file() {
    checked_locations.push(format!("pointer_missing_target={}", candidate_path.display()));
    return None;
  }

  if !path_starts_with(&candidate_path, app_root) {
    checked_locations.push(format!(
      "pointer_outside_workspace={}",
      candidate_path.display()
    ));
    return None;
  }

  Some(ResolvedDesktopExecutable {
    path: candidate_path,
    source: "release_pointer",
  })
}

fn parse_key_value_lines(content: &str) -> std::collections::BTreeMap<String, String> {
  let mut values = std::collections::BTreeMap::new();

  for line in content.lines() {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
      continue;
    }

    let Some((key, value)) = trimmed.split_once('=') else {
      continue;
    };

    let normalized_key = key.trim();
    if normalized_key.is_empty() {
      continue;
    }

    values.insert(normalized_key.to_owned(), value.trim().to_owned());
  }

  values
}

fn path_starts_with(candidate: &Path, base_dir: &Path) -> bool {
  let Ok(candidate) = candidate.canonicalize() else {
    return false;
  };
  let Ok(base_dir) = base_dir.canonicalize() else {
    return false;
  };

  candidate.starts_with(base_dir)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::{SystemTime, UNIX_EPOCH};

  fn unique_temp_dir(label: &str) -> PathBuf {
    let unique = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system time should be after unix epoch")
      .as_nanos();
    let dir = env::temp_dir().join(format!("magnum-opus-{label}-{unique}"));
    fs::create_dir_all(&dir).expect("temp dir should be created");
    dir
  }

  #[test]
  fn resolves_v1_pointer_relative_to_app_root() {
    let app_root = unique_temp_dir("pointer-v1");
    let portable_path = app_root.join("release").join("demo").join("portable.exe");
    fs::create_dir_all(portable_path.parent().expect("portable parent should exist"))
      .expect("release dir should be created");
    fs::write(&portable_path, b"binary").expect("portable file should be written");
    fs::write(
      app_root.join("LATEST_RELEASE_POINTER.txt"),
      "format=magnum-release-pointer-v1\nportable_exe=release/demo/portable.exe\n",
    )
    .expect("pointer file should be written");

    let resolved = resolve_desktop_executable(&app_root).expect("pointer should resolve");
    assert_eq!(resolved.source, "release_pointer");
    assert_eq!(resolved.path, portable_path);

    fs::remove_dir_all(app_root).ok();
  }

  #[test]
  fn falls_back_to_release_scan_when_pointer_is_outside_workspace() {
    let app_root = unique_temp_dir("pointer-fallback");
    let external_root = unique_temp_dir("pointer-external");
    let external_portable = external_root.join("portable.exe");
    fs::write(&external_portable, b"external").expect("external portable should be written");

    let release_portable = app_root
      .join("release")
      .join("20260320-120000_v0.1.0_demo")
      .join("Demo_Portable.exe");
    fs::create_dir_all(release_portable.parent().expect("release parent should exist"))
      .expect("release dir should be created");
    fs::write(&release_portable, b"portable").expect("release portable should be written");
    fs::write(
      app_root.join("LATEST_RELEASE_POINTER.txt"),
      format!("format=magnum-release-pointer-v1\nportable_exe={}\n", external_portable.display()),
    )
    .expect("pointer file should be written");

    let resolved = resolve_desktop_executable(&app_root).expect("release scan should resolve");
    assert_eq!(resolved.source, "release_scan");
    assert_eq!(resolved.path, release_portable);

    fs::remove_dir_all(app_root).ok();
    fs::remove_dir_all(external_root).ok();
  }
}
