import type { ReactNode } from "react"
import { draftMode } from "next/headers"
import { VisualEditingBridge } from "@/lib/client"
import "./globals.css"

export const metadata = { title: "Demo site" }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = await draftMode()
  return (
    <html lang="en">
      <body>
        {children}
        {isEnabled ? <VisualEditingBridge /> : null}
      </body>
    </html>
  )
}
