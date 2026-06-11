# Build from the repository root: docker build -f app/Dockerfile .
FROM node:20-slim AS build
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY app ./app
RUN npx esbuild app/src/main.ts --bundle --platform=node --format=esm \
    --packages=external --outfile=app/dist/main.mjs

FROM node:20-slim
WORKDIR /work
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /work/app/dist ./app/dist
COPY app/app.yml ./app.yml
EXPOSE 3000
CMD ["node", "app/dist/main.mjs"]
