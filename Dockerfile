# Steamverse — 웹 화면과 API를 한 서버(한 주소)에서 내보내는 이미지
# 빌드: docker build -t steamverse .
# 실행: docker run -p 8787:8787 --env-file .env.production -v steamverse-cache:/data steamverse
# 자세한 내용: docs/DEPLOY.md

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    CACHE_DIR=/data \
    PUBLIC_MODE=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/server apps/server
COPY packages/shared packages/shared
COPY --from=build /app/apps/web/dist apps/web/dist
# 캐시(상점 정보·호출 수 등)는 재배포해도 남도록 볼륨에. node 사용자가 쓸 수 있게 소유자를 바꾼다
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
CMD ["npm", "start"]
