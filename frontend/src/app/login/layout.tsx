import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { AuthProvider } from '@/context/AuthContext';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <div className="jg-panel">{children}</div>
      </AuthProvider>
    </ThemeProvider>
  );
}
