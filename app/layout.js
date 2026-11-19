import './globals.css';

export const metadata = {
  title: 'Nifty OI Walls',
  description: 'Option-chain OI ceiling/floor analysis for Nifty. Analysis only, no orders.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
