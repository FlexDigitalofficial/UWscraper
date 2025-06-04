# Step 1: Use a slim Node base image
FROM node:18-slim

# Step 2: Install dependencies for Headless Chrome
RUN apt-get update \
 && apt-get install -y wget gnupg ca-certificates \
 && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
 && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y google-chrome-stable --no-install-recommends \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Step 3: Create app directory and copy in only package.json first
WORKDIR /app
COPY package.json package-lock.json* ./

# Step 4: Install Node dependencies (puppeteer-core, express, dotenv)
RUN npm install --production

# Step 5: Copy the rest of your app's files
COPY . .

# Step 6: Expose port 3000 and run `npm start`
EXPOSE 3000
CMD ["npm", "start"]