import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rentix',
    short_name: 'Rentix',
    description: 'Gestão de imóveis e arrendamentos',
    start_url: '/painel',
    display: 'standalone',
    background_color: '#f5f7fa',
    theme_color: '#0f2a44',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
