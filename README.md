# JarPorter

JarPorter is a Tauri desktop app for turning a local JAR package or frontend `dist` directory into a Docker image and pushing it to a Harbor registry.

## Supported Artifacts

- `JAR 应用`: builds the selected `.jar` with the configured Java base image and entrypoint.
- `前端 dist`: builds the selected static `dist` directory with the configured frontend Dockerfile and `nginx.conf` templates. JarPorter copies the contents of the selected directory into the Nginx site root, so the image contains `/usr/share/nginx/html/index.html`, not `/usr/share/nginx/html/dist/index.html`.
- After a successful Harbor push, JarPorter removes the pushed local Docker image tag to keep the machine clean.

## Static Web Docker Image

The repository also includes a production static web image setup based on `Dockerfile` and `nginx.conf`.

```bash
docker build -t jarporter-web:latest .
docker run --rm -p 8080:80 jarporter-web:latest
```

The Docker build uses `npm ci`, then serves the generated `dist` directory with Nginx gzip, SPA history fallback, immutable cache headers for hashed assets, and no-cache headers for `index.html`.

## Frontend Template Variables

The frontend Dockerfile and nginx templates can use these placeholders:

- `{{BASE_IMAGE}}`: frontend base image, for example `nginx:alpine`.
- `{{EXPOSE_PORT}}`: exposed/listen port, for example `80`.
- `{{NGINX_CONF_PATH}}`: nginx config path inside the image.
- `{{DIST_DIR}}`: copied dist directory inside the temporary build context.
- `{{IMAGE_NAME}}`: normalized image name.
- `{{IMAGE_TAG}}`: final image tag.
- `{{FULL_IMAGE}}`: complete registry image reference.

The default frontend template copies `{{DIST_DIR}}/` into `/usr/share/nginx/html/`, so the default SPA fallback is:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Only change the fallback target if you intentionally copy the selected directory itself under a subdirectory such as `/usr/share/nginx/html/dist`.

## Landing Page Generator

JarPorter can generate and upload landing pages from built-in templates.

### Workflow

1. **Fetch channels** — enter channel IDs to pull sub-channel data (name, logo, download URL) from a remote API.
2. **Generate** — each channel's `typeCode` is matched against template directories under `templates/`. The matching templates are rendered using `{{NAME}}`, `{{LOGO}}`, and `{{DOWNLOAD_URL}}` placeholders, and output to a temporary directory.
3. **Preview** — generated pages are served via a local HTTP preview server (bound to `127.0.0.1` only), allowing relative image/font paths to load correctly.
4. **Upload** — rendered pages are uploaded to an FTP server via a Python script.

### Template Directories

Each subdirectory under `templates/` is an independent template:

```
templates/
├── comic/             # Comic category template group
├── comic-1/
├── comic-2/
├── comic-3/
├── novel/             # Novel template
├── aiChat/            # AI chat app template
├── videoShortPlay/    # Short video template
├── gameLibraryAds/    # Game library ad template
└── softwareLibrary/   # Software library template
```

### Template Variables

Within each template's `index.html`, the following placeholders are rendered at generation time:

- `{{NAME}}` — product name (from the channel's `productName`)
- `{{LOGO}}` — product logo URL (from the channel's `subChannelLogo`)
- `{{DOWNLOAD_URL}}` — download link (from the channel's `subChannelLink`)

### Template Category Convention

Each template's `index.html` can embed a Chinese category label via a `<meta>` tag:

```html
<meta name="template-category" content="漫画" />
```

In the **Manage Templates** panel, templates are grouped by this label using Chinese-aware collation. Templates sharing the same `content` value appear in the same foldable group. If a template lacks this `<meta>` tag, its folder name (minus trailing `-123` numeric suffixes) is used as a fallback.

### Template Management

The app provides a template management panel where you can:

- Browse all available templates grouped by category
- Preview each template's `index.html` via an inline iframe
- Upload new templates as ZIP archives
- Delete template directories

### Branch Packaging

JarPorter also supports building artifacts directly from git branches using `git worktree` isolation:

- **Maven projects**: `mvn clean package -DskipTests`
- **npm projects**: `npm install && npm run <script>`
- `node_modules` are cached by lock file hash under `~/.cache/jarporter/npm-cache/` for faster repeated builds.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
