fn main() {
    println!("cargo:rerun-if-env-changed=OPS_MODE");
    // tauri-build 默认不会跟踪 bundle.icon 文件变化，改完图标不重编会导致
    // Dock/任务栏仍显示旧图标；这里显式监听 icons 目录强制重建。
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
