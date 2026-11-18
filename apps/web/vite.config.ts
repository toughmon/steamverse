import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // API 키는 서버에만 둔다. 브라우저는 /api 로만 요청하고 Vite가 서버로 넘긴다
    // changeOrigin: false — Host(localhost:5173)를 그대로 넘겨야 서버가 Steam 로그인 후 돌아올 주소를 웹 주소로 만든다
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  // 차트 뷰는 지연 로딩이라, 미리 등록해 두지 않으면 탭을 처음 열 때 의존성 재최적화로 페이지가 다시 로드된다
  optimizeDeps: {
    include: [
      'd3-shape',
      'd3-scale',
      'd3-hierarchy',
      'd3-voronoi-treemap',
    ],
  },
});
