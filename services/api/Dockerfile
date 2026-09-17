FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY services/api/package.json ./services/api/package.json
COPY packages ./packages
COPY services/api ./services/api
RUN npm install --no-audit --no-fund --progress=false
RUN npm --workspace @clinai/api run build
RUN test -f services/api/build/services/api/src/main.js

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY services/api/package.json ./services/api/package.json
RUN npm install --omit=dev --no-audit --no-fund --progress=false
COPY --from=build /app/services/api/build ./services/api/build
COPY --from=build /app/packages ./packages
CMD ["node","services/api/build/services/api/src/main.js"]
