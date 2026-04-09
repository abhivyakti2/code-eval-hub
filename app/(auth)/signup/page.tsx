import SignUpForm from '@/app/ui/signup-form';
import { Suspense } from 'react';
 
export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}