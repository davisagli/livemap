# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json .
RUN npm install
COPY . .
RUN npm run build

LABEL maintainer="David Glick <david@glicksoftware.com>" \
      org.label-schema.name="livemap-frontend" \
      org.label-schema.description="livemap frontend image." \
      org.label-schema.vendor="David Glick"

CMD ["npm", "run", "preview"]
