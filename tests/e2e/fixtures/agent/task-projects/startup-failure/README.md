# Catalog service

Run `npm start` from the project directory. No external dependencies are required.
The task runner supplies `PORT` and an isolated working directory.
Configuration is loaded from config.json. The server exposes GET /health and GET /catalog.
Stop the service using the background job control provided by the task environment.
