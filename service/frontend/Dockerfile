FROM node:20-alpine3.23 AS builder
WORKDIR /app
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.28.2-alpine3.23 AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]