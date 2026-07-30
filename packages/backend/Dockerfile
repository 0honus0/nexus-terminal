FROM node:24 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./
COPY html-presets ./html-presets

RUN npm run build


FROM node:24-alpine


# Install build dependencies including setuptools for node-gyp
RUN apk add --no-cache --virtual .build-deps python3 py3-setuptools make g++

WORKDIR /app


COPY --from=builder /app/dist ./dist

COPY --from=builder /app/html-presets ./html-presets

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline


RUN apk del .build-deps


EXPOSE 3001


CMD ["node", "dist/index.js"]
