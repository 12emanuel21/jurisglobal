import { ThemeProvider } from '@/components/theme/ThemeProvider';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="jg-panel">{children}</div>
    </ThemeProvider>
  );
}
