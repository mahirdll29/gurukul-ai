FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY client ./client
COPY postcss.config.js tailwind.config.js ./
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
USER node
EXPOSE 3000
CMD ["node","server/dist/index.js"]
