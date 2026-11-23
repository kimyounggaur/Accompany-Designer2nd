import { defineConfig } from "vite";

// 배포는 Vercel 하나만 쓰므로 도메인 루트에서 서빙한다(결정 0001).
// 빌드 표시: 운영 주소가 어느 커밋인지 화면에서 바로 확인한다(보고서 A1).
// Vercel은 빌드할 때 VERCEL_GIT_COMMIT_SHA를 넣어 준다. 그 밖의 환경은 "local".
export default defineConfig({
  base: "/",
  define: {
    __BUILD_COMMIT__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
