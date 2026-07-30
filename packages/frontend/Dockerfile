FROM node:24 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


COPY src ./src
COPY index.html ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY public ./public

RUN npm run build


FROM nginx:stable-alpine


RUN rm -rf /usr/share/nginx/html/*


COPY --from=builder /app/dist /usr/share/nginx/html


COPY nginx.conf /etc/nginx/conf.d/default.conf


EXPOSE 80


CMD ["nginx", "-g", "daemon off;"]
