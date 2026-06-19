import Link from "next/link";
import CreateFlow from "@/components/CreateFlow";

export const metadata = {
  title: "Create — PETPHO",
  description: "Upload a photo and get 3 AI-generated artworks of your pet.",
};

export default function CreatePage() {
  return (
    <main className="min-h-screen">

      {/* Header — exact mochi structure */}
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <span
            className="text-3xl text-[var(--color-foreground)]"
            style={{ fontFamily: "var(--font-script)" }}
          >
            petpho.
          </span>
          <Link
            href="/"
            className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      {/* Hero text — exact mochi layout */}
      <section className="mx-auto max-w-5xl space-y-3 px-6 pt-12 pb-8 text-center sm:pt-20 sm:pb-12">
        <p
          className="text-2xl"
          style={{ fontFamily: "var(--font-script)", color: "oklch(0.6 0.12 20)" }}
        >
          let&apos;s create
        </p>
        <h1
          className="text-3xl font-medium tracking-tight sm:text-5xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Turn your pet into a masterpiece
        </h1>
        <p className="mx-auto max-w-md text-sm text-[var(--color-muted-foreground)] sm:text-base">
          Upload one photo — AI generates 3 styles simultaneously.
          <br className="hidden sm:inline" />
          Pick your favorite and download.
        </p>
      </section>

      {/* Main flow */}
      <div className="mx-auto max-w-3xl space-y-8 px-6 pb-24">
        <CreateFlow />
      </div>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] py-10 text-center text-xs text-[var(--color-muted-foreground)]">
        <p
          className="text-2xl text-[var(--color-foreground)]"
          style={{ fontFamily: "var(--font-script)" }}
        >
          petpho.
        </p>
        <p className="mt-2">© 2026 PETPHO. All rights reserved.</p>
      </footer>
    </main>
  );
}
