# Production image for the Social Media AI app: Next.js + ffmpeg + yt-dlp.
FROM node:20-slim

# System deps for the clipping pipeline:
#   ffmpeg            — yt-dlp post-processing / muxing (rendering uses bundled ffmpeg-static)
#   python3           — runtime for the yt-dlp standalone binary
#   curl/ca           — to fetch yt-dlp during build
#   fontconfig+fonts  — REQUIRED for libass caption burning. fonts-liberation provides
#                       Liberation Sans, which fontconfig aliases to "Arial" (the font all
#                       caption presets use). Without fonts, every render fails on a slim image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
     fontconfig fonts-liberation fonts-dejavu-core \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching.
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci

# Copy the rest of the project (app source + seed data/).
COPY . .

# Build the Next.js app.
RUN cd app && npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Railway injects PORT; next start honors it. Bind explicitly to be safe.
CMD ["sh", "-c", "cd app && npx next start -p ${PORT:-3000} -H 0.0.0.0"]
