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

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
