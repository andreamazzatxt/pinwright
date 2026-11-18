import { Pinwright } from 'pinwright/next/script'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Pinwright />
      </body>
    </html>
  )
}
