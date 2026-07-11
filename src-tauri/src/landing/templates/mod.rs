//! 模板目录解析与管理。

mod manage;
mod resolve;

pub use manage::{
    delete_template_dir, list_template_dirs, list_template_infos, upload_template_zip,
};
pub use resolve::{get_bundled_templates_dir, init_bundled_templates_dir};
pub(crate) use resolve::{
    list_template_subdirs, summarize_templates_dir, templates_log, templates_root,
};
