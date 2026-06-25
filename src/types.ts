// ==================== 类型定义 ====================

export type ArtifactType = "jar" | "frontend_dist";
export type BranchProjectType = "maven" | "npm";
export type TabType = "upload" | "branch" | "config" | "history" | "landing";

export interface HarborConfig {
  harbor_url: string;
  username: string;
  password: string;
  project: string;
  base_image: string;
  expose_port: string;
  frontend_base_image: string;
  frontend_expose_port: string;
  frontend_dockerfile_template: string;
  frontend_nginx_template: string;
  // 分支打包记忆配置
  remember_branch_settings: boolean;
  last_repo_path: string;
  last_branch: string;
  last_frontend_dir: string;
  last_build_script: string;
  last_project_type: string;
  last_auto_push_image: boolean;
  last_package_with_backend: boolean;
  last_spring_profile: string;
  last_expose_port: string;
  repo_path_history: string[];
  npm_package_manager: string;
  npm_registry: string;
  // 打包产物输出目录
  artifact_output_dir: string;
  // 自定义 Dockerfile 附加目录（--build-context tools=）
  custom_docker_extras_dir: string;
  // 历史打包记录
  build_history: BuildRecord[];
}

export interface PackageFromBranchResult {
  artifact_path: string;
  backend_artifact_path?: string;
  worktree_path: string;
  build_script: string;
  log: string;
  dockerfile_path?: string;
  dockerfile_context?: string;
}

export interface GitBranchOption {
  name: string;
}

export interface LastCommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  url: string | null;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  url: string | null;
}

export interface CommitListResult {
  commits: CommitInfo[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuthorInfo {
  name: string;
  count: number;
}

export interface BuildRecord {
  id: string;
  timestamp: string;
  repo_path: string;
  branch: string;
  project_type: string;
  artifact_path: string;
  backend_artifact_path?: string;
  image_name: string | null;
  image_tag: string | null;
  build_command: string;
  // 打包配置
  frontend_dir?: string;
  package_manager?: string;
  spring_profile?: string;
  package_with_backend: boolean;
  duration_ms: number;
  status: string;
  log_summary: string;
  full_log: string;
}

export interface SubChannelData {
  id: string;
  typeCode: string;
  subChannelName: string;
  subChannelLogo: string | null;
  subChannelLink: string | null;
  productName: string | null;
  typeName: string | null;
  channelName: string | null;
  subChannelDomain: string | null;
}

export interface LandingPageResult {
  id: string;
  type_code: string;
  name: string;
  output_dir: string;
  status: string;
  message: string;
  thumbnail_path?: string;
  template_dirs: string[];
  current_template_index: number;
}

export interface FtpUploadResult {
  id: string;
  url: string;
  status: string;
  message: string;
}

export interface FtpUploadItem {
  id: string;
  local_dir: string;
  remote_dir: string;
}

export interface TemplateInfo {
  dir: string;
  category: string;
}

// ==================== 常量 ====================

export const DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE = `FROM {{BASE_IMAGE}}
COPY nginx.conf {{NGINX_CONF_PATH}}
COPY {{DIST_DIR}}/ /usr/share/nginx/html/
EXPOSE {{EXPOSE_PORT}}
CMD ["nginx", "-g", "daemon off;"]
`;

export const DEFAULT_FRONTEND_NGINX_TEMPLATE = `server {
    listen       {{EXPOSE_PORT}};
    server_name  _;

    root   /usr/share/nginx/html;
    index  index.html;

    gzip on;
    gzip_min_length 1k;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;
    gzip_vary on;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(?:js|css|woff2?|eot|ttf|otf|svg|png|jpg|jpeg|gif|webp|ico)$ {
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
`;

// ==================== 工具函数 ====================

export function isTauriRuntime() {
  return typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

export function getPathName(path: string) {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export function getProjectName(repoPath: string) {
  return repoPath.split('/').filter(Boolean).pop() || repoPath;
}

export function inferImageName(path: string, type: ArtifactType) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  const lastName = parts.length > 0 ? parts[parts.length - 1] : "";

  if (type === "jar") {
    const nameWithoutExt = lastName.replace(/\.jar$/i, "");
    return nameWithoutExt.replace(/-\d.*/, "").toLowerCase();
  }

  const directoryName = lastName.toLowerCase() === "dist" && parts.length > 1
    ? parts[parts.length - 2]
    : lastName;
  return directoryName.toLowerCase();
}

export function isGitUrl(s: string) {
  return s.startsWith("http://") || s.startsWith("https://") || s.startsWith("git@") || s.endsWith(".git");
}
