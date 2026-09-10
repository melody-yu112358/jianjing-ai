import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'渐静 · 身心流动',description:'跟随光丝与呼吸的节律，感受从起伏到安定的变化。',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>;}
