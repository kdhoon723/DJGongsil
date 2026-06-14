import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 정적 SPA (Cloudflare Pages 배포). 런타임 백엔드 없음 — data.json 만 로드.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
});
