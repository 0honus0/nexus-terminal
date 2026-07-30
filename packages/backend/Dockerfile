FROM node:20 AS builder

WORKDIR /app

COPY packages/backend/package.json packages/backend/package-lock.json ./
RUN npm ci

COPY packages/backend/src ./src
COPY packages/backend/tsconfig.json ./
COPY packages/backend/html-presets ./html-presets

RUN npm run build


FROM node:20-alpine


# Install build dependencies including setuptools for node-gyp
RUN apk add --no-cache --virtual .build-deps python3 py3-setuptools make g++

WORKDIR /app


COPY --from=builder /app/dist ./dist

COPY --from=builder /app/html-presets ./html-presets

COPY packages/backend/package.json ./package.json
COPY packages/backend/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --prefer-offline


RUN apk del .build-deps


EXPOSE 3001


CMD ["node", "dist/index.js"]
