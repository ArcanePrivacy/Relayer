FROM node:20

# Create a non‑root user and group
RUN addgroup --system app && adduser --system --ingroup app app

WORKDIR /app

# Copy dependency files and install with correct ownership
COPY --chown=app:app package.json yarn.lock ./
RUN yarn && yarn cache clean --force

# Copy the rest of the application code
COPY --chown=app:app . .

# Switch to the non‑root user
USER app

EXPOSE 8000
ENTRYPOINT ["yarn"]
