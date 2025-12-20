FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat git

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

# Create VERSION file with git commit hash (if .git exists)
RUN if [ -d .git ]; then git rev-parse --short HEAD > VERSION; else echo "unknown" > VERSION; fi

RUN npm run build

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["sh", "-c", "npm run db:push && npm start"]
