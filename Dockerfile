FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Expose port
EXPOSE 5000

# Start command
CMD ["node", "index.js"]
