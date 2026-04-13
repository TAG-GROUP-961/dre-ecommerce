import './globals.css'

export const metadata = {
  title: 'DRE E-Commerce — Multi-plataforma',
  description: 'Sistema financeiro para Shopee, Mercado Livre e TikTok',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className="bg-zinc-950 text-zinc-200 antialiased">{children}</body>
    </html>
  )
}
