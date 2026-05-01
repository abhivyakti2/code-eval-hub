import SideNav from '@/app/ui/dashboard/sidenav';
import { InactivityGuard } from '../ui/inactivity-guard';
 
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
    <InactivityGuard />

    <div className="flex h-screen flex-col md:flex-row md:overflow-hidden">
      <div className="w-full flex-none md:w-64">
        <SideNav />
      </div>
      <div className="grow p-6 min-h-0 overflow-hidden p-6 md:p-12">{children}</div>
    </div>
    </>
  );
}
//layout passes search params to children, which is the page component in this case. 
// it happens automatically, we just need to await the search params in the page component to access them.