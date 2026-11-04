FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build vars are baked at build time — pass via --build-arg
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Preview de link do Demo Studio: aponta o desvio dos robôs para a API. Sem VITE_API_URL, tira os blocos
# (entre os marcadores nxdemo-og) e o nginx fica como sempre foi. `nginx -t` barra o build se algo quebrar.
ARG VITE_API_URL
RUN if [ -n "$VITE_API_URL" ]; then \
      sed -i "s#__NXDEMO_API__#${VITE_API_URL%/}#" /etc/nginx/conf.d/default.conf; \
    else \
      sed -i '/# nxdemo-og-inicio/,/# nxdemo-og-fim/d' /etc/nginx/conf.d/default.conf; \
    fi \
    && nginx -t
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
