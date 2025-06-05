FROM node:18-slim

# Install wget, gnupg, ca-certificates (needed for Google Chrome)
# Add Google Chrome stable repository and install Google Chrome
RUN apt-get update && apt-get install -y wget gnupg ca-certificates \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the executable path for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
