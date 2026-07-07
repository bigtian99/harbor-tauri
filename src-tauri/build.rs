fn main() {
    println!("cargo:rerun-if-env-changed=OPS_MODE");
    tauri_build::build()
}
