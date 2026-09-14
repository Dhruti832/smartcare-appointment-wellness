FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
# npm ci requires an exact lock-file match and fails here on a
# platform-specific transitive resolution difference (yaml) between
# this Linux/Alpine build environment and the lock file as generated on
# other platforms -- npm install resolves it at build time instead.
RUN npm install
COPY . .
# CRA inlines REACT_APP_* vars into the static bundle at build time, so every
# one the app reads (services/api.js, ChatbotWidget.jsx, CoordinatorDashboard.jsx)
# has to be supplied here rather than as a container runtime env var.
ARG REACT_APP_API_BASE_URL
ARG REACT_APP_AUTH_API_URL
ARG REACT_APP_APPOINTMENTS_API_URL
ARG REACT_APP_PUBLISH_CONCERN_URL
ARG REACT_APP_POST_REPLY_URL
ARG REACT_APP_DF_AGENT_ID
ARG REACT_APP_GCP_PROJECT_ID
ARG REACT_APP_FIREBASE_API_KEY
ARG REACT_APP_LOOKER_REPORT_URL
ENV REACT_APP_API_BASE_URL=$REACT_APP_API_BASE_URL \
    REACT_APP_AUTH_API_URL=$REACT_APP_AUTH_API_URL \
    REACT_APP_APPOINTMENTS_API_URL=$REACT_APP_APPOINTMENTS_API_URL \
    REACT_APP_PUBLISH_CONCERN_URL=$REACT_APP_PUBLISH_CONCERN_URL \
    REACT_APP_POST_REPLY_URL=$REACT_APP_POST_REPLY_URL \
    REACT_APP_DF_AGENT_ID=$REACT_APP_DF_AGENT_ID \
    REACT_APP_GCP_PROJECT_ID=$REACT_APP_GCP_PROJECT_ID \
    REACT_APP_FIREBASE_API_KEY=$REACT_APP_FIREBASE_API_KEY \
    REACT_APP_LOOKER_REPORT_URL=$REACT_APP_LOOKER_REPORT_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
# Cloud Run's frontend service (infrastructure/gcp/terraform/main.tf) targets
# container_port 8080, not nginx's default of 80.
RUN sed -i 's/listen\s*80;/listen 8080;/' /etc/nginx/conf.d/default.conf
# React Router routes (e.g. /feedback, /dashboard) aren't real files, so nginx's
# default config 404s on them directly instead of handing off to index.html,
# which only React Router can resolve. Fine for in-app clicks (client-side
# nav never hits the server) but breaks every deep link and page refresh.
RUN sed -i '/index  index.html index.htm;/a\    try_files $uri /index.html;' /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
