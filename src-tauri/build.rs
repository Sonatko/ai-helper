/// Build script executed prior to compiling the main Rust codebase.
///
/// Why:
/// Generates the internal Tauri runtime context, embedding Windows app manifests,
/// DPI-awareness metadata, and application resources directly into the final PE executable.
fn main() {
    tauri_build::build()
}

