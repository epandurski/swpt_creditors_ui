FROM node:18.20.4-alpine3.19 AS build-image

WORKDIR /usr/src/app
COPY ./ ./
RUN npm install \
  && npm run build

# This is the final app image.
FROM nginx:1.27.0-alpine3.19 AS app-image

ENV NGINX_ENVSUBST_TEMPLATE_DIR=/usr/share/nginx/html
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html

ENV SERVER_API_TIMEOUT=8000
ENV TRANSFER_DELETION_DELAY_SECONDS=1296000
ENV DEBTOR_INFOS_REVISION_DAYS=7

ENV BASE_URL=/

COPY --from=build-image /usr/src/app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
