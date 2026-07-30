FROM node:24 AS builder

WORKDIR /app

COPY packages/frontend/package.json packages/frontend/package-lock.json ./
RUN npm ci


COPY packages/frontend/src ./src
COPY packages/frontend/index.html ./
COPY packages/frontend/tsconfig.json ./
COPY packages/frontend/vite.config.ts ./
COPY packages/frontend/public ./public

RUN npm run build


FROM nginx:stable-alpine


RUN rm -rf /usr/share/nginx/html/*


COPY --from=builder /app/dist /usr/share/nginx/html


COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf


EXPOSE 80


CMD ["nginx", "-g", "daemon off;"]
