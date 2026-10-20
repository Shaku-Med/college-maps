import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="site-page flex min-h-dvh flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
