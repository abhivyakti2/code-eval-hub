import LoginForm from '@/app/ui/login-form';
import { Suspense } from 'react';
 
export default function LoginPage() {
  return (
    // to prevent hydration mismatch, we wrap the LoginForm in a Suspense component, 
    // which will only render the LoginForm on the client side, 
    // and show a fallback (which is nothing in this case) on the server side. 
    // This is necessary because the LoginForm uses client-side hooks 
    // that would cause a hydration mismatch if rendered on the server.
    <Suspense> 
      <LoginForm />
    </Suspense>
  );
}