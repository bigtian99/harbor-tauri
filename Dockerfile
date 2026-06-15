# ===== Stage 1: Build =====
FROM node:22-alpine AS builder

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmmirror.com

# Cache dependency installation before copying application source.
COPY package*.json ./
RUN npm config set registry ${NPM_REGISTRY} \
    && npm ci

COPY . .

ARG MODE=production
RUN npm run build -- --mode ${MODE}


# ===== Stage 2: Production =====
FROM nginx:alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
