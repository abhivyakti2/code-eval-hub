import SignUpForm from '@/app/ui/signup-form';
import { Suspense } from 'react';
 
export default function SignUpPage() {
  return (
    <Suspense>
      {/* no hydration mismatch risk so suspense not needed.
      TODO: can add fallback skeleton */}
      <SignUpForm />
    </Suspense>
  );
}